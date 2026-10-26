"""T0 ROM-free source contracts. No MAME, ROM, Docker or private trace."""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class MainRamTapContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.lua = (ROOT / "scripts/r2-mame-probe.lua").read_text()
        cls.launcher = (ROOT / "scripts/a063-main-ram-native-capture.sh").read_text()
        cls.inner = (ROOT / "scripts/a063-full-native-inner.sh").read_text()
        cls.source = (ROOT / "scripts/a063_trace_contract.py").read_text()
        cls.runner = (ROOT / "scripts/a063-r2b-romfree.sh").read_text()

    def test_opt_in_only_full_oracle_and_soft_reset(self):
        self.assertIn('os.getenv("GNG_A063_MAIN_RAM_TAP") == "1"', self.lua)
        self.assertIn("assert(full_oracle and controlled_reset and space.data_width == 8", self.lua)
        self.assertEqual(self.lua.count('0x0000, 0x1dff, "a063-main-ram-write-tap"'), 1)
        self.assertEqual(self.lua.count('record("A063_MAIN_RAM_WRITE",'), 1)
        self.assertNotIn('record("A063_MAIN_RAM_WRITE", resetCount, main_ram_count,\n                       pc()', self.lua)
        self.assertIn('main_ram_count > main_ram_limit and "1" or "0"', self.lua)

    def test_existing_tap_boundaries_unchanged(self):
        for text in (
            '0x1e00, 0x1fff, "r3-sprite-ram-write-probe"',
            '0x2000, 0x2fff, "a04-video-ram-write-probe"',
            '0x3000, 0x3fff, "r2-mmio-read-probe"',
            '0x3000, 0x3fff, "r2-mmio-write-probe"',
            'record("A04_VIDEO_WRITE_COUNT", a04_video_count)',
            'record("OBSERVED_SPRITE_RAM_WRITE_COUNT", sprite_write_count)',
            'record("R36_UNMAP_POLICY", value)',
        ):
            self.assertIn(text, self.lua)

    def test_launcher_cannot_create_without_operator_approval(self):
        self.assertIn("MODE=--check", self.launcher)
        self.assertIn("GNG_A063_RAM_CAPTURE_APPROVED", self.launcher)
        self.assertIn("EXPLICIT_OPERATOR_T1", self.launcher)
        self.assertIn("t1_operator_authorization_required", self.launcher)
        self.assertIn("gng-a063-private-capture-arm64-ram-tap-v1", self.launcher)
        self.assertIn("new_volume_already_exists_preserve_evidence", self.launcher)
        self.assertIn("--env GNG_A063_MAIN_RAM_TAP=1", self.launcher)
        for flag in ("--network none", "--pull never", "--read-only", "volume-nocopy"):
            self.assertIn(flag, self.launcher)
        self.assertIn("bash scripts/a063-full-native-inner.sh", self.launcher)
        self.assertIn("GNG_R2_PROBE_SOFT_RESET=1", self.inner)
        self.assertIn("GNG_A04_VIDEO_WRITE_TAP=1", self.inner)
        self.assertIn("GNG_R36_CAPTURE_UNMAP_POLICY=1", self.inner)

    def test_source_freeze_and_gate_registration(self):
        for path in (
            "scripts/r2-mame-probe.lua",
            "scripts/a063-main-ram-native-capture.sh",
            "scripts/r3_native_main_ram_write_gate.mjs",
        ):
            self.assertIn(f'"{path}"', self.source)
        self.assertIn("test_r3_native_main_ram_write_gate.mjs", self.runner)
        self.assertIn("test_a063_main_ram_contract.py", self.runner)


if __name__ == "__main__":
    unittest.main()
