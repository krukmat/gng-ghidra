"""ROM-free checks: create only an authentic validated gngb fixed ROM view."""
from __future__ import annotations

import importlib.util
import hashlib
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "prepare_r3_flat_rom", ROOT / "scripts/prepare_r3_flat_rom.py")
romprep = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = romprep
SPEC.loader.exec_module(romprep)


def synthetic():
    buf = bytearray(65536)
    buf[0xfffe:0x10000] = b"\x60\x00"
    return bytes(buf)


class R3FlatRomPreflightTests(unittest.TestCase):
    def setUp(self):
        (ROOT / "out").mkdir(exist_ok=True)
        self.tmp = tempfile.TemporaryDirectory(prefix="r3-test-", dir=ROOT / "out")
        self.addCleanup(self.tmp.cleanup)
        self.folder = Path(self.tmp.name)
        self.local_zip = self.folder / "gngb-synthetic-local.zip"
        self.local_zip.write_bytes(b"mocked-only-no-real-zip")
        self.dest = self.folder / "flat.bin"
        self.flat = synthetic()
        self.reader = patch.object(
            romprep, "read_rom",
            return_value=(self.flat, {"set": "gngb", "reset_vector": "0x6000"})
        )
        self.reader.start()
        self.addCleanup(self.reader.stop)

    def test_first_prepare_creates_exact_validated_private_bytes(self):
        result = romprep.prepare(self.local_zip, self.dest)
        self.assertTrue(result["created"])
        self.assertEqual(self.dest.read_bytes(), self.flat)
        self.assertEqual(result["rom_image_bytes"], 65536)
        self.assertEqual(result["flat_rom_sha256"],
                         hashlib.sha256(self.flat).hexdigest())
        self.assertEqual(result["status"], "READY")
        self.assertFalse(result["runtime_equivalence_verified"])

    def test_second_prepare_matches_and_never_overwrites(self):
        romprep.prepare(self.local_zip, self.dest)
        result = romprep.prepare(self.local_zip, self.dest)
        self.assertFalse(result["created"])
        self.dest.write_bytes(b"stale")
        with self.assertRaisesRegex(ValueError, "refusing to overwrite"):
            romprep.prepare(self.local_zip, self.dest)
        self.assertEqual(self.dest.read_bytes(), b"stale")

    def test_missing_zip_fails_without_generating_anything(self):
        with self.assertRaisesRegex(ValueError, "ZIP missing"):
            romprep.prepare(self.folder / "no-zip.zip", self.dest)
        self.assertFalse(self.dest.exists())

    def test_wrong_reset_vector_or_wrong_size_rejected(self):
        original = romprep.read_rom
        bad = bytearray(self.flat)
        bad[0xfffe:0x10000] = b"\x00\x00"
        romprep.read_rom = lambda _: (
            bytes(bad), {"set": "gngb", "reset_vector": "0x0000"})
        try:
            with self.assertRaisesRegex(ValueError, "verified 64 KiB"):
                romprep.prepare(self.local_zip, self.dest)
            romprep.read_rom = lambda _: (
                self.flat[:1000], {"set": "gngb", "reset_vector": "0x6000"})
            with self.assertRaisesRegex(ValueError, "verified 64 KiB"):
                romprep.prepare(self.local_zip, self.dest)
        finally:
            romprep.read_rom = original
        self.assertFalse(self.dest.exists())

    def test_preflight_rejects_tracked_directory_as_output(self):
        with self.assertRaisesRegex(ValueError, "ignored out"):
            romprep.prepare(self.local_zip, ROOT / "scripts/forbidden.bin")

    def test_wrapper_uses_existing_crc_verified_reader_without_running_mame(self):
        shell = (ROOT / "scripts/r3-first-real-slice.sh").read_text()
        self.assertIn("scripts/prepare_r3_flat_rom.py", shell)
        self.assertIn("scripts/r3_static_trace_probe.mjs", shell)
        self.assertIn("out/r2/mame-probe/pre-instruction.jsonl", shell)
        self.assertNotIn("ghidra-headless", shell)
        self.assertNotIn("r2-mame-probe.sh", shell)
        source = (ROOT / "scripts/prepare_r3_flat_rom.py").read_text()
        self.assertIn("from poc import read_rom", source)
        if shutil.which("bash"):
            check = subprocess.run(
                ["bash", "-n", str(ROOT / "scripts/r3-first-real-slice.sh")],
                capture_output=True, text=True)
            self.assertEqual(check.returncode, 0, check.stderr)


if __name__ == "__main__":
    unittest.main()
