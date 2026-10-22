"""A0.6.3 ROM-free tests for authentic per-CPU-prestate bank signatures."""
from __future__ import annotations
import json
import sys
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/"scripts"))
import r3_bank_provenance as module
from r3_bank_inventory import BANK_SIZE, BANK_COUNT

def banks():
    banks=[bytearray(BANK_SIZE) for _ in range(BANK_COUNT)]
    # Uniquely identify 5 entries using two native debugger bytes.
    for i,(v0,v1) in enumerate([(1,1),(1,2),(2,1),(2,2),(3,1)]):
        banks[i][0]=v0
        banks[i][1]=v1
    return b"".join(banks)

def rows():
    def one(seq,pc,b=0):
        return {"schema":"gng.r2.pre-instruction.v1","kind":"pre_instruction",
                "origin":"mame-native-tracelog","seq":seq,"pc":pc,
                "before":{"PC":pc,"A":0,"B":b,"X":0,"Y":0,"U":0,"S":0,
                          "DP":0,"CC":0}}
    return [one(0,0x6000),one(1,0x6010,3),one(2,0x4000),
            one(3,0x4001),one(4,0x6016),one(5,0x6000)]

def signature_line(row,bank,images,offsets):
    state=row["before"]
    pc=row["pc"]
    a=images[bank*BANK_SIZE+offsets[0]]
    b=images[bank*BANK_SIZE+offsets[1]]
    cpu=(" ".join(
        f"{key}={state[key]:0{width}X}"
        for key,width in (("PC",4),("A",2),("B",2),
                          ("X",4),("Y",4),("U",4),("S",4),
                          ("DP",2),("CC",2))))
    return (f'{pc:04X}: NOP GNG_R2_PRE {cpu} '
            f'GNG_A06_BANKSIG S0={a:02X} S1={b:02X}')

def observation():
    return "\n".join(("BANK_INITIAL_OBSERVED\t0",
        "FRAME_SAMPLE\t0\t24576\t0",
        "BANK_CONTROL_WRITE_SAMPLE\t0\t24592\t15872\t3\t0",
        "FRAME_SAMPLE\t1\t16384\t3",
        "RESET_NOTIFICATION\t0\t24576",
        "OBSERVED_BANK_CONTROL_WRITE_COUNT\t1",
        "PROBE_END\tframe-limit",""))

class NativeBankSignatures(unittest.TestCase):
    def test_two_offsets_cover_all_five_banks(self):
        raw=banks()
        offsets=module.choose_signature_offsets(raw)
        self.assertEqual(offsets,(0,1))
        ids=module.signature_to_bank(raw,offsets)
        self.assertEqual(len(ids),5)
        for i in range(5):
            pair=(raw[i*BANK_SIZE+offsets[0]],
                  raw[i*BANK_SIZE+offsets[1]])
            self.assertEqual(ids[pair],i)

    def test_missing_discrimination_fails_closed(self):
        raw=b"\0"*(5*BANK_SIZE)
        with self.assertRaisesRegex(ValueError,"NO_UNIQUE"):
            module.choose_signature_offsets(raw)
        with self.assertRaisesRegex(ValueError,"AMBIGUOUS"):
            module.signature_to_bank(raw,(0,1))
        with self.assertRaisesRegex(ValueError,"REQUIRED"):
            module.choose_signature_offsets(raw[:-1])
        with self.assertRaisesRegex(ValueError,"INVALID_SIGNATURE"):
            module.signature_to_bank(banks(),(0,0))

    def test_trace_one_to_one_alignment_and_bank_id(self):
        images=banks()
        obs=rows()
        selection=[0,0,3,3,3,0]
        offsets=module.choose_signature_offsets(images)
        raw="\n".join(signature_line(r,b,images,offsets)
                      for r,b in zip(obs,selection))
        self.assertEqual(
            module.parse_debugger_bank_signatures(raw,obs,images,offsets),
            selection)

    def test_native_debugger_minimum_width_and_optional_hex_prefix(self):
        images=banks()
        obs=rows()
        selected=[0,0,3,3,3,0]
        offsets=module.choose_signature_offsets(images)
        lines=[]
        for row,bank in zip(obs,selected):
            original=signature_line(row,bank,images,offsets)
            for key in ("S0", "S1"):
                import re
                original=re.sub(
                    rf"\b{key}=([0-9A-Fa-f]{{2}})",
                    lambda m: key+"=0x"+m.group(1).rjust(8,"0"),
                    original)
            lines.append(original)
        assert module.parse_debugger_bank_signatures(
            "\n".join(lines),obs,images,offsets)==selected

    def test_same_pc_but_different_cpu_register_or_trace_line_fails_closed(self):
        images=banks()
        obs=rows()
        offsets=(0,1)
        selection=[0,0,3,3,3,0]
        trace="\n".join(signature_line(r,b,images,offsets)
                        for r,b in zip(obs,selection))
        wrong_rows=rows()
        wrong_rows[1]["before"]["B"]=4  # PC still agrees
        with self.assertRaisesRegex(ValueError,"CPU_REGISTERS_AND_PRESTATE"):
            module.parse_debugger_bank_signatures(trace,wrong_rows,images,offsets)
        correct_rows=rows()
        for i,row in enumerate(correct_rows):
            row["trace_line"]=i+1
        self.assertEqual(module.parse_debugger_bank_signatures(
            trace,correct_rows,images,offsets),selection)
        correct_rows[1]["trace_line"]=99
        with self.assertRaisesRegex(ValueError,"TRACE_LINE_NOT_ALIGNED"):
            module.parse_debugger_bank_signatures(trace,correct_rows,images,offsets)

    def test_shape_diagnosis_does_not_shift_alignment_after_malformed_pair(self):
        images=banks()
        obs=rows()
        lines=[signature_line(row,0,images,(0,1)) for row in obs]
        lines[0]=lines[0].replace("S1=","S_BAD=")
        report=module.diagnose_trace_signatures("\n".join(lines),obs)
        self.assertEqual(report["trace_lines_with_both_markers"],len(obs))
        self.assertEqual(report["trace_lines_with_formatted_cpu_pc_and_pair"],len(obs)-1)
        self.assertEqual(report["matched_format_pc_mismatch_count"],0)
        self.assertEqual(report["matched_format_cpu_register_mismatch_count"],0)
        self.assertEqual(report["matched_format_cpu_register_pairs_checked"],len(obs)-1)
        self.assertNotIn("S0=01",json.dumps(report))

    def test_duplicate_signature_marker_is_not_allowed_even_with_one_valid_pair(self):
        images=banks()
        obs=rows()
        trace="\n".join(signature_line(r,0,images,(0,1)) for r in obs)
        first=trace.splitlines()
        first[0]+=" GNG_A06_BANKSIG"
        with self.assertRaisesRegex(ValueError,"MARKERS_NOT_SAME_INSTRUCTION"):
            module.parse_debugger_bank_signatures(
                "\n".join(first),obs,images,(0,1))

    def test_non_byte_signature_is_rejected_and_shape_diagnostic_redacts(self):
        images=banks()
        obs=rows()
        offsets=module.choose_signature_offsets(images)
        lines=[signature_line(row,0,images,offsets) for row in obs]
        lines[0]=lines[0].replace("S0=01","S0=00000101")
        raw="\n".join(lines)
        with self.assertRaisesRegex(ValueError,"A063_NATIVE_SIGNATURE_EXCEEDS_BYTE"):
            module.parse_debugger_bank_signatures(raw,obs,images,offsets)
        report=module.diagnose_trace_signatures(raw,obs)
        self.assertEqual(report["trace_lines_with_both_markers"],len(obs))
        self.assertEqual(report["native_pair_width_out_of_byte_range"],1)
        self.assertFalse(report["raw_native_cpu_registers_bank_signature_bytes_or_rom_exported"])
        self.assertNotIn("00000101",json.dumps(report))
        self.assertNotIn("PC=6000",json.dumps(report))

    def test_diagnostic_identifies_split_or_unformatted_trace_without_raw_data(self):
        obs=rows()
        lines=[signature_line(row,0,banks(),(0,1)) for row in obs]
        raw="\n".join(line.replace("GNG_A06_BANKSIG","\nGNG_A06_BANKSIG")
                      for line in lines)
        report=module.diagnose_trace_signatures(raw,obs)
        self.assertEqual(report["trace_lines_with_cpu_pre_marker"],len(obs))
        self.assertEqual(report["trace_lines_with_bank_signature_marker"],len(obs))
        self.assertEqual(report["trace_lines_with_both_markers"],0)
        self.assertEqual(report["pre_lines_without_signature"],len(obs))
        self.assertEqual(report["signature_lines_without_pre"],len(obs))
        with self.assertRaisesRegex(ValueError,"A063_TRACE_MARKERS_NOT_SAME_INSTRUCTION"):
            module.parse_debugger_bank_signatures(raw,obs,banks(),(0,1))

    def test_stale_missing_ambiguous_and_foreign_native_signatures_fail(self):
        images=banks()
        obs=rows()
        offsets=module.choose_signature_offsets(images)
        lines=[signature_line(r,b,images,offsets)
               for r,b in zip(obs,[0,0,3,3,3,0])]
        corruption=[
            "\n".join(lines[:-1]),
            "\n".join(lines+[lines[-1]]),
            "\n".join(lines[:2]+[lines[2].replace("PC=4000","PC=6000")]+lines[3:]),
            "\n".join(lines[:3]+[lines[3].replace("S0=02","S0=FE")]+lines[4:]),
            "\n".join(lines[:3]+[lines[3].replace("GNG_A06_BANKSIG","BROKEN_BANKSIG")]+lines[4:]),
            "\n".join(lines[:1]+[lines[1].replace("GNG_A06_BANKSIG","GNG_A06_BANKSIG S0=00 S1=00 GNG_A06_BANKSIG")]+lines[2:]),
        ]
        for broken in corruption:
            with self.subTest(broken=broken[:130]):
                with self.assertRaisesRegex(ValueError,"A063_"):
                    module.parse_debugger_bank_signatures(
                        broken,obs,images,offsets)

    def test_transition_matches_rom_attested_bankswitch_instruction(self):
        images=banks()
        fixed=bytearray(65536)
        fixed[0x6010:0x6013]=bytes([0xf7,0x3e,0x00]) # STB $3e00
        obs=rows()
        ids=[0,0,3,3,3,0]  # last change is native soft reset
        report=module.analyze_bank_provenance(
            obs,ids,images,bytes(fixed),observation())
        self.assertEqual(report["status"],
                         "BANK_IDENTITY_AT_EVERY_NATIVE_PRESTATE_VERIFIED")
        self.assertEqual(report["native_banked_prestate_bank_identified"],2)
        self.assertEqual(report["distinct_observed_bank_pc_pairs"],2)
        self.assertEqual(report["observed_bank_counts"]["3"],2)
        self.assertEqual(report["observed_non_reset_bank_transitions"][0]
                         ["preceded_by_ROM_attested_bank_write"],True)
        self.assertEqual(report["native_bank_transition_preceded_by_known_selector_store"],1)
        self.assertFalse(report["native_cpu_bus_fetch_transaction_correlated"])
        self.assertFalse(report["bank_power_on_entry_authenticated"])
        self.assertFalse(report["IRQ_SYNC_or_game_equivalence_verified"])
        self.assertNotIn("B=3",json.dumps(report))

    def test_no_unverified_transition_is_relabelled_as_selector(self):
        images=banks()
        r=rows()
        fixed=bytes(65536)
        report=module.analyze_bank_provenance(
            r,[0,0,3,3,3,0],images,fixed,observation())
        self.assertEqual(report["native_bank_transition_preceded_by_known_selector_store"],0)
        self.assertFalse(report["observed_non_reset_bank_transitions"][0]
                         ["preceded_by_ROM_attested_bank_write"])

    def test_stock_debugger_trace_and_backup_are_wired_without_actions(self):
        shell=(ROOT/"scripts"/"r2-mame-probe.sh").read_text()
        capture=(ROOT/"scripts"/"r3-bank-provenance-capture.sh").read_text()
        self.assertIn("GNG_A06_BANKSIG S0=%02X S1=%02X",shell)
        self.assertIn("b@",shell)
        self.assertIn("GNG_R2_TRACE_MODE=printf",capture)
        self.assertIn("r3-video-write-capture.sh",capture)
        self.assertIn("r3_bank_provenance.py report",capture)
        self.assertNotIn("gh workflow",capture)

if __name__=="__main__":
    unittest.main()
