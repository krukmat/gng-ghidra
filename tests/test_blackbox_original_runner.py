"""ROM-free preflight checks for the isolated original Blackbox R0 runner."""
from pathlib import Path
import shutil
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "run-blackbox-original.sh"


class BlackboxOriginalRecoveryTests(unittest.TestCase):
    def test_shell_is_parseable(self):
        if shutil.which("bash"):
            proc = subprocess.run(["bash", "-n", str(SCRIPT)],
                                  capture_output=True, text=True)
            self.assertEqual(proc.returncode, 0, proc.stderr)

    def test_original_upstream_runner_not_duplicated(self):
        source = SCRIPT.read_text()
        self.assertIn('scripts/mame_autoboot.lua', source)
        self.assertIn('plans/generated/gng_boot_only.yaml', source)
        self.assertIn('from input_planner import load_input_plan', source)
        self.assertIn('from input_timeline import load_input_timeline', source)
        self.assertIn('T1_BOOT_INPUTS=MATCH', source)
        self.assertIn('T1_GAMEPLAY=NEEDS_VISUAL_CONFIRMATION_FROM_OPERATOR', source)
        self.assertNotIn('scripts/capture-mame-frame.lua', source)
        self.assertNotIn('GNG_BOT_SEQUENCE', source)


if __name__ == "__main__":
    unittest.main()
