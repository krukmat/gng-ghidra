import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

MODULE = Path(__file__).resolve().parents[1] / "scripts/audio_events_compare.py"
spec = importlib.util.spec_from_file_location("audio_events_compare", MODULE)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class AudioCompareTests(unittest.TestCase):
    def test_exact_stream_only_and_empty_blocked(self):
        js=[{"kind":"AUDIO_RESET_LINE","value":1},
            {"kind":"SOUNDLATCH_WRITE","value":0},
            {"kind":"SOUNDLATCH_WRITE","value":42}]
        mame=[{"kind":"AUDIO_RESET_WRITE","value":1},
              {"kind":"SOUNDLATCH_WRITE","value":0},
              {"kind":"Z80_LATCH_READ","value":0},
              {"kind":"SOUNDLATCH_WRITE","value":42},
              {"kind":"YM2203_WRITE","value":17}]
        self.assertEqual(mod.compare_commands(js,mame)["status"],"MATCHED_LATCH_COMMANDS_ONLY")
        self.assertFalse(mod.compare_commands(js,mame)["timing_verified"])
        self.assertEqual(mod.compare_commands(js,mame[:2])["status"],"DIFFERENT_COMMAND_STREAM")
        self.assertEqual(mod.compare_commands([],mame)["status"],"BLOCKED_NO_COMMANDS")

    def test_invalid_command_rejected_and_jsonl_loaded(self):
        with tempfile.TemporaryDirectory() as d:
            path=Path(d)/"events.jsonl"
            path.write_text(json.dumps({"kind":"SOUNDLATCH_WRITE","value":13})+"\n")
            self.assertEqual(mod.read_events(path)[0]["value"],13)
            path.write_text('{"kind":"SOUNDLATCH_WRITE","value":256}\n')
            with self.assertRaises(ValueError):
                mod.read_events(path)


if __name__ == "__main__":
    unittest.main()
