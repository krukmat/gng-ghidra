"""ROM-free safety checks for R3.5.B2 T4 source preflight."""
from pathlib import Path
import shutil
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts/r35-t4-source-preflight.sh"


class T4SourcePreflightTests(unittest.TestCase):
    def test_readonly_bounded_no_build_or_capture(self):
        src = SCRIPT.read_text()
        for required in (
            "feature/a063-r1-forensics-contract",
            "docker --context colima",
            "--network none",
            "--read-only",
            "dst=/mame,readonly",
            "dst=/workspace/scripts,readonly",
            "dst=/workspace/patches,readonly",
            "GIT_OPTIONAL_LOCKS=0",
            "f34f02505e32c1993c6a782b6814232cbfc74e36",
            "80c447cd81fa91be8bf3159e22dedab157798a4f1a189e6680849179b0ac282d",
            "--verify-applied",
            "R35_T4_SOURCE=PASS_CACHED_MAME0289_PATCHED_RO",
            "R35_T4_NATIVE_EVIDENCE=NOT_CAPTURED",
        ):
            self.assertIn(required, src)
        for forbidden in (
            "volume create", "git clone", "git reset", "make -j",
            "make SUBTARGET", "docker build", "docker exec",
            "GNG_R35_NATIVE_T4_APPROVED=EXPLICIT_OPERATOR_B2_T4",
            "scripts/r2-mame-probe.sh",
            "docker system prune", "rm -rf",
        ):
            self.assertNotIn(forbidden, src)

    @unittest.skipUnless(shutil.which("bash"), "bash unavailable")
    def test_syntax_and_reject_arguments_before_any_docker_call(self):
        syntax = subprocess.run(["bash", "-n", str(SCRIPT)],
                                capture_output=True, text=True)
        self.assertEqual(syntax.returncode, 0, syntax.stderr)
        invalid = subprocess.run(["bash", str(SCRIPT), "--run"],
                                 capture_output=True, text=True)
        self.assertEqual(invalid.returncode, 2)
        self.assertIn("R35_T4_SOURCE=BLOCKED_INVALID_ARGUMENTS",
                      invalid.stderr)


if __name__ == "__main__":
    unittest.main()
