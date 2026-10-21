"""ROM-free tests for one-pass inspection of existing Blackbox MAME sessions."""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "review_blackbox_capture", ROOT / "scripts/review_blackbox_capture.py")
review = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = review
spec.loader.exec_module(review)


class BlackboxCaptureReviewTests(unittest.TestCase):
    def make_session(self, root: Path, *, start=True, mismatch=False) -> Path:
        session = root / "blackbox-t1"
        session.mkdir()
        plan = []
        actual = []
        for frame in range(1600):
            buttons = []
            if 950 <= frame < 960:
                buttons = ["coin"]
            if 1020 <= frame < 1025:
                buttons = ["start"]
            plan.append({"frame": frame, "buttons": buttons})
            observed = list(buttons)
            if not start and "start" in observed:
                observed.clear()
            if mismatch and frame == 20:
                observed.append("left")
            actual.append({"frame": frame, "buttons": observed})
        (session / "input_plan.json").write_text(json.dumps(plan))
        (session / "input_timeline.json").write_text(json.dumps(actual))
        (session / "mame.log").write_text(
            "blackbox_harness:start\nblackbox_harness:input_plan:loaded:1600\n"
            "blackbox_harness:stop\n")
        (session / "capture.avi").write_bytes(b"video-is-not-real-in-tests")
        return session

    def test_real_input_contract_is_distinct_from_gameplay(self):
        with tempfile.TemporaryDirectory() as tmp:
            session = self.make_session(Path(tmp))
            result = review.analyze(session)
            self.assertEqual(result["input_gate"], "MATCHED")
            self.assertEqual(result["buttons"]["coin"]["actual_count"], 10)
            self.assertEqual(result["buttons"]["start"]["actual_count"], 5)
            self.assertEqual(result["boot_mismatch_count"], 0)
            self.assertEqual(result["gameplay_gate"], "VISUAL_UNVERIFIED")
            self.assertEqual(result["rom_state_gate"], "NOT_CAPTURED_BY_AVI")
            private = ROOT / "out"
            private.mkdir(exist_ok=True)
            with tempfile.TemporaryDirectory(dir=private) as output:
                folder = Path(output)
                review.write_review(result, folder, [])
                page = (folder / "index.html").read_text()
                self.assertIn("SIN VERIFICAR VISUALMENTE", page)
                self.assertIn("Coin observado: 10", page)
                self.assertEqual(json.loads((folder / "summary.json").read_text())
                                 ["input_gate"], "MATCHED")

    def test_missing_start_blocks_input_gate(self):
        with tempfile.TemporaryDirectory() as tmp:
            result = review.analyze(self.make_session(Path(tmp), start=False))
            self.assertEqual(result["input_gate"], "BLOCKED")
            self.assertEqual(result["buttons"]["start"]["actual_count"], 0)
            self.assertGreater(result["boot_mismatch_count"], 0)

    def test_unexpected_boot_input_blocks_gate(self):
        with tempfile.TemporaryDirectory() as tmp:
            result = review.analyze(self.make_session(Path(tmp), mismatch=True))
            self.assertEqual(result["input_gate"], "BLOCKED")
            self.assertEqual(result["first_boot_mismatch"], 20)

    def test_explicit_mame_lua_fault_blocks_gate(self):
        with tempfile.TemporaryDirectory() as tmp:
            session = self.make_session(Path(tmp))
            with (session / "mame.log").open("a") as stream:
                stream.write("blackbox_harness:input_button:unmapped:start\n")
            result = review.analyze(session)
            self.assertEqual(result["input_gate"], "BLOCKED")
            self.assertTrue(result["log_faults"])

    def test_missing_or_invalid_session_fails_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            with self.assertRaisesRegex(ValueError, "evidence"):
                review.analyze(folder)
            session = self.make_session(folder)
            (session / "input_timeline.json").write_text(
                json.dumps([{"frame": 7, "buttons": ["coin"]},
                            {"frame": 7, "buttons": ["coin"]}]))
            with self.assertRaisesRegex(ValueError, "duplicate"):
                review.analyze(session)

    def test_empty_and_malformed_frames_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp)/"plan.json"
            for data in ([], {"frame": 1}, [{"frame": 1}],
                         [{"frame": 1, "buttons": ["coin", "coin"]}]):
                with self.subTest(data=data):
                    p.write_text(json.dumps(data))
                    with self.assertRaises(ValueError):
                        review.read_frames(p)


if __name__ == "__main__":
    unittest.main()
