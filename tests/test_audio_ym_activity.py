"""ROM-free YM register activity profiler test, no captured game content."""
import io
import json
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))
import audio_ym_activity as profile
import audio_b3_checkpoint as b3


class YMActivityTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name) / "audio"
        self.root.mkdir()
        self.old_private = b3.PRIVATE
        b3.PRIVATE = self.root
        self.addCleanup(lambda: setattr(b3, "PRIVATE", self.old_private))

    def tape(self, rows):
        source = self.root / "private-synth.jsonl"
        source.write_text("\n".join(json.dumps(row) for row in rows) + "\n")
        return source

    @staticmethod
    def write(seq, tick, port, value):
        return {"kind": "YM2203_WRITE", "seq": seq,
                "frame": tick // 200000, "tick12m": tick,
                "address": port, "value": value}

    def test_sound_onset_after_first_five_seconds_is_aggregate_only(self):
        # YM key-on command after initialization in the *next* window.
        t = [
            self.write(1, 0, 0xe000, 0x22),
            self.write(2, 1, 0xe001, 0x00),
            self.write(3, 60_000_010, 0xe000, 0x28),
            self.write(4, 60_000_011, 0xe001, 0xf0),
            self.write(5, 60_000_012, 0xe002, 0x08),
            self.write(6, 60_000_013, 0xe003, 0x0f),
        ]
        report = profile.activity(self.tape(t))
        self.assertEqual(report["ym_port_writes_total"], 6)
        self.assertEqual(report["five_second_windows"][0]["fm_key_on_commands"], 0)
        self.assertEqual(report["five_second_windows"][1]["fm_key_on_commands"], 1)
        self.assertEqual(report["five_second_windows"][1]["psg_positive_volume_writes"], 1)
        self.assertEqual(report["first_window_with_voice_activity_commands"], "5-10")
        self.assertFalse(report["audibility_verified"])
        self.assertNotIn('"value"', json.dumps(report))
        self.assertNotIn("57344", json.dumps(report))

    def test_ym_regression_not_repaired_and_report_does_not_echo_events(self):
        tape = self.tape([
            self.write(1, 100, 0xe000, 0x28),
            self.write(2, 99, 0xe001, 0xf0)
        ])
        with self.assertRaisesRegex(b3.B3Stop, "TAPE_YM_ACTIVITY_INVALID"):
            profile.activity(tape)

    def test_cli_rejects_tape_outside_private_dir(self):
        tape = Path(self.tmp.name) / "outside.jsonl"
        tape.write_text("{}\n")
        buf = io.StringIO()
        with patch.object(b3, "verify_repository_privacy", return_value=True), \
             redirect_stdout(buf):
            rc = profile.main(["--tape", str(tape)])
        self.assertEqual(rc, 2)
        self.assertEqual(json.loads(buf.getvalue())["status"], "STOP")
        self.assertNotIn(str(tape), buf.getvalue())


if __name__ == "__main__":
    unittest.main()
