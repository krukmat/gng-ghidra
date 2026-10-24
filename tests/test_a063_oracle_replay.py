"""ROM-free R2.B3 five-bank replay and adversarial mutation regression."""
from __future__ import annotations
import sys
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/"scripts"))
import a063_oracle_replay as replay

class R2BReplayTests(unittest.TestCase):
    def test_fourteen_adversarial_scenarios(self):
        result=replay.replay_cases()
        self.assertEqual(result["cases"],16)
        self.assertEqual(result["passed"],16,result["failed_case_names"])
        self.assertEqual(result["status"],"PASS")
        self.assertTrue(result["synthetic_trace_only"])
        self.assertFalse(result["native_bank_provenance_proven"])

    def test_five_distinct_synthetic_banks(self):
        image=replay.build_synthetic_five_banks()
        self.assertEqual(len(image),5*8192)
        signatures={(image[i*8192],image[i*8192+1]) for i in range(5)}
        self.assertEqual(len(signatures),5)
        raw,rows=replay.fake_capture([4,0,1,2,3])
        self.assertEqual(len(raw.splitlines()),5)
        self.assertEqual([row["seq"] for row in rows],list(range(5)))
        self.assertEqual([row["trace_line"] for row in rows],list(range(1,6)))

    def test_repeated_pcs_do_not_shift_instruction_alignment(self):
        raw,rows=replay.fake_capture([4]*75+[0]*75+[1]*75+[2]*75+[3]*75)
        self.assertLess(len({r["pc"] for r in rows}),len(rows))
        result=replay.strict_check(raw,rows)
        self.assertEqual(result["rom_pair_vs_live_bank_mismatch_count"],0)
        self.assertFalse(result["native_bank_per_instruction_full_run_proven"])

if __name__=="__main__":
    unittest.main()
