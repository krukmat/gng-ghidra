"""ROM-free tests for original Blackbox baseline bridge."""
from __future__ import annotations
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location("blackbox_verifier",
                                            ROOT/"scripts/r0_blackbox_verify.py")
mod=importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class BlackboxBaselineTests(unittest.TestCase):
    def make_files(self,folder,*,coin=True,start=True,frames=1510):
        timeline=folder/"input_timeline.json"
        data=[]
        for f in range(frames+1):
            buttons=[]
            if coin and 950<=f<960: buttons.append("coin")
            if start and 1020<=f<1025: buttons.append("start")
            data.append({"frame":f,"buttons":buttons})
        timeline.write_text(json.dumps(data))
        video=folder/"capture.avi"
        video.write_bytes(b"A"*2048)
        return timeline,video

    def test_inputs_do_not_prove_gameplay(self):
        with tempfile.TemporaryDirectory() as tmp:
            timeline,video=self.make_files(Path(tmp))
            report=mod.verify(timeline,video)
            self.assertEqual(report["status"],
                "INPUTS_OBSERVED_VIDEO_RECORDED_GAMEPLAY_UNVERIFIED")
            self.assertEqual(report["coin_observed_frames"],10)
            self.assertEqual(report["start_observed_frames"],5)
            self.assertFalse(report["gameplay_verified"])

    def test_missing_coin_start_or_stage_timing_blocks(self):
        for config,reason in [
            ({"coin":False},"COIN_NOT_OBSERVED"),
            ({"start":False},"START_NOT_OBSERVED"),
            ({"frames":1200},"ENDED_BEFORE_STAGE")]:
            with self.subTest(config=config),tempfile.TemporaryDirectory() as tmp:
                timeline,video=self.make_files(Path(tmp),**config)
                with self.assertRaisesRegex(ValueError,reason):
                    mod.verify(timeline,video)

    def test_missing_video_and_bad_timeline_fail_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            timeline,video=self.make_files(Path(tmp))
            video.unlink()
            with self.assertRaisesRegex(ValueError,"VIDEO_MISSING"):
                mod.verify(timeline,video)
            video.write_bytes(b"A"*2048)
            timeline.write_text("{}")
            with self.assertRaisesRegex(ValueError,"TIMELINE_EMPTY"):
                mod.verify(timeline,video)

    def test_launcher_uses_upstream_pinned_scripts_not_our_bot(self):
        path=ROOT/"scripts/r0-blackbox-baseline.sh"
        s=path.read_text()
        self.assertIn("99722c3900b63e13185c52824c0adec3df7f44c1",s)
        self.assertIn("scripts/launch_manual_capture_autoboot.sh",s)
        self.assertIn("original_blackbox_runtime_failed",s)
        self.assertNotIn("capture-mame-frame.lua",s)
        self.assertNotIn("r0-bot-sequence.json",s)
        if shutil.which("bash"):
            completed=subprocess.run(["bash","-n",str(path)],
                                     capture_output=True,text=True,timeout=10)
            self.assertEqual(completed.returncode,0,completed.stderr)


if __name__=="__main__":
    unittest.main()
