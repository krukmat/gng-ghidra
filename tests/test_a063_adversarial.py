"""Adversarial debugger trace shapes; no ROM or MAME required."""
from __future__ import annotations
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
sys.path.insert(0, str(ROOT / "tests"))
from test_r3_bank_provenance import banks, rows, signature_line
import r3_bank_provenance as provenance

class A063AdversarialTests(unittest.TestCase):
    def setUp(self):
        self.packed = banks()
        self.offsets = (0, 1)
        self.rows = rows()
        self.base = [signature_line(row, 0, self.packed, self.offsets)
                     for row in self.rows]

    def test_32bit_sign_extension_never_promoted_to_byte(self):
        trace = self.base.copy()
        trace[0] = trace[0].replace("S0=01", "S0=FFFFFF80")
        report = provenance.diagnose_trace_signatures("\n".join(trace), self.rows)
        self.assertEqual(report["nonbyte_upper_bit_shape_counts"]["one_or_both_32bit_ones"],1)
        with self.assertRaisesRegex(ValueError, "SIGNATURE_EXCEEDS_BYTE"):
            provenance.parse_debugger_bank_signatures("\n".join(trace),self.rows,self.packed,self.offsets)

    def test_64bit_sign_extension_remains_blocked(self):
        trace = self.base.copy()
        trace[0] = trace[0].replace("S0=01", "S0=FFFFFFFFFFFFFF80")
        report = provenance.diagnose_trace_signatures("\n".join(trace), self.rows)
        self.assertEqual(report["nonbyte_upper_bit_shape_counts"]["one_or_both_64bit_ones"],1)
        with self.assertRaisesRegex(ValueError, "SIGNATURE_EXCEEDS_BYTE"):
            provenance.parse_debugger_bank_signatures("\n".join(trace),self.rows,self.packed,self.offsets)

    def test_word_dword_and_cpu_argument_displacement_are_rejected(self):
        for value in ("0102","01020304","6000"):
            with self.subTest(value=value):
                trace=self.base.copy()
                trace[0]=trace[0].replace("S0=01","S0="+value)
                with self.assertRaisesRegex(ValueError,"SIGNATURE_EXCEEDS_BYTE"):
                    provenance.parse_debugger_bank_signatures(
                        "\n".join(trace),self.rows,self.packed,self.offsets)

    def test_truncated_signature_does_not_shift_remaining_rows(self):
        trace=self.base.copy()
        trace[2]=trace[2].replace("S1=01","S1=")
        diagnostic=provenance.diagnose_trace_signatures("\n".join(trace),self.rows)
        self.assertEqual(diagnostic["trace_lines_with_formatted_cpu_pc_and_pair"],len(self.rows)-1)
        with self.assertRaisesRegex(ValueError,"TRACE_MARKERS_NOT_SAME_INSTRUCTION"):
            provenance.parse_debugger_bank_signatures(
                "\n".join(trace),self.rows,self.packed,self.offsets)

    def test_duplicate_signature_field_rejected(self):
        trace=self.base.copy()
        trace[0]+=" S0=01"
        with self.assertRaisesRegex(ValueError,"TRACE_MARKERS_NOT_SAME_INSTRUCTION"):
            provenance.parse_debugger_bank_signatures(
                "\n".join(trace),self.rows,self.packed,self.offsets)

if __name__=="__main__":
    unittest.main()
