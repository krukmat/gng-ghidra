"""ROM-free safety checks for isolated IRQ/SYNC ARM64 preparation and build."""
from pathlib import Path
import shutil
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
HOST = ROOT / "scripts/r35-t4-build.sh"
GUEST = ROOT / "scripts/r35-t4-build-inner.sh"

class IsolatedBuildContract(unittest.TestCase):
    def test_readonly_protected_source_and_private_new_volumes(self):
        outer = HOST.read_text()
        inner = GUEST.read_text()
        for token in [
            "gng-a063-mame0289-arm64-v1",
            "gng-r35-t4-mame-arm64-v1",
            "gng-r35-t4-evidence-arm64-v1",
            "--network none", "--pull never", "--platform linux/arm64",
            "dst=/reference,readonly", "dst=/mame,volume-nocopy",
            "dst=/workspace/out,volume-nocopy",
            "dst=/workspace/scripts,readonly",
            "dst=/workspace/patches,readonly",
            "CONCURRENT_VOLUME_CREATION", "VOLUME_OWNERSHIP_MISMATCH",
        ]:
            self.assertIn(token, outer)
        for token in [
            "ORIGINAL_PATCH_INVALID", "COPIED_PATCH_INVALID",
            "ORIGINAL_BINARY_CHANGED", "UNEXPECTED_PATCHED_SOURCES",
            "t4-prepare.ok", "BUILD_ALREADY_ATTEMPTED",
            "BUILD_CONCURRENTLY_STARTED", "GNG_R35_NATIVE_V1",
            "INSTRUMENTED_BINARY_IDENTICAL_TO_ORIGINAL",
            "make -j4 SUBTARGET=gnga063 SOURCES=src/mame/capcom/gng.cpp REGENIE=1",
        ]:
            self.assertIn(token, inner)
        for forbidden in [
            "docker system prune", "docker volume rm", "docker build",
            "git clone", "rm -rf", "r2-mame-probe.sh",
            "GNG_R35_NATIVE_T4_APPROVED", "scripts/r3-native-irq-verify.sh",
        ]:
            self.assertNotIn(forbidden, outer + inner)

    @unittest.skipUnless(shutil.which("bash"), "bash unavailable")
    def test_syntax_and_fail_closed_invalid_invocations(self):
        for name in [HOST, GUEST]:
            proc = subprocess.run(["bash", "-n", str(name)],
                                  capture_output=True, text=True)
            self.assertEqual(proc.returncode, 0, proc.stderr)
        for command in [
            ["bash", str(HOST), "--run"],
            ["bash", str(HOST), "--prepare", "--build"],
            ["bash", str(GUEST), "--capture"],
        ]:
            proc = subprocess.run(command, capture_output=True, text=True)
            self.assertEqual(proc.returncode, 2)

if __name__ == "__main__":
    unittest.main()
