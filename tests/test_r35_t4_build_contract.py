"""ROM-free safety checks for isolated IRQ/SYNC ARM64 preparation and build."""
from pathlib import Path
import shutil
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
HOST = ROOT / "scripts/r35-t4-build.sh"
GUEST = ROOT / "scripts/r35-t4-build-inner.sh"
CHECK = ROOT / "scripts/r35-t4-overlay-compile-check.sh"
CHECK_GUEST = ROOT / "scripts/r35-t4-overlay-compile-check-inner.sh"

class IsolatedBuildContract(unittest.TestCase):
    def test_readonly_protected_source_and_private_new_volumes(self):
        outer = HOST.read_text()
        inner = GUEST.read_text()
        for token in [
            "gng-a063-mame0289-arm64-v1",
            "gng-r35-t4-mame-arm64-v2",
            "gng-r35-t4-evidence-arm64-v2",
            "--network none", "--pull never", "--platform linux/arm64",
            "dst=/reference,readonly", "dst=/mame,volume-nocopy",
            "dst=/workspace/out,volume-nocopy",
            "dst=/workspace/scripts,readonly",
            "dst=/workspace/patches,readonly",
            "CONCURRENT_VOLUME_CREATION", "VOLUME_OWNERSHIP_MISMATCH",
            "scripts/r35-t4-overlay-compile-check.sh",
            "OVERLAY_COMPILE_CHECK_FAILED",
        ]:
            self.assertIn(token, outer)
        # Attempt 1 is preserved evidence: never mounted, reused or cleaned.
        for preserved in ["gng-r35-t4-mame-arm64-v1",
                          "gng-r35-t4-evidence-arm64-v1"]:
            self.assertNotIn(preserved, outer)
        # The ROM-free gate runs before any volume can be created.
        self.assertLess(outer.index("r35-t4-overlay-compile-check.sh"),
                        outer.index("volume create"))
        for token in [
            "ORIGINAL_PATCH_INVALID", "COPIED_PATCH_INVALID",
            "ORIGINAL_BINARY_CHANGED", "UNEXPECTED_PATCHED_SOURCES",
            "t4-prepare.ok", "BUILD_ALREADY_ATTEMPTED",
            "BUILD_CONCURRENTLY_STARTED", "GNG_R35_NATIVE_V1",
            "INSTRUMENTED_BINARY_IDENTICAL_TO_ORIGINAL",
            "INSTRUMENTED_EVENT_MISSING",
            "for event in CPU_RESET LINE_DELIVERED SYNC_ENTER SYNC_EXIT "
            "IRQ_ENTRY VECTOR_FETCH; do",
            "make -j4 SUBTARGET=gnga063 SOURCES=src/mame/capcom/gng.cpp REGENIE=1",
        ]:
            self.assertIn(token, inner)
        for forbidden in [
            "docker system prune", "docker volume rm", "docker build",
            "git clone", "rm -rf", "r2-mame-probe.sh",
            "GNG_R35_NATIVE_T4_APPROVED", "scripts/r3-native-irq-verify.sh",
        ]:
            self.assertNotIn(forbidden, outer + inner)

    def test_overlay_compile_gate_is_rom_free_and_tmpfs_only(self):
        outer = CHECK.read_text()
        inner = CHECK_GUEST.read_text()
        for token in [
            "gng-a063-mame0289-arm64-v1", "dst=/reference,readonly",
            "dst=/workspace/scripts,readonly", "--network none",
            "--read-only", "--pull never", "--cap-drop ALL",
            "--tmpfs /tmp:", "--tmpfs /workspace/out:",
        ]:
            self.assertIn(token, outer)
        for token in [
            "BASELINE_HARNESS_DOES_NOT_REPRODUCE_PROTECTED_BUILD",
            "PASS_M6809_FAMILY_UPSTREAM_AND_OVERLAY_WERROR",
            "-f optional.make", "config=release",
            "CORES=(m6809 hd6309 konami)", "GNG_R35_NATIVE_V1",
            "scripts/r3_prepare_native_mame_hook.py",
            "BLOCKED_INNER_ABORTED; exit 2; fi' EXIT",
        ]:
            self.assertIn(token, inner)
        self.assertIn("CONTAINER_OR_HARNESS_ABORTED", outer)
        for forbidden in [
            "volume create", "volume rm", "docker build", "evidence-arm64",
            "gng-r35-t4-mame", "roms", "private-capture", "patches",
            "GNG_R35_NATIVE_T4_APPROVED", "rm -rf", "dst=/mame",
        ]:
            self.assertNotIn(forbidden, outer + inner)

    @unittest.skipUnless(shutil.which("bash"), "bash unavailable")
    def test_syntax_and_fail_closed_invalid_invocations(self):
        for name in [CHECK, CHECK_GUEST]:
            proc = subprocess.run(["bash", "-n", str(name)],
                                  capture_output=True, text=True)
            self.assertEqual(proc.returncode, 0, proc.stderr)
        for command in [["bash", str(CHECK), "--build"],
                        ["bash", str(CHECK_GUEST), "--build"]]:
            proc = subprocess.run(command, capture_output=True, text=True)
            self.assertEqual(proc.returncode, 2)
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
