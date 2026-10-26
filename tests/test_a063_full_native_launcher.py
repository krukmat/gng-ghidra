"""ROM-free launcher tests: fake Docker commands, never a native capture."""
from pathlib import Path
import json
import os
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
IMAGE = 'sha256:a3bd689f9d867b51cd4a25f01b3dfd8ed0218b53f09347a714271e6cd964c255'


class FullNativeLauncherTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)
        self.repo = self.base / 'repo with spaces'
        (self.repo / 'scripts').mkdir(parents=True)
        (self.repo / '.git').mkdir()
        (self.repo / 'roms').mkdir()
        (self.repo / 'roms/gng.zip').touch()  # Existence only; never read.
        shutil.copy(ROOT / 'scripts/a063-full-native-capture.sh', self.repo / 'scripts')
        (self.repo / 'scripts/a063_trace_contract.py').write_text(
            'SOURCE_FILES = ("scripts/a063-full-native-capture.sh", '
            '"scripts/a063-full-native-inner.sh")\n')
        self.bin = self.base / 'bin'
        self.bin.mkdir()
        self.calls = self.base / 'calls.jsonl'
        self.env = dict(os.environ, PATH=f'{self.bin}:{os.environ["PATH"]}',
                        TEST_REPO=str(self.repo.resolve()), TEST_CALLS=str(self.calls),
                        TEST_VOLUME_STATE=str(self.base / 'mock-volume.json'),
                        TEST_IMAGE=IMAGE)
        self.env.pop('DOCKER_HOST', None)
        mock = '''#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
name=Path(sys.argv[0]).name
args=sys.argv[1:]
with open(os.environ['TEST_CALLS'],'a') as stream:
    stream.write(json.dumps([name,*args])+'\\n')
if name=='git':
    if args[:1]==['-C']: args=args[2:]
    if args==['rev-parse','--show-toplevel']: print(os.environ['TEST_REPO'])
    elif args==['branch','--show-current']: print(os.environ.get('TEST_BRANCH','feature/a063-r1-forensics-contract'))
    elif args==['status','--porcelain','--untracked-files=no']: print(os.environ.get('TEST_DIRTY',''))
    elif args[:2]==['ls-files','--error-unmatch']: sys.exit(1 if os.environ.get('TEST_UNTRACKED')=='1' else 0)
    elif args==['rev-parse','--verify','HEAD']: print('a'*40)
    else: sys.exit(9)
elif name=='docker':
    if args[:2]!=['--context','colima']: sys.exit(9)
    args=args[2:]
    if args[:2]==['context','inspect']: print(os.environ.get('TEST_ENDPOINT','unix:///local-colima.sock'))
    elif args[:1]==['info']: print('linux arm64')
    elif args[:2]==['image','inspect']: print(os.environ.get('TEST_IMAGE_RESULT',os.environ['TEST_IMAGE']+' arm64 linux'))
    elif args[:2]==['volume','inspect']:
        if args[2]=='gng-a063-mame0289-arm64-v1': sys.exit(0)
        state=Path(os.environ['TEST_VOLUME_STATE'])
        if state.exists():
            saved=json.loads(state.read_text())
            if args[2]==saved['name']:
                if '--format' in args: print(saved['nonce'])
                sys.exit(0)
        sys.exit(0 if os.environ.get('TEST_VOLUME_EXISTS')=='1' else 1)
    elif args[:2]==['volume','create'] and os.environ.get('TEST_ALLOW_RUN')=='1':
        if len(args)!=5 or args[2]!='--label' or not args[3].startswith('gng.a063.d6.launch='): sys.exit(98)
        Path(os.environ['TEST_VOLUME_STATE']).write_text(json.dumps({
            'name':args[4], 'nonce':args[3].split('=',1)[1]}))
        print(args[4])
    elif args[:1]==['run'] and os.environ.get('TEST_ALLOW_RUN')=='1':
        # Record argv only: NEVER launch Docker, MAME, or the inner script.
        sys.exit(int(os.environ.get('TEST_RUN_EXIT','0')))
    else: sys.exit(99)  # Default tests reject every simulated mutation.
else: sys.exit(9)
'''
        for name in ('git', 'docker'):
            path = self.bin / name
            path.write_text(mock)
            path.chmod(0o755)

    def run_check(self, *args, **env):
        return subprocess.run(['bash', str(self.repo / 'scripts/a063-full-native-capture.sh'),
                               *args], env=dict(self.env, **env), text=True,
                              capture_output=True, timeout=10)

    def assert_read_only_calls(self):
        calls = [json.loads(line) for line in self.calls.read_text().splitlines()]
        for call in calls:
            if call[0] == 'docker':
                self.assertNotIn('run', call)
                self.assertNotIn('create', call)
                self.assertNotIn('rm', call)
        self.assertFalse((self.repo / 'out').exists())
        self.assertFalse((self.repo / 'scripts/__pycache__').exists())

    def test_default_is_metadata_only_check_without_capture_or_volume_creation(self):
        result = self.run_check()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, 'D6_CAPTURE_LAUNCHER=CHECK_PASS_CONFIGURATION_ONLY_NOT_CAPTURED\n')
        self.assert_read_only_calls()

    def test_existing_partial_volume_is_rejected_even_in_check_mode(self):
        result = self.run_check('--check', TEST_VOLUME_EXISTS='1')
        self.assertEqual(result.returncode, 2)
        self.assertIn('new_volume_already_exists_preserve_evidence', result.stderr)
        self.assert_read_only_calls()

    def test_frame_bounds_and_argument_order_are_validated_in_check_mode(self):
        for args in (
            ('--frames', '2', '--check'),
            ('--volume', 'gng-a063-private-capture-arm64-full-d6-v2',
             '--frames', '4', '--check'),
            ('--check', '--frames', '30', '--volume',
             'gng-a063-private-capture-arm64-full-d6-v3'),
        ):
            with self.subTest(args=args):
                result = self.run_check(*args)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(result.stdout, 'D6_CAPTURE_LAUNCHER=CHECK_PASS_CONFIGURATION_ONLY_NOT_CAPTURED\n')
        self.assert_read_only_calls()

    def test_invalid_or_duplicate_options_fail_before_any_metadata_call(self):
        injection = f'$(touch {self.base / "injected"})'
        invalid = [('frames_must_be_2_to_30', ('--frames', value))
                   for value in ('1', '31', '0', '01', '02', '3.5', '-2', '', injection)]
        invalid += [
            ('frames_argument_missing', ('--frames',)),
            ('volume_argument_missing', ('--volume',)),
            ('duplicate_frames_argument', ('--frames', '4', '--frames', '4')),
            ('duplicate_volume_argument', ('--volume', 'gng-a063-private-capture-arm64-full-d6-v2',
                                           '--volume', 'gng-a063-private-capture-arm64-full-d6-v3')),
            ('duplicate_mode_argument', ('--check', '--run')),
            ('duplicate_mode_argument', ('--run', '--run')),
            ('invalid_arguments', ('--unknown',)),
        ]
        for reason, args in invalid:
            with self.subTest(args=args):
                result = self.run_check(*args)
                self.assertEqual(result.returncode, 2)
                self.assertIn(reason, result.stderr)
                self.assertFalse(self.calls.exists())
                self.assertFalse((self.base / 'injected').exists())

    def test_mock_run_passes_exact_frame_budget_and_preserves_isolation(self):
        for index, frames in enumerate((None, '2', '4', '30'), start=1):
            args = ['--volume', f'gng-a063-private-capture-arm64-full-d6-v{index}']
            if frames is not None:
                args += ['--frames', frames]
            args += ['--run']
            with self.subTest(frames=frames):
                result = self.run_check(*args, TEST_ALLOW_RUN='1')
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(result.stdout, 'D6_CAPTURE_EXIT=0\n')
                runs = [json.loads(line) for line in self.calls.read_text().splitlines()
                        if json.loads(line)[:4] == ['docker', '--context', 'colima', 'run']]
                self.assertEqual(len(runs), index)
                run = runs[-1]
                env_values = [run[i + 1] for i, arg in enumerate(run) if arg == '--env']
                self.assertEqual([value for value in env_values if value.startswith('GNG_A063_FULL_FRAMES=')],
                                 [f'GNG_A063_FULL_FRAMES={frames or "4"}'])
                for marker in ('none', 'linux/arm64', '--read-only', '--pull', 'never'):
                    self.assertIn(marker, run)
                self.assertEqual(run[-2:], ['bash', 'scripts/a063-full-native-inner.sh'])
                self.assertFalse((self.repo / 'out').exists())

    def test_inner_rejects_invalid_frame_budget_before_workspace_or_artifact_access(self):
        script = ROOT / 'scripts/a063-full-native-inner.sh'
        for value in (None, '', '0', '1', '31', '01', '3.5', '4; exit 0'):
            env = dict(self.env)
            env.pop('GNG_A063_FULL_FRAMES', None)
            if value is not None:
                env['GNG_A063_FULL_FRAMES'] = value
            with self.subTest(value=value):
                result = subprocess.run(['bash', str(script)], cwd=self.base,
                                        env=env, text=True, capture_output=True, timeout=10)
                self.assertEqual(result.returncode, 2)
                self.assertIn('frames_must_be_2_to_30', result.stdout)
                self.assertNotIn('readonly_checkout_required', result.stdout)
        for value in ('2', '4', '30'):
            with self.subTest(valid=value):
                result = subprocess.run(['bash', str(script)], cwd=self.base,
                                        env=dict(self.env, GNG_A063_FULL_FRAMES=value),
                                        text=True, capture_output=True, timeout=10)
                self.assertEqual(result.returncode, 2)
                self.assertIn('readonly_checkout_required', result.stdout)
                self.assertNotIn('frames_must_be_2_to_30', result.stdout)
        self.assertFalse(self.calls.exists())

    def test_dirty_tree_wrong_branch_remote_endpoint_or_image_fail_closed(self):
        for env, reason in (
            ({'TEST_DIRTY': ' M scripts/source.py'}, 'commit_tracked_changes_before_capture'),
            ({'TEST_BRANCH': 'main'}, 'feature_branch_required'),
            ({'TEST_UNTRACKED': '1'}, 'commit_frozen_sources_before_capture'),
            ({'TEST_ENDPOINT': 'tcp://remote:2375'}, 'local_colima_endpoint_required'),
            ({'TEST_IMAGE_RESULT': 'sha256:wrong arm64 linux'}, 'existing_pinned_arm64_image_required'),
            ({'DOCKER_HOST': 'ssh://remote'}, 'remote_docker_host_forbidden'),
        ):
            with self.subTest(reason=reason):
                result = self.run_check('--check', **env)
                self.assertEqual(result.returncode, 2)
                self.assertIn(reason, result.stderr)
        self.assert_read_only_calls()

    def test_volume_names_cannot_target_d5_mame_or_arbitrary_outputs(self):
        for name in ('gng-a063-private-capture-arm64-v1',
                     'gng-a063-private-capture-arm64-delimited-v2',
                     'gng-a063-mame0289-arm64-v1', '../out',
                     'gng-a063-private-capture-arm64-full-d6-v0'):
            with self.subTest(name=name):
                result = self.run_check('--check', '--volume', name)
                self.assertEqual(result.returncode, 2)
                self.assertIn('full_d6_new_volume_name_required', result.stderr)
        self.assertFalse(self.calls.exists())

    def test_shell_syntax_and_exact_native_isolation_contract(self):
        for name in ('a063-full-native-capture.sh', 'a063-full-native-inner.sh'):
            subprocess.run(['bash', '-n', str(ROOT / 'scripts' / name)],
                           check=True, capture_output=True, timeout=10)
        host = (ROOT / 'scripts/a063-full-native-capture.sh').read_text()
        inner = (ROOT / 'scripts/a063-full-native-inner.sh').read_text()
        for marker in ('--network none', '--pull never', '--platform linux/arm64',
                       '--read-only', 'dst=/workspace/.git,readonly',
                       "'ls-files', '--error-unmatch', *SOURCE_FILES",
                       'dst=/workspace/roms,readonly', 'dst=/workspace,readonly',
                       'dst=/workspace/out,volume-nocopy', 'dst=/mame,readonly',
                       'SDL_AUDIODRIVER=dummy', 'GNG_A063_EXPECTED_HEAD=$EXPECTED_HEAD',
                       'GNG_A063_FULL_FRAMES=$CAPTURE_FRAMES', IMAGE):
            self.assertIn(marker, host)
        for marker in ('mkdir /workspace/out/private-runner', 'capture_volume_not_empty',
                       'GNG_R2_PROBE_FRAMES="$GNG_A063_FULL_FRAMES"',
                       'GNG_R2_PROBE_SOFT_RESET=1',
                       'timeout --signal=TERM --kill-after=10s 180s',
                       'xvfb-run -a -e /workspace/out/private-runner/xvfb.log',
                       '--full-oracle --capture-only',
                       '80c447cd81fa91be8bf3159e22dedab157798a4f1a189e6680849179b0ac282d'):
            self.assertIn(marker, inner)
        self.assertEqual(inner.count('verify_binary ||'), 2)
        for prohibited in ('volume rm', 'volume prune', 'rm -f', 'git add',
                           'git reset', 'r3-banked-critical-path.sh'):
            self.assertNotIn(prohibited, host + inner)


if __name__ == '__main__':
    unittest.main()
