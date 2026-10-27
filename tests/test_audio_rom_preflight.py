import importlib.util
import io
import tempfile
import unittest
import zipfile
import zlib
import hashlib
from pathlib import Path

MODULE = Path(__file__).resolve().parents[1] / "scripts/audio_rom_preflight.py"
spec = importlib.util.spec_from_file_location("audio_rom_preflight", MODULE)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class AudioRomPreflightTests(unittest.TestCase):
    def test_size_crc_sha_are_required(self):
        payload = b"fake-test-fixture-only"
        self.assertTrue(mod.check_rom(payload, len(payload),
                                      f"{zlib.crc32(payload):08x}",
                                      hashlib.sha1(payload).hexdigest()))
        self.assertFalse(mod.check_rom(payload, len(payload) + 1,
                                       f"{zlib.crc32(payload):08x}",
                                       hashlib.sha1(payload).hexdigest()))
        self.assertFalse(mod.check_rom(payload, len(payload),
                                       "00000000", hashlib.sha1(payload).hexdigest()))

    def test_missing_and_bad_archive_fail_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.assertEqual(mod.check_archives([root / "missing.zip"]), "MISSING")
            with zipfile.ZipFile(root / "gngb.zip", "w") as archive:
                archive.writestr("gg2.bin", b"fake")
            self.assertEqual(mod.check_archives([root / "gngb.zip"]), "MISMATCH")
            with zipfile.ZipFile(root / "parent.zip", "w") as archive:
                archive.writestr("readme.txt", "synthetic")
            self.assertEqual(mod.check_archives([root / "parent.zip"]), "MISSING")

    def test_parent_set_resolution(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with zipfile.ZipFile(root / "child.zip", "w") as archive:
                archive.writestr("gg3.bin", "synthetic")
            with zipfile.ZipFile(root / "parent.zip", "w") as archive:
                archive.writestr("gg2.bin", "not-the-original")
            self.assertEqual(mod.check_archives([root / "child.zip", root / "parent.zip"]), "MISMATCH")


if __name__ == "__main__":
    unittest.main()
