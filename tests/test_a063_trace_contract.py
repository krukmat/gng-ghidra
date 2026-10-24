"""A0.6.3-R1 ROM-free contract tests: no ROM or native MAME dependency."""
import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/"scripts"))
import a063_trace_contract as contract

class TraceContractTests(unittest.TestCase):
    def test_exact_one_line_trace_action_eleven_arguments(self):
        action=contract.build_action("4000","5FFF")
        self.assertEqual(action.count("tracelog"),1)
        self.assertIn(contract.CPU_FORMAT,action)
        self.assertIn(contract.SIGNATURE_FORMAT,action)
        self.assertTrue(action.endswith(",b@4000,b@5fff}"))
        self.assertEqual(len(action.split('",',1)[-1].rstrip('}').split(',')),11)
        contract.validate_action(action,"4000","5FFF")
        self.assertNotIn("&255",action)

    def test_invalid_offsets_reject_before_emulator(self):
        cases=[("4000","4000"),("3fff","4000"),("4000","6000"),
               ("4000","0x5000"),("4000","51000"),("4000","5f_z"),
               ("4000\nprint 1","5000"),("","5FFF"),("5000","5000")]
        for a,b in cases:
            with self.subTest(a=a,b=b),self.assertRaises(contract.ContractError):
                contract.build_action(a,b)

    def test_template_tampering_detected(self):
        action=contract.build_action("4000","4001")
        for tampered in [action.replace("b@4000","w@4000"),
                         action.replace("S0=%02X","S0=%04X"),
                         action.replace("pc,a,b,x","pc,b,a,x"),
                         action.replace("b@4001","b@4001&ff"),
                         action+";tracelog bad"]:
            with self.subTest(tampered=tampered),self.assertRaisesRegex(
                    contract.ContractError,"ACTION_MISMATCH"):
                contract.validate_action(tampered,"4000","4001")

    def test_manifest_records_environment_but_never_attests_native(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td)
            scripts=root/"scripts"
            scripts.mkdir()
            for file in ("r2-mame-probe.sh","r3-bank-provenance-capture.sh",
                         "r3_bank_provenance.py","a063_trace_contract.py"):
                (scripts/file).write_text("rom-free source for test\n")
            mame=root/"fake-mame"
            mame.write_text('#!/bin/sh\necho "MAME 0.289-test"\n')
            mame.chmod(0o755)
            private=root/"out/r3/smoke/private-preflight.json"
            output=contract.create_preflight("4000","5000",str(mame),private,root=root)
            self.assertEqual(output["status"],"A063_R1_PREFLIGHT_ONLY_NOT_NATIVE_PROVENANCE")
            self.assertFalse(output["bank_identity_per_instruction_proven"])
            self.assertFalse(output["native_capture_was_executed"])
            self.assertEqual(len(output["source_sha256"]),4)
            self.assertEqual(output["emulator_binary_sha256"],hashlib.sha256(mame.read_bytes()).hexdigest())
            saved=private.read_text()
            self.assertNotIn(str(root),saved)
            self.assertNotIn("b@4000",saved)
            self.assertNotIn("b@5000",saved)
            self.assertEqual(private.stat().st_mode & 0o777,0o600)
            self.assertEqual(contract.create_preflight("4000","5000",str(mame),private,root=root),output)
            with self.assertRaisesRegex(contract.ContractError,"STALE_CAPTURE"):
                contract.create_preflight("4000","5001",str(mame),private,root=root)

    def test_manifest_refuses_public_or_unscoped_location(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td)
            for output in (root/"report.json",root/"out/r2/private-preflight.json",
                           root/"out/r3/public.json"):
                with self.assertRaisesRegex(contract.ContractError,"PRIVATE_MANIFEST"):
                    contract.create_preflight("4000","5000","no-such-mame",output,root=root)

    def test_triage_17135_aligned_overflow_never_passes(self):
        summary=contract.classify_diagnostic(self.sample_diagnostic())
        self.assertEqual(summary["decision"],"R1_REQUIRE_NATIVE_READ_CAUSE_ISOLATION")
        self.assertFalse(summary["native_provenance_verified"])
        self.assertFalse(summary["lowbyte_mask_accepted_as_proof"])
        self.assertNotIn("pc",json.dumps(summary).lower())
        self.assertNotIn("signature",json.dumps(summary).lower())

    def test_triage_even_all_byte_values_only_ready_for_private_parser(self):
        diagnostic=self.sample_diagnostic()
        diagnostic["native_pair_width_out_of_byte_range"]=0
        diagnostic["first_signature_values_exceed_byte"]=0
        diagnostic["second_signature_values_exceed_byte"]=0
        self.assertEqual(contract.classify_diagnostic(diagnostic)["decision"],
                         "R1_READY_FOR_PRIVATE_STRICT_PARSER_ONLY")

    def test_triage_requires_alignment_and_rejects_impossible_counts(self):
        d=self.sample_diagnostic()
        d["matched_format_pc_mismatch_count"]=1
        self.assertEqual(contract.classify_diagnostic(d)["decision"],
                         "R1_REQUIRE_TRACE_ALIGNMENT_REPAIR")
        for key,value in [("native_pair_width_out_of_byte_range",-1),
                          ("trace_lines_with_both_markers",17136),
                          ("first_signature_values_exceed_byte",17136),
                          ("native_prestate_count",True)]:
            sample=self.sample_diagnostic()
            sample[key]=value
            with self.subTest(key=key),self.assertRaises(contract.ContractError):
                contract.classify_diagnostic(sample)

    @staticmethod
    def sample_diagnostic():
        n=17135
        return {
            "schema":contract.DIAGNOSTIC_SCHEMA,
            "native_prestate_count":n,
            "trace_lines_with_cpu_pre_marker":n,
            "trace_lines_with_bank_signature_marker":n,
            "trace_lines_with_both_markers":n,
            "trace_lines_with_formatted_cpu_pc_and_pair":n,
            "native_pair_width_out_of_byte_range":n,
            "first_signature_values_exceed_byte":n,
            "second_signature_values_exceed_byte":n,
            "matched_format_pc_mismatch_count":0,
            "matched_format_cpu_register_mismatch_count":0,
            "matched_format_original_trace_line_mismatch_count":0,
        }

if __name__=="__main__":
    unittest.main()
