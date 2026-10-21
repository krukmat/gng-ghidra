"""ROM-free tests for the pinned upstream Blackbox gameplay integration."""
from __future__ import annotations
import json
import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/"scripts"))
from r0_blackbox_gameplay import remap_gameplay_plan
spec=importlib.util.spec_from_file_location("r0_blackbox_verify",
                                            ROOT/"scripts/r0_blackbox_verify.py")
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class BlackboxGameplayTests(unittest.TestCase):
    def mock_plan(self):
        rows=[{"frame":i,"buttons":[]} for i in range(2050)]
        for start,stop,name in ((950,960,"coin"),(1020,1025,"start"),
                                (1505,1565,"right"),(1565,1595,"button1"),
                                (1635,1655,"button2")):
            for row in rows[start:stop]:
                row["buttons"].append(name)
        return rows

    def test_upstream_jump_fire_mapped_to_gngb_hardware(self):
        actual,report=remap_gameplay_plan(self.mock_plan())
        self.assertEqual(actual[950]["buttons"],["coin"])
        self.assertEqual(actual[1020]["buttons"],["start"])
        self.assertEqual(actual[1505]["buttons"],["right"])
        self.assertEqual(actual[1565]["buttons"],["button2"])
        self.assertEqual(actual[1635]["buttons"],["button1"])
        self.assertEqual(report["frames"],2050)
        self.assertEqual(len(report["sha256"]),64)

    def test_missing_gameplay_actions_fail_closed(self):
        rows=self.mock_plan()
        for row in rows:
            if "right" in row["buttons"]: row["buttons"].remove("right")
        with self.assertRaisesRegex(ValueError,"MOVEMENT_MISSING"):
            remap_gameplay_plan(rows)

    def test_empty_or_changed_coin_start_timings_fail(self):
        for action,expected in (("coin","COIN_TIMING_CHANGED"),
                                ("start","START_TIMING_CHANGED")):
            rows=self.mock_plan()
            for row in rows:
                if action in row["buttons"]: row["buttons"].remove(action)
            with self.assertRaisesRegex(ValueError,expected):
                remap_gameplay_plan(rows)

    def test_effective_gameplay_timeline_is_required(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            timeline=root/"timeline.json"
            avi=root/"capture.avi"
            avi.write_bytes(b"0"*2048)
            plan, _=remap_gameplay_plan(self.mock_plan())
            timeline.write_text(json.dumps(plan))
            report=module.verify(timeline,avi,expect_gameplay=True)
            self.assertTrue(report["gameplay_inputs_observed"])
            self.assertGreaterEqual(report["right_frames"],60)
            self.assertGreaterEqual(report["jump_frames"],30)
            self.assertGreaterEqual(report["attack_frames"],20)
            self.assertFalse(report["gameplay_verified"])

    def test_credit_without_player_motion_does_not_pass(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            timeline=root/"timeline.json"
            avi=root/"capture.avi"
            avi.write_bytes(b"0"*2048)
            plan,_=remap_gameplay_plan(self.mock_plan())
            for row in plan:
                row["buttons"]=[b for b in row["buttons"] if b in ("coin","start")]
            timeline.write_text(json.dumps(plan))
            with self.assertRaisesRegex(ValueError,"INPUT_MISSING_RIGHT"):
                module.verify(timeline,avi,expect_gameplay=True)

    def test_launcher_uses_real_upstream_gameplay(self):
        source=(ROOT/"scripts/r0-blackbox-baseline.sh").read_text()
        self.assertIn("plans/generated/gng_gameplay.yaml",source)
        self.assertIn("mame_autoboot.lua",source)
        self.assertIn("--expect-gameplay",source)
        self.assertIn("-seconds_to_run 40",source)
        self.assertNotIn("r0-bot-sequence.json",source)
        self.assertIn("if [[ -n \"$R0_FRAME\" ]]",source)
        self.assertIn("combined-autoboot.lua",source)
        self.assertIn("capture-mame-frame.lua",source)
        self.assertIn("MAME_SCRIPT=\"$BB/scripts/mame_autoboot.lua\"",source)


if __name__ == "__main__":
    unittest.main()
