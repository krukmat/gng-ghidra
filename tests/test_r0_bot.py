"""ROM-free regression tests for the Pyjamada-inspired MAME input runner."""
from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path
from unittest import TestCase, main

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from r0_bot_sequence import prepare_sequence, check_replay, SCHEMA


class MameBotSequenceTests(TestCase):
    def sequence(self, events, *, frame=600):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp)/"bot.json"
            path.write_text(json.dumps({"schema": SCHEMA, "events": events}))
            return prepare_sequence(path, frame)

    def test_canonical_sequence_is_deterministic(self):
        events = [
            {"from": 185, "to": 191, "action": "start"},
            {"from": 120, "to": 126, "action": "coin"},
            {"from": 280, "to": 286, "action": "jump"},
        ]
        first = self.sequence(events)
        second = self.sequence(list(reversed(events)))
        self.assertEqual(first["sha256"], second["sha256"])
        self.assertEqual(first["wire"],
                         "120:126:coin;185:191:start;280:286:jump")
        self.assertEqual(len(first["sha256"]), 64)
        self.assertEqual(first["event_count"], 3)

    def test_reject_invalid_and_out_of_range_intervals(self):
        for interval in ((-1, 2), (2, 2), (599, 601), (False, 2)):
            with self.subTest(interval=interval):
                with self.assertRaisesRegex(ValueError, "invalid frame"):
                    self.sequence([{"from": interval[0], "to": interval[1],
                                    "action": "coin"}])
        with self.assertRaisesRegex(ValueError, "unknown input"):
            self.sequence([{"from": 1, "to": 2, "action": "execute_lua"}])

    def test_reject_overlaps_and_conflicting_directions(self):
        for events in (
            [{"from": 3, "to": 9, "action": "right"},
             {"from": 6, "to": 12, "action": "right"}],
            [{"from": 3, "to": 9, "action": "right"},
             {"from": 6, "to": 12, "action": "left"}],
        ):
            with self.assertRaises(ValueError):
                self.sequence(events)

    def test_replay_evidence_must_match_schedule(self):
        expected = self.sequence([{"from": 1, "to": 2, "action": "coin"}])
        evidence = {"schema": SCHEMA, "sha256": expected["sha256"],
                    "events": 1, "active_frame_actions": 1,
                    "effective_coin_frames": 1, "effective_start_frames": 1}
        self.assertEqual(check_replay({"input_replay": evidence}, expected),
                         evidence)
        for broken in (
            None, {}, {**evidence, "sha256": "0"*64},
            {**evidence, "active_frame_actions": 0},
            {**evidence, "effective_coin_frames": 0},
            {**evidence, "effective_start_frames": 0},
        ):
            with self.subTest(broken=broken):
                with self.assertRaisesRegex(ValueError, "replay evidence"):
                    check_replay({"input_replay": broken}, expected)
        self.assertIsNone(check_replay({}, None))
        with self.assertRaisesRegex(ValueError, "Unexpected"):
            check_replay({"input_replay": evidence}, None)

    def test_example_is_valid(self):
        sequence = prepare_sequence(ROOT/"scripts/r0-bot-sequence.json", 1680)
        self.assertEqual(sequence["event_count"], 5)
        self.assertIn("coin", sequence["wire"])
        self.assertIn("jump", sequence["wire"])
        self.assertIn("950:960:coin", sequence["wire"])
        self.assertIn("1020:1025:start", sequence["wire"])

    def test_capture_integration_is_explicit(self):
        capture = (ROOT/"scripts/capture_real_frame.py").read_text()
        lua = (ROOT/"scripts/capture-mame-frame.lua").read_text()
        wrapper = (ROOT/"scripts/visual-real-frame.sh").read_text()
        self.assertIn("--bot-sequence", capture)
        self.assertIn("GNG_BOT_EVENTS", capture)
        self.assertIn("bot_fields[event.action].field:set_value(1)", lua)
        self.assertIn("active_frame_actions", lua)
        self.assertIn("screen:frame_number()", lua)
        self.assertIn("port.fields[locator[2]]", lua)
        self.assertIn("field:clear_value()", lua)
        self.assertIn("-verifyroms", wrapper)
        self.assertIn("capture_checkpoint(screen:frame_number())", lua)
        self.assertIn("bot-checkpoints.html", capture)
        self.assertIn("GNG_BOT_VISUAL_GATE=PENDING_REVIEW", capture)


if __name__ == "__main__":
    main()
