"""ROM-free tests for one-pass inspection of existing Blackbox MAME sessions."""
from __future__ import annotations

import importlib.util
import json
import shutil
import subprocess
from unittest.mock import patch
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
            self.assertEqual(result["coin_start_gate"], "MATCHED")
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
            self.assertEqual(result["coin_start_gate"], "BLOCKED")

    def test_unexpected_boot_input_blocks_gate(self):
        with tempfile.TemporaryDirectory() as tmp:
            result = review.analyze(self.make_session(Path(tmp), mismatch=True))
            self.assertEqual(result["input_gate"], "BLOCKED")
            self.assertEqual(result["first_boot_mismatch"], 20)
            self.assertEqual(result["coin_start_gate"], "MATCHED")
            self.assertEqual(result["boot_mismatch_samples"][0], {
                "frame":20,"planned":[],"observed":["left"]})

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


    def test_ffmpeg_error_is_exposed_without_replaying_mame(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            session = self.make_session(root)
            dest = root/"frames"
            fake_probe = subprocess.CompletedProcess(
                ["ffprobe"], 0,
                stdout=json.dumps({"streams":[{"width":256,"height":224,
                    "avg_frame_rate":"60/1","nb_frames":"1700"}],
                    "format":{"duration":"28.3"}}), stderr="")
            fake_error = subprocess.CompletedProcess(
                ["ffmpeg"], 1, stdout="", stderr="decoder failed: bogus codec")
            report = {"last_observed_frame":1599}
            with patch.object(review.shutil, "which", return_value="/usr/bin/tool"), \
                 patch.object(review.subprocess, "run",
                              side_effect=[fake_probe]+[fake_error]*7):
                frames = review.collect_video(session, dest, report)
            self.assertEqual(frames, [])
            self.assertEqual(report["video_inspection"], "FFMPEG_EXTRACT_FAILED")
            self.assertIn("decoder failed", report["ffmpeg_error"])

    @unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"),
                         "ffmpeg/ffprobe not installed")
    def test_extract_frames_from_small_synthetic_avi(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            session = root/"session"
            session.mkdir()
            command = ["ffmpeg","-hide_banner","-loglevel","error",
                       "-f","lavfi","-i",
                       "testsrc=size=64x64:rate=30:duration=1.5",
                       "-frames:v","40","-c:v","ffv1","-y",
                       str(session/"capture.avi")]
            created = subprocess.run(command, capture_output=True,
                                     text=True, timeout=45, check=False)
            self.assertEqual(created.returncode, 0, created.stderr)
            report = {"last_observed_frame":39}
            with patch.object(review, "VISUAL_FRAMES", (0, 9, 21, 35)):
                frames = review.collect_video(session, root/"frames", report)
            self.assertEqual(report["video_inspection"],
                             "FRAMES_EXTRACTED_FOR_HUMAN_REVIEW",
                             report.get("ffmpeg_error"))
            self.assertEqual([num for num, _ in frames], [0,9,21,35])
            for _, filename in frames:
                self.assertTrue((root/"frames"/filename).stat().st_size > 0)

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
