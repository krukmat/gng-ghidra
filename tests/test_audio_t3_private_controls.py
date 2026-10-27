"""ROM-free tests for safe MAME main sound control extraction."""
import json
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))
import audio_b3_checkpoint as b3
import audio_t3_private_controls as controls


class NativeControlExtractionTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name) / "audio"
        self.root.mkdir()
        prev = b3.PRIVATE
        b3.PRIVATE = self.root
        self.addCleanup(lambda: setattr(b3, "PRIVATE", prev))
        self.tape = self.root / "mame-audio-events-test.jsonl"

    def write(self, entries):
        self.tape.write_text("".join(json.dumps({
            "seq": i+1, "tick12m": tick, "frame": 0,
            "kind": kind, "address": addr, "value": value
        })+"\n" for i, (tick, kind, addr, value) in enumerate(entries)))

    def test_extract_actual_commands_relative_to_reset_release_and_only_private(self):
        self.write([
            (0, "AUDIO_RESET_WRITE", 0x3d01, 0),
            (8, "SOUNDLATCH_WRITE", 0x3a00, 0x29),
            (16, "AUDIO_RESET_WRITE", 0x3d01, 1),
            (32, "SOUNDLATCH_WRITE", 0x3a00, 0x42),
            (40, "YM2203_WRITE", 0xe000, 0x60),
            (48, "SOUNDLATCH_WRITE", 0x3a00, 0x55),
            (64, "YM2203_WRITE", 0xe002, 0xaa)
        ])
        result = controls.export("test", "synthetic")
        self.assertEqual(result["status"],
                         "PRIVATE_NATIVE_SOUND_CONTROLS_EXTRACTED_LAB_ONLY")
        self.assertEqual(result["captured_sound_commands_after_reset_release"], 2)
        self.assertEqual(result["first_native_sound_command_tstates_after_release"], 4)
        self.assertEqual(result["first_native_ym_event_tstates_after_release"], 6)
        self.assertTrue(result["pre_release_latch_known"])
        self.assertFalse(result["ym_events_replayed"])
        self.assertNotIn("0x42", json.dumps(result))
        output=json.loads((self.root/"z80-native-controls-synthetic.json").read_text())
        self.assertEqual(output["pre_release_latch"], 0x29)
        self.assertEqual(output["events"], [
            {"kind": "SOUNDLATCH_WRITE", "tick12m": 16, "value": 0x42},
            {"kind": "SOUNDLATCH_WRITE", "tick12m": 32, "value": 0x55},
        ])
        self.assertNotIn("YM2203_WRITE", json.dumps(output))
        with self.assertRaisesRegex(controls.ControlsStop,
                                   "AUDIO_T3_CONTROLS_OUTPUT_EXISTS"):
            controls.export("test", "synthetic")

    def test_reject_bad_phase_alignment_or_multiple_reset_epochs(self):
        common=[
            (0, "AUDIO_RESET_WRITE", 0x3d01, 0),
            (16, "AUDIO_RESET_WRITE", 0x3d01, 1),
        ]
        self.write(common+[
            (31, "SOUNDLATCH_WRITE", 0x3a00, 0x42),
            (40, "YM2203_WRITE", 0xe000, 0x60)
        ])
        with self.assertRaisesRegex(controls.ControlsStop,
                                   "AUDIO_T3_CONTROLS_CLOCK_ALIGNMENT_STOP"):
            controls.export("test", "misaligned")
        self.assertFalse((self.root/"z80-native-controls-misaligned.json").exists())
        self.write(common+[
            (24, "AUDIO_RESET_WRITE", 0x3d01, 0),
            (32, "AUDIO_RESET_WRITE", 0x3d01, 1),
            (40, "YM2203_WRITE", 0xe000, 0x60)
        ])
        with self.assertRaisesRegex(controls.ControlsStop,
                                   "AUDIO_T3_CONTROLS_MULTIPLE_RESET_EPOCHS"):
            controls.export("test", "multi")
        self.assertFalse((self.root/"z80-native-controls-multi.json").exists())

    def test_reject_invalid_id_and_missing_reset_before_private_output(self):
        self.write([(0, "YM2203_WRITE", 0xe000, 0x42)])
        for bad in ("../escape", "!bad", "", "a"*40):
            with self.assertRaisesRegex(controls.ControlsStop,
                                       "AUDIO_T3_CONTROLS_BAD_ID"):
                controls.export("test", bad)
        with self.assertRaisesRegex(controls.ControlsStop,
                                   "AUDIO_T3_CONTROLS_RESET_EPOCH_UNVERIFIED"):
            controls.export("test", "missing")
        self.assertFalse((self.root/"z80-native-controls-missing.json").exists())


if __name__ == "__main__":
    unittest.main()
