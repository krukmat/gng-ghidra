"""ROM-free D6 full oracle: explicit reset epochs and fail-closed witness."""
from __future__ import annotations

import contextlib
import hashlib
import io
import json
import sys
import tempfile
import unittest
from argparse import Namespace
from pathlib import Path
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/"scripts"))
sys.path.insert(0,str(ROOT/"tests"))
import a063_bank_oracle_gate as oracle
import a063_capture_integrity as integrity
import a063_trace_contract as contract
import r3_bank_provenance as provenance
from r2_pretrace_report import extract
from test_r3_bank_provenance import banks,signature_line


def synthetic_full():
    """Invented bytes/registers only; no game or native emulator evidence."""
    packed=banks()
    fixed=bytearray(65536)
    fixed[0x6010:0x6013]=b"\xf7\x3e\x00"
    rows=[]
    selected=[]
    lines=[]
    for i in range(300):
        j=i%150
        if i==150:
            lines.append("GNG_A063_RESET EPOCH=1")
        bank=0 if j<=10 else 3
        pc=0x6010 if j==10 else 0x6013 if j==11 else 0x4000
        row={"schema":"gng.r2.pre-instruction.v1","kind":"pre_instruction",
             "origin":"mame-native-tracelog","seq":i,"pc":pc,
             "before":{"PC":pc,"A":i%256,"B":3 if j==10 else 0,
                       "X":0,"Y":0,"U":0,"S":0,"DP":0,"CC":0},
             "trace_line":len(lines)+1}
        rows.append(row)
        selected.append(bank)
        lines.append(signature_line(row,bank,packed,(0,1))+
                     f" GNG_A063_ENTRY E={bank:02X}")
    observations="\n".join((
        "PROBE\tr2-mame-capability-v1","DRIVER\tgngb",
        "SPRITE_RAM_TAP_ENABLED\t1","A04_VIDEO_WRITE_TAP_ENABLED\t1",
        "R36_TARGETED_READ_ENABLED\t1","R36_UNMAP_POLICY_ENABLED\t1",
        "BANK_INITIAL_OBSERVED\t0",
        "BANK_CONTROL_WRITE_SAMPLE\t0\t24592\t15872\t3\t0",
        "SOFT_RESET_REQUESTED\t1\t16384",
        "RESET_NOTIFICATION\t1\t24576","A063_ORACLE_RESET_EPOCH\t1",
        "BANK_CONTROL_WRITE_SAMPLE\t1\t24592\t15872\t3\t0",
        "CONTROLLED_SOFT_RESET_REQUESTED\t1","OBSERVED_RESET_COUNT\t1",
        "OBSERVED_BANK_CONTROL_WRITE_COUNT\t2","PROBE_END\tframe-limit",""))
    return packed,bytes(fixed),rows,selected,"\n".join(lines)+"\n",observations


class FullOracleTests(unittest.TestCase):
    def setUp(self):
        (self.packed,self.fixed,self.rows,self.banks,
         self.raw,self.observations)=synthetic_full()

    def evaluate(self,*,raw=None,rows=None,observations=None):
        raw=self.raw if raw is None else raw
        rows=self.rows if rows is None else rows
        obs=self.observations if observations is None else observations
        mapped=provenance.parse_debugger_bank_signatures(raw,rows,self.packed,(0,1))
        live=oracle.parse_driver_entries(raw,rows)
        epochs=oracle.parse_full_epochs(raw,rows,obs)
        return oracle.compare_full(mapped,live,rows,epochs,self.fixed,self.packed,obs)

    def test_all_prestate_pairs_and_both_explicit_epochs_pass(self):
        result=self.evaluate()
        self.assertEqual(result["status"],oracle.FULL_PASS)
        self.assertEqual(result["rom_pair_vs_live_bank_comparisons"],300)
        self.assertEqual(result["native_prestate_count_by_epoch"],{"0":150,"1":150})
        self.assertEqual(result["verified_post_selector_bank_transitions"],2)
        self.assertEqual(result["reset_bank_changes_excluded_from_selector_transitions"],1)
        self.assertFalse(result["native_full_r2_execution_equivalence_proven"])
        mini=oracle.compare(self.banks,self.banks,{
            "sampled_control_writes_before_handler":2,"native_soft_reset_notifications":1})
        self.assertEqual(mini["status"],"INCONCLUSIVE_NO_UNINTERRUPTED_BANK_TRANSITION")

    def test_corrupted_e_signature_duplicate_or_orphan_never_passes(self):
        cases=[self.raw.replace("E=00","E=01",1),
               self.raw.replace("E=00","E=05",1),
               self.raw.replace("E=00","E=00 E=00",1),
               self.raw.replace("S0=01","S0=FE",1),
               self.raw+"GNG_A063_ENTRY E=00\n",
               self.raw+self.raw.splitlines()[-1]+"\n"]
        for raw in cases:
            with self.subTest(shape=raw[:20]),self.assertRaises(ValueError):
                self.evaluate(raw=raw)

    def test_missing_duplicated_or_unordered_reset_delimiters_fail(self):
        cases=[self.raw.replace("GNG_A063_RESET EPOCH=1\n",""),
               self.raw.replace("EPOCH=1","EPOCH=2"),
               self.raw.replace("GNG_A063_RESET EPOCH=1\n",
                                "GNG_A063_RESET EPOCH=1\nGNG_A063_RESET EPOCH=1\n"),
               self.raw.replace("GNG_A063_RESET EPOCH=1\n",
                                "GNG_A063_RESET EPOCH=1 "),
               self.raw+"GNG_A063_RESET EPOCH=2\n"]
        for raw in cases:
            with self.subTest(),self.assertRaises(ValueError):
                self.evaluate(raw=raw)

    def test_reset_tsv_counts_and_order_are_mandatory(self):
        cases=[self.observations.replace("A063_ORACLE_RESET_EPOCH\t1\n",""),
               self.observations.replace("OBSERVED_RESET_COUNT\t1","OBSERVED_RESET_COUNT\t0"),
               self.observations.replace("CONTROLLED_SOFT_RESET_REQUESTED\t1",
                                         "CONTROLLED_SOFT_RESET_REQUESTED\t0"),
               self.observations+"A063_ORACLE_RESET_EPOCH\t1\n",
               self.observations.replace(
                   "RESET_NOTIFICATION\t1\t24576\nA063_ORACLE_RESET_EPOCH\t1",
                   "A063_ORACLE_RESET_EPOCH\t1\nRESET_NOTIFICATION\t1\t24576")]
        for obs in cases:
            with self.subTest(),self.assertRaises(ValueError):
                self.evaluate(observations=obs)

    def test_repeated_pc_still_requires_seq_cpu_and_physical_trace_line(self):
        import copy
        cases=[]
        for key,value in (("seq",3),("trace_line",1),("trace_line",None)):
            rows=copy.deepcopy(self.rows)
            rows[2][key]=value
            cases.append(rows)
        rows=copy.deepcopy(self.rows)
        rows[2]["before"]["A"]=255
        cases.append(rows)
        rows=copy.deepcopy(self.rows)
        rows[2]["seq"]=True
        cases.append(rows)
        for rows in cases:
            with self.subTest(),self.assertRaises(ValueError):
                self.evaluate(rows=rows)

    def test_reset_pc_pattern_cannot_replace_an_explicit_delimiter(self):
        rows=self.rows
        rows[10]["pc"]=0x6016
        rows[11]["pc"]=0x6000
        with self.assertRaisesRegex(ValueError,"UNATTRIBUTED_NON_RESET"):
            oracle.compare_full(self.banks,self.banks,rows,[0]*150+[1]*150,
                                self.fixed,self.packed,self.observations)

    def test_selector_poststate_cannot_disagree_or_cross_epoch(self):
        wrong=self.banks.copy()
        wrong[11:150]=[2]*139
        with self.assertRaisesRegex(ValueError,"POST_SELECTOR_BANK_DISAGREEMENT"):
            oracle.compare_full(wrong,wrong,self.rows,[0]*150+[1]*150,
                                self.fixed,self.packed,self.observations)
        epochs=[0]*11+[1]*289
        with self.assertRaisesRegex(ValueError,"UNATTRIBUTED_NON_RESET"):
            oracle.compare_full(self.banks,self.banks,self.rows,epochs,
                                self.fixed,self.packed,self.observations)

    def test_absent_selector_transition_is_inconclusive(self):
        fixed=bytes(65536)
        stable=[0]*300
        observations=(self.observations.replace(
            "BANK_CONTROL_WRITE_SAMPLE\t0\t24592\t15872\t3\t0\n","").replace(
            "BANK_CONTROL_WRITE_SAMPLE\t1\t24592\t15872\t3\t0\n","").replace(
            "OBSERVED_BANK_CONTROL_WRITE_COUNT\t2","OBSERVED_BANK_CONTROL_WRITE_COUNT\t0"))
        result=oracle.compare_full(stable,stable,self.rows,[0]*150+[1]*150,
                                   fixed,self.packed,observations)
        self.assertTrue(result["status"].startswith("INCONCLUSIVE"))
        self.assertFalse(result["native_bank_per_instruction_full_run_proven"])

    def test_independent_write_values_epochs_and_complete_count_are_bound(self):
        for obs in (self.observations.replace("15872\t3\t0","15872\t2\t0",1),
                    self.observations.replace("15872\t3\t0","15872\t3\t1",1)):
            with self.subTest(),self.assertRaisesRegex(ValueError,"WRITE_ORDER_OR_DATA"):
                self.evaluate(observations=obs)
        inflated=self.observations.replace("OBSERVED_BANK_CONTROL_WRITE_COUNT\t2",
                                            "OBSERVED_BANK_CONTROL_WRITE_COUNT\t3")
        self.assertTrue(self.evaluate(observations=inflated)["status"].startswith("INCONCLUSIVE"))
        missing=self.observations.replace(
            "BANK_CONTROL_WRITE_SAMPLE\t1\t24592\t15872\t3\t0\n","")
        self.assertTrue(self.evaluate(observations=missing)["status"].startswith("INCONCLUSIVE"))
        moved=self.observations.replace(
            "BANK_CONTROL_WRITE_SAMPLE\t0\t24592\t15872\t3\t0\n","").replace(
            "A063_ORACLE_RESET_EPOCH\t1\n",
            "A063_ORACLE_RESET_EPOCH\t1\nBANK_CONTROL_WRITE_SAMPLE\t0\t24592\t15872\t3\t0\n")
        with self.assertRaisesRegex(ValueError,"WRITE_ORDER_OR_DATA"):
            self.evaluate(observations=moved)


class FullReportTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name).resolve()
        for name in contract.SOURCE_FILES:
            path=self.root/name
            path.parent.mkdir(parents=True,exist_ok=True)
            path.write_text("synthetic public source fixture\n")
        self.mame=self.root/"fake-mame"
        self.mame.write_text('#!/bin/sh\necho "MAME fixture 0.289"\n')
        self.mame.chmod(0o755)
        self.output=self.root/contract.FULL_ORACLE_OUTPUT
        self.output.mkdir(parents=True)
        self.reportdir=self.root/"out/r3/banked-provenance"
        self.reportdir.mkdir(parents=True)
        self.preflight=self.root/contract.FULL_ORACLE_PREFLIGHT
        self.packed,self.fixed,rows,_,raw,obs=synthetic_full()
        (self.output/"cpu.trace").write_text(raw)
        parsed=extract(self.output/"cpu.trace",self.output/"pre-instruction.jsonl")
        self.assertEqual(parsed["status"],"PRE_INSTRUCTION_FORMAT_PARSED")
        (self.output/"pretrace-report.json").write_text(json.dumps(parsed))
        (self.output/"observations.tsv").write_text(obs)
        (self.output/"mame.log").write_text("synthetic fixture\n")
        (self.output/"capabilities.json").write_text(json.dumps({
            "status":"PARTIAL_NATIVE_INSTRUMENTATION",
            "capabilities":{"controlled_soft_reset_observed":True}}))
        self.args=Namespace(zip=self.root/"roms/gng.zip",flat=self.root/"out/gngb-flat.bin",
            banks=self.root/"out/r3/banked-rom/private-banked-rom.bin",
            output=self.reportdir,trace=self.output/"pre-instruction.jsonl",
            rawtrace=self.output/"cpu.trace",observations=self.output/"observations.tsv",
            preflight=self.preflight,mame_bin=str(self.mame))
        for path,data in ((self.args.flat,self.fixed),(self.args.banks,self.packed)):
            path.parent.mkdir(parents=True,exist_ok=True)
            path.write_bytes(data)
        (self.reportdir/"private-signature-offsets.json").write_text(
            json.dumps({"offsets":[0,1]}))
        contract.create_preflight("4000","4001",str(self.mame),self.preflight,
                                  root=self.root,oracle=True,full_oracle=True)
        action=contract.build_action("4000","4001",oracle=True)
        (self.output/"start-debugger.txt").write_text(
            f"trace {self.output/'cpu.trace'},:maincpu,noloop,{action}\ng\n")
        result=integrity.capture_postflight(self.root,self.output,self.preflight,
            "4000","4001",str(self.mame),0,
            identity={"git_head":"a"*40,"tracked_tree_clean":True})
        self.assertTrue(result["capture_artifacts_complete"])

    def run_report(self):
        with (patch.object(provenance,"ROOT",self.root),
              patch.object(provenance,"load_authenticated_images",
                           return_value=(self.packed,self.fixed)),
              contextlib.redirect_stdout(io.StringIO()) as output):
            provenance.run_report(self.args)
            return output.getvalue()

    def assert_no_witness(self):
        self.assertFalse((self.reportdir/"private-bank-per-prestate.jsonl").exists())
        self.assertFalse((self.output/"private-a063-full-oracle-check.json").exists())

    def test_real_chain_and_synthetic_oracle_create_private_same_run_manifest(self):
        stdout=self.run_report()
        self.assertIn(oracle.FULL_PASS,stdout)
        self.assertNotIn("bank_pc_pairs",stdout)
        witness=self.reportdir/"private-bank-per-prestate.jsonl"
        rows=[json.loads(line) for line in witness.read_text().splitlines()]
        self.assertEqual([row["epoch"] for row in rows],[0]*150+[1]*150)
        manifest=json.loads((self.reportdir/"private-source-manifest.json").read_text())
        paths={"flat":self.args.flat,"banks":self.args.banks,"trace":self.args.trace,
            "rawtrace":self.args.rawtrace,"observations":self.args.observations,
            "capabilities":self.output/"capabilities.json","preflight":self.preflight,
            "postflight":self.output/"private-a063-postflight.json","witness":witness,
            "bank_report":self.reportdir/"report.json",
            "full_oracle":self.output/"private-a063-full-oracle-check.json"}
        self.assertEqual(manifest["sha256"],{
            name:hashlib.sha256(path.read_bytes()).hexdigest() for name,path in paths.items()})
        self.assertEqual(witness.stat().st_mode&0o777,0o600)
        with self.assertRaisesRegex(ValueError,"EXISTS_PRESERVE"):
            self.run_report()

    def test_corrupted_same_run_chain_or_binary_cannot_create_a_witness(self):
        for path in (self.args.rawtrace,self.mame,
                     self.root/"scripts/r2-mame-probe.lua"):
            original=path.read_bytes()
            path.write_bytes(original+b"altered fixture\n")
            with self.subTest(role=path.name),self.assertRaises(ValueError):
                self.run_report()
            self.assert_no_witness()
            path.write_bytes(original)

    def test_existing_artifact_collision_preserves_it_and_creates_no_witness(self):
        path=self.reportdir/"private-source-manifest.json"
        path.write_text("preserved fixture\n")
        with self.assertRaisesRegex(ValueError,"EXISTS_PRESERVE"):
            self.run_report()
        self.assertEqual(path.read_text(),"preserved fixture\n")
        self.assert_no_witness()

    def test_self_consistent_capture_hashes_do_not_hide_a_single_e_mismatch(self):
        self.args.rawtrace.write_text(self.args.rawtrace.read_text().replace("E=00","E=01",1))
        postflight=self.output/"private-a063-postflight.json"
        saved=json.loads(postflight.read_text())
        saved["artifacts_sha256"]["cpu.trace"]=hashlib.sha256(self.args.rawtrace.read_bytes()).hexdigest()
        postflight.write_text(json.dumps(saved))
        with self.assertRaisesRegex(ValueError,"ROM_BANK_DISAGREEMENT"):
            self.run_report()
        self.assert_no_witness()

    def test_authentic_offsets_must_match_preflight_debugger_operands(self):
        # The chain can be intact yet describe a different debugger action.
        with patch.object(provenance,"choose_signature_offsets",return_value=(0,2)):
            config=self.reportdir/"private-signature-offsets.json"
            config.write_text(json.dumps({"offsets":[0,2]}))
            with self.assertRaisesRegex(ValueError,"PREFLIGHT_OFFSETS_NOT_AUTHENTIC"):
                self.run_report()
        self.assert_no_witness()


if __name__=="__main__":
    unittest.main()
