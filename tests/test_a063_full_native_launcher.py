"""ROM-free launcher tests: fake metadata tools, no Docker run or capture."""
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
        sys.exit(0 if os.environ.get('TEST_VOLUME_EXISTS')=='1' else 1)
    else: sys.exit(99)  # A test MUST NEVER permit run/create or mutations.
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
                       'SDL_AUDIODRIVER=dummy', 'GNG_A063_EXPECTED_HEAD=$EXPECTED_HEAD', IMAGE):
            self.assertIn(marker, host)
        for marker in ('mkdir /workspace/out/private-runner', 'capture_volume_not_empty',
                       'GNG_R2_PROBE_FRAMES=30', 'GNG_R2_PROBE_SOFT_RESET=1',
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
