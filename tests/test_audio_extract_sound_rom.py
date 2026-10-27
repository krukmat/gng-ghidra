import importlib.util
import tempfile
import unittest
import zipfile
from pathlib import Path
source=Path(__file__).resolve().parents[1]/"scripts/audio_extract_sound_rom.py"
spec=importlib.util.spec_from_file_location("audio_extract_sound_rom",source)
mod=importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

class AudioRomExtractionTests(unittest.TestCase):
    def test_invalid_identity_stops_without_writing(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            archive=root/"parent.zip"
            with zipfile.ZipFile(archive,"w") as output:
                output.writestr("gg2.bin",bytes(32768))
            with self.assertRaisesRegex(ValueError,"WRONG_IDENTITY"):
                mod.extract([root/"missing.zip",archive],Path("out/audio/_synthetic_test.bin"))
    def test_identity_check_requires_exact_crc_and_sha(self):
        self.assertFalse(mod.valid(bytes(32768)))
        self.assertFalse(mod.valid(b"small"))
    def test_non_private_dest_rejected(self):
        with self.assertRaisesRegex(ValueError,"PRIVATE_OUTPUT"):
            mod.extract([],Path("gg2.bin"))

if __name__=="__main__":
    unittest.main()
