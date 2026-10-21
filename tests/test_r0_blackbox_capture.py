"""ROM-free tests: Blackbox gameplay is the only input injector during R0 capture."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/"scripts"))
sys.path.insert(0,str(ROOT/"tests"))

from r0_blackbox_capture_validate import validate_blackbox_capture
from test_mame_visual_oracle import reference_fixture


class BlackboxNativeCaptureTests(unittest.TestCase):
    def setup_fixture(self, folder: Path):
        ref=folder/"reference"
        reference_fixture(ref,driver="gngb",frame=1550)
        timeline=folder/"input_timeline.json"
        timeline.write_text(json.dumps([{"frame":1550,"buttons":["right"]}]))
        baseline=folder/"baseline.json"
        baseline.write_text(json.dumps({
            "schema":"gng.blackbox-baseline.v1",
            "gameplay_inputs_observed":True,
            "last_frame":2300
        }))
        return ref,timeline,baseline

    def test_authentic_capture_contract_from_mocked_mame_data(self):
        (ROOT/"out").mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=ROOT/"out") as temp:
            ref,timeline,baseline=self.setup_fixture(Path(temp))
            actual=validate_blackbox_capture(ref,1550,"gngb",timeline,baseline)
            self.assertEqual(actual["frame"],1550)
            self.assertEqual(actual["capture_flow"],
                             "PINNED_BLACKBOX_AUTOPLAY_WITH_GNG_R0_VIDEO_OBSERVER")
            self.assertTrue(actual["gameplay_inputs_observed"])
            self.assertFalse(actual["actual_gameplay_frame_verified"])
            self.assertFalse(actual["js_pixel_equivalence_verified"])
            self.assertEqual(actual["blackbox_effective_timeline_sha256"],
                             hashlib.sha256(timeline.read_bytes()).hexdigest())
            self.assertEqual(json.loads((ref/"manifest.json").read_text()),actual)

    def test_absent_sprite_dma_or_unsafe_path_blocks_evidence(self):
        (ROOT/"out").mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=ROOT/"out") as temp:
            ref,timeline,baseline=self.setup_fixture(Path(temp))
            (ref/"sprites-buffered.bin").unlink()
            with self.assertRaisesRegex(ValueError,"Missing MAME VRAM"):
                validate_blackbox_capture(ref,1550,"gngb",timeline,baseline)
        with tempfile.TemporaryDirectory() as temp:
            ref,timeline,baseline=self.setup_fixture(Path(temp))
            with self.assertRaisesRegex(ValueError,"PRIVATE_IN_OUT"):
                validate_blackbox_capture(ref,1550,"gngb",timeline,baseline)

    def test_missing_gameplay_timeline_gate_blocks(self):
        (ROOT/"out").mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=ROOT/"out") as temp:
            ref,timeline,baseline=self.setup_fixture(Path(temp))
            original=json.loads(baseline.read_text())
            original["gameplay_inputs_observed"]=False
            baseline.write_text(json.dumps(original))
            with self.assertRaisesRegex(ValueError,"BASELINE_NOT_VERIFIED"):
                validate_blackbox_capture(ref,1550,"gngb",timeline,baseline)

    def test_capture_is_opt_in_and_original_script_is_unchanged(self):
        source=(ROOT/"scripts/r0-blackbox-baseline.sh").read_text()
        self.assertIn('MAME_SCRIPT="$BB/scripts/mame_autoboot.lua"',source)
        self.assertIn('if [[ -n "$R0_FRAME" ]]',source)
        self.assertIn('cat "$BB/scripts/mame_autoboot.lua"',source)
        self.assertIn('cat "$ROOT/scripts/capture-mame-frame.lua"',source)
        self.assertIn("GNG_CAPTURE_KEEP_RUNNING=1",source)
        self.assertIn('--expect-gameplay',source)
        wrapper=(ROOT/"scripts/r0-blackbox-frame.sh").read_text()
        self.assertIn('GNG_BLACKBOX_CAPTURE_FRAME:-1550',wrapper)
        self.assertIn("frame-compare.html",wrapper)
        self.assertIn("GNG_BLACKBOX_R0=PHASE_1_ORIGINAL_BLACKBOX_ONLY",wrapper)
        self.assertIn("GNG_BLACKBOX_R0=PHASE_2_VIDEO_MEMORY_OBSERVER",wrapper)
        self.assertIn("env -u GNG_BLACKBOX_CAPTURE_FRAME",wrapper)
        baseline=(ROOT/"scripts/r0-blackbox-baseline.sh").read_text()
        self.assertIn("GNG_BLACKBOX_DIAG=INPUT_TIMELINE_FLUSH_NOT_OBSERVED",baseline)
        self.assertIn("GNG_BLACKBOX_DIAG=INPUT_TIMELINE_EARLY_FLUSH",baseline)
        self.assertIn("GNG_BLACKBOX_REAL_VIDEO_FRAME=",baseline)
        self.assertIn("blackbox_effective_input_timeline_missing",baseline)
        lua=(ROOT/"scripts/capture-mame-frame.lua").read_text()
        self.assertIn("if not keep_running then machine:exit() end",lua)
        self.assertIn("gng_capture_frame_subscription",lua)
        if shutil.which("bash"):
            for path in ("scripts/r0-blackbox-baseline.sh","scripts/r0-blackbox-frame.sh"):
                result=subprocess.run(["bash","-n",str(ROOT/path)],
                                      capture_output=True,text=True,timeout=10)
                self.assertEqual(result.returncode,0,result.stderr)


if __name__=="__main__":
    unittest.main()
