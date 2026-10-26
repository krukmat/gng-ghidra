"""Full capture orchestration using synthetic argv/env collectors, no MAME."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class FullNativeCaptureRunnerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)
        self.repo = self.base / 'public repo'
        (self.repo / 'scripts').mkdir(parents=True)
        self.bin = self.base / 'bin'
        self.bin.mkdir()
        shutil.copy(ROOT / 'scripts/r3-bank-provenance-capture.sh', self.repo / 'scripts')
        self.calls = self.base / 'calls.jsonl'
        self.env = dict(os.environ, PATH=f'{self.bin}:{os.environ["PATH"]}',
                        TEST_CALLS=str(self.calls), GNG_R3_MAME_BIN=str(self.bin / 'mame'))
        self.env.pop('GNG_R2_PROBE_FRAMES', None)
        self.env.pop('GNG_A063_PREFLIGHT', None)
        collector = '''#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
name=Path(sys.argv[0]).name
with open(os.environ['TEST_CALLS'],'a') as stream:
    stream.write(json.dumps({'tool':name,'args':sys.argv[1:]})+'\\n')
if sys.argv[1:3]==['scripts/r3_bank_provenance.py','prepare']:
    print('4000 4001')  # Synthetic offsets; no ROM is present.
'''
        # Use the current Python directly: an env-python3 shebang would recurse.
        import sys
        collector = collector.replace('#!/usr/bin/env python3', f'#!{sys.executable}', 1)
        for name in ('python3', 'mame'):
            path = self.bin / name
            path.write_text(collector)
            path.chmod(0o755)
        (self.repo / 'scripts/r3-video-write-capture.sh').write_text('''#!/usr/bin/env bash
python3 - <<'PY'
import json, os
keys=('GNG_A063_PREFLIGHT','GNG_A063_FULL_ORACLE','GNG_R2_PROBE_FRAMES',
      'GNG_A06_BANKSIG_HEX0','GNG_A06_BANKSIG_HEX1','GNG_R2_TRACE_MODE',
      'GNG_R36_CAPTURE_UNMAP_POLICY','GNG_A04_VIDEO_WRITE_TAP')
with open(os.environ['TEST_CALLS'],'a') as stream:
    stream.write(json.dumps({'capture_env':{k:os.environ.get(k) for k in keys}})+'\\n')
PY
''')
        # This callback needs real Python, while all runner Python calls are mocks.
        path = self.repo / 'scripts/r3-video-write-capture.sh'
        path.write_text(path.read_text().replace("python3 - <<'PY'", f"'{sys.executable}' - <<'PY'"))

    def run_runner(self, *args, **env):
        return subprocess.run(['bash', str(self.repo / 'scripts/r3-bank-provenance-capture.sh'),
                               *args], env=dict(self.env, **env), capture_output=True,
                              text=True, timeout=10)

    def test_complete_full_capture_env_reaches_original_wrapper_and_stops_before_report(self):
        for frames in (None, '30'):
            with self.subTest(frames=frames):
                self.calls.unlink(missing_ok=True)
                env = {} if frames is None else {'GNG_R2_PROBE_FRAMES': frames}
                result = self.run_runner('--full-oracle', '--capture-only', **env)
                self.assertEqual(result.returncode, 0, result.stderr)
                calls = [json.loads(line) for line in self.calls.read_text().splitlines()]
                capture = next(x['capture_env'] for x in calls if 'capture_env' in x)
                self.assertEqual(capture, {
                    'GNG_A063_PREFLIGHT':str(self.repo / 'out/r3/banked-provenance/private-a063-preflight.json'),
                    'GNG_A063_FULL_ORACLE':'1', 'GNG_R2_PROBE_FRAMES':frames or '4',
                    'GNG_A06_BANKSIG_HEX0':'4000', 'GNG_A06_BANKSIG_HEX1':'4001',
                    'GNG_R2_TRACE_MODE':'printf', 'GNG_R36_CAPTURE_UNMAP_POLICY':'1',
                    'GNG_A04_VIDEO_WRITE_TAP':'1'})
                tools = [x['args'] for x in calls if 'args' in x]
                preflight = next(x for x in tools if x[0]=='scripts/a063_trace_contract.py')
                self.assertIn('--oracle', preflight)
                self.assertIn('--full-oracle', preflight)
                self.assertEqual(tools[-1][0:2], ['scripts/a063_capture_integrity.py','--verify'])
                self.assertFalse(any('diagnose' in x or 'report' in x for x in tools))
                self.assertFalse(any(x.get('tool')=='mame' for x in calls))

    def test_existing_capture_is_preserved_before_any_tool_call(self):
        evidence = self.repo / 'out/r2/mame-probe'
        evidence.mkdir(parents=True)
        marker = evidence / 'existing.txt'
        marker.write_text('preserve')
        result = self.run_runner('--full-oracle','--capture-only')
        self.assertEqual(result.returncode, 2)
        self.assertIn('capture_artifact_collision', result.stderr)
        self.assertEqual(marker.read_text(), 'preserve')
        self.assertFalse(self.calls.exists())

    def test_full_opt_in_is_required_before_any_tool_call(self):
        result = self.run_runner()
        self.assertEqual(result.returncode, 2)
        self.assertIn('explicit_full_oracle_required', result.stderr)
        self.assertFalse(self.calls.exists())


if __name__ == '__main__':
    unittest.main()
