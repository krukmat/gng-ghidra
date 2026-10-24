"""ROM-free driver-symbol vs ROM-signature oracle tests."""
from __future__ import annotations
import sys
import unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/"scripts"))
sys.path.insert(0,str(ROOT/"tests"))
import a063_trace_contract as contract
import a063_bank_oracle_gate as oracle
from test_r3_bank_provenance import banks,rows,signature_line
from r3_bank_provenance import parse_debugger_bank_signatures

class NativeOracleTests(unittest.TestCase):
    def setUp(self):
        self.rom=banks()
        self.rows=rows()
        self.banks=[0,0,3,3,3,0]
        self.lines=[signature_line(r,b,self.rom,(0,1))+f" GNG_A063_ENTRY E={b:02X}"
                    for r,b in zip(self.rows,self.banks)]
        self.sample={"sampled_control_writes_before_handler":1}

    def test_one_action_twelve_args_no_mask(self):
        action=contract.build_action("4000","5000",oracle=True)
        self.assertEqual(action.count("tracelog"),1)
        self.assertIn("GNG_A063_ENTRY E=%02X",action)
        self.assertTrue(action.endswith(",b@4000,b@5000,gng_a063_bank}"))
        self.assertEqual(len(action.split('",',1)[-1].rstrip('}').split(',')),12)
        contract.validate_action(action,"4000","5000",oracle=True)
        self.assertNotIn("&255",action)

    def test_legacy_stays_eleven_args(self):
        action=contract.build_action("4000","5000")
        self.assertEqual(len(action.split('",',1)[-1].rstrip('}').split(',')),11)
        self.assertNotIn("GNG_A063_ENTRY",action)

    def test_exact_per_instruction_bank_agreement_no_full_claim(self):
        trace="\n".join(self.lines)
        attested=parse_debugger_bank_signatures(trace,self.rows,self.rom,(0,1))
        native=oracle.parse_driver_entries(trace,self.rows)
        self.assertEqual(attested,native)
        summary=oracle.compare(attested*60,native*60,self.sample)
        self.assertEqual(summary["status"],"A063_ORACLE_MINIPROBE_NATIVE_MATCHED_NOT_FULL_A063")
        self.assertFalse(summary["native_bank_per_instruction_full_run_proven"])

    def test_mismatch_rejected_even_single_instruction(self):
        lines=self.lines.copy()
        lines[2]=lines[2].replace("GNG_A063_ENTRY E=03","GNG_A063_ENTRY E=01")
        trace="\n".join(lines)
        rom=parse_debugger_bank_signatures(trace,self.rows,self.rom,(0,1))
        actual=oracle.parse_driver_entries(trace,self.rows)
        with self.assertRaisesRegex(ValueError,"DISAGREEMENT"):
            oracle.compare(rom,actual,self.sample)

    def test_absent_duplicate_invalid_out_of_range_or_orphaned(self):
        trace="\n".join(self.lines)
        cases=[trace.replace("GNG_A063_ENTRY E=00","",1),
               trace.replace("E=00","E=00 E=00",1),
               trace.replace("E=00","E=FF",1),
               trace.replace("E=00","E=GG",1),
               trace+"\nGNG_A063_ENTRY E=01"]
        for case in cases:
            with self.subTest(case=case[:24]),self.assertRaises(ValueError):
                oracle.parse_driver_entries(case,self.rows)

    def test_byte_sign_extension_never_accepted(self):
        trace="\n".join(self.lines).replace("S0=01","S0=FFFFFF80",1)
        with self.assertRaisesRegex(ValueError,"SIGNATURE_EXCEEDS_BYTE"):
            parse_debugger_bank_signatures(trace,self.rows,self.rom,(0,1))

    def test_insufficient_coverage_or_transition_is_inconclusive(self):
        self.assertEqual(oracle.compare(self.banks,self.banks,self.sample)["status"],
                         "INCONCLUSIVE_TOO_FEW_PRESTATES")
        self.assertEqual(oracle.compare([0]*300,[0]*300,self.sample)["status"],
                         "INCONCLUSIVE_NO_UNINTERRUPTED_BANK_TRANSITION")
        self.assertEqual(oracle.compare(self.banks*60,self.banks*60,
                         {"sampled_control_writes_before_handler":0})["status"],
                         "INCONCLUSIVE_NO_UNINTERRUPTED_BANK_TRANSITION")

    def test_reset_disqualifies_transition(self):
        s={"sampled_control_writes_before_handler":1,
           "native_soft_reset_notifications":1}
        result=oracle.compare(self.banks*60,self.banks*60,s)
        self.assertEqual(result["status"],"INCONCLUSIVE_NO_UNINTERRUPTED_BANK_TRANSITION")

    def test_invalid_native_samples_never_pass(self):
        cases=[
            {"sampled_control_writes_before_handler":1,
             "unparseable_native_bank_samples":1},
            {"sampled_control_writes_before_handler":2,
             "total_bank_control_writes":1},
        ]
        for sample in cases:
            with self.subTest(sample=sample), self.assertRaises(ValueError):
                oracle.compare(self.banks*60,self.banks*60,sample)

    def test_impossible_transition_count_rejected(self):
        # Two mapped bank changes cannot follow a single write and no reset.
        s={"sampled_control_writes_before_handler":1,
           "total_bank_control_writes":1,"native_soft_reset_notifications":0}
        with self.assertRaisesRegex(ValueError,"TRANSITIONS_EXCEED_CONTROL_WRITES"):
            oracle.compare(self.banks*60,self.banks*60,s)

    def test_corrupt_bank_sequence_fails(self):
        for a,b in [([0],[True]),([0],[5]),([0],[0,0]),([],[])]:
            with self.subTest(a=a,b=b),self.assertRaises(ValueError):
                oracle.compare(a,b,self.sample)

if __name__=="__main__":
    unittest.main()
