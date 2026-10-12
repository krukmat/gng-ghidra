"""Regression: Ghidra can exit 0 after a script error without producing JSON."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class HeadlessWrapperTests(unittest.TestCase):
    def test_import_succeeds_but_script_failure_is_not_masked(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / 'scripts').mkdir()
            (root / 'out').mkdir()
            (root / 'bin').mkdir()
            shutil.copy2(ROOT / 'scripts/functions-headless.sh', root / 'scripts/functions-headless.sh')
            # Fake successful ROM importer and a failing Java post-script.
            (root / 'bin/python3').write_text('#!/bin/sh\nexit 0\n')
            ghidra = root / 'bin/fake-headless'
            ghidra.write_text('#!/bin/sh\necho "INFO: Import succeeded"\necho "ERROR: ExportFunctionGraph.java compilation failed"\nexit 0\n')
            for path in [ghidra, root / 'bin/python3']:
                path.chmod(0o755)
            (root / 'out/functions.raw.json').write_text('{"stale":true}')
            env = os.environ.copy()
            env['PATH'] = f"{root / 'bin'}:{env['PATH']}"
            env['GHIDRA_HEADLESS'] = str(ghidra)
            proc = subprocess.run(
                ['bash', str(root / 'scripts/functions-headless.sh'), 'not-needed.zip'],
                env=env, capture_output=True, text=True, timeout=15
            )
            self.assertNotEqual(proc.returncode, 0)
            self.assertIn('GNG_FUNCTION_EXPORT=FAIL', proc.stderr)
            self.assertIn('compilation failed', proc.stderr)
            self.assertNotIn('FileNotFoundError', proc.stderr)
            self.assertFalse((root / 'out/functions.raw.json').exists())
            self.assertTrue((root / 'out/functions-ghidra.log').exists())


if __name__ == '__main__':
    unittest.main()
