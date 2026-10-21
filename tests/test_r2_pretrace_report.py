"""ROM-free tests for MAME native pre-instruction debugger trace parser."""
from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "r2_pretrace_report", ROOT / "scripts/r2_pretrace_report.py"
)
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)

VALID = (
    'GNG_R2_PRE PC=6000 A=01 B=FE X=1234 Y=CAFE U=8000 S=2FFC DP=00 CC=D0'
)
NEXT = (
    'GNG_R2_PRE PC=6001 A=02 B=FE X=1234 Y=CAFE U=8000 S=2FFC DP=00 CC=D0'
)


def files(root, text):
    raw = root / "cpu.trace"
    out = root / "pre-instruction.jsonl"
    raw.write_text(text, encoding="utf-8")
    return raw, out


class NativePretraceTests(unittest.TestCase):
    def test_real_formatted_native_records_preserve_exact_registers(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            raw, output = files(
                root,
                "6000: NOP  " + VALID + "\n" +
                "6001: LDA #01\n" + NEXT + "\n",
            )
            result = module.extract(raw, output)
            self.assertEqual(result["status"], "PRE_INSTRUCTION_FORMAT_PARSED")
            self.assertEqual(result["snapshots"], 2)
            self.assertEqual(result["distinct_pc_count"], 2)
            self.assertFalse(result["full_r2_trace_verified"])
            self.assertFalse(result["after_state_available"])
            self.assertFalse(result["irq_or_sync_entry_verified"])
            rows = [json.loads(v) for v in output.read_text().splitlines()]
            self.assertEqual([item["pc"] for item in rows], [0x6000, 0x6001])
            self.assertEqual([item["seq"] for item in rows], [0, 1])
            self.assertEqual(rows[0]["before"]["A"], 1)
            self.assertEqual(rows[0]["before"]["CC"], 0xD0)
            self.assertEqual(rows[0]["before"]["S"], 0x2FFC)
            self.assertEqual(rows[1]["before"]["Y"], 0xCAFE)
            self.assertFalse(result["genuine_cpu_execution_verified"])
            self.assertFalse(result["provenance_authenticated"])

    def test_absent_action_is_not_a_preinstruction_pass(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            raw, out = files(root, "6000: NOP\n6001: STA $3000\n")
            r = module.extract(raw, out)
            self.assertEqual(r["status"], "INSTRUMENTATION_BLOCKED")
            self.assertEqual(r["snapshots"], 0)
            self.assertFalse(out.exists())

    def test_partial_or_malformed_register_record_is_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            raw, out = files(root, VALID + "\n" + NEXT[:-6] + "\n")
            r = module.extract(raw, out)
            self.assertEqual(r["status"], "INSTRUMENTATION_BLOCKED")
            self.assertEqual(r["markers_seen"], 2)
            self.assertEqual(r["malformed_markers"], 1)
            self.assertFalse(out.exists())

    def test_all_markers_malformed_reports_only_redacted_structure(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            raw, out = files(root, "GNG_R2_PRE PC=0x6000 A=%02X B=FE" + "\n" +
                             "GNG_R2_PRE PC=0x6001 A=%02X B=FD" + "\n")
            result = module.extract(raw, out)
            self.assertEqual(result["status"], "INSTRUMENTATION_BLOCKED")
            self.assertEqual(result["markers_seen"], 2)
            self.assertEqual(result["snapshots"], 0)
            self.assertEqual(result["malformed_markers"], 2)
            shape = result["malformed_shapes_redacted"][0]
            self.assertEqual(shape["fields_present"], 3)
            self.assertTrue(shape["field_shapes"]["PC"]["prefix_0x"])
            self.assertTrue(shape["field_shapes"]["A"]["literal_percent_format"])
            self.assertFalse(shape["field_shapes"]["CC"]["present"])
            diagnostic = json.dumps(result)
            self.assertNotIn("6000", diagnostic)
            self.assertNotIn("%02X", diagnostic)
            self.assertFalse(out.exists())

    def test_duplicated_marker_per_line_is_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            raw, out = files(root, VALID + " " + NEXT + "\n")
            r = module.extract(raw, out)
            self.assertEqual(r["status"], "INSTRUMENTATION_BLOCKED")
            self.assertFalse(out.exists())

    def test_empty_or_missing_native_trace_is_blocked(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            raw, out = files(root, "")
            self.assertEqual(module.extract(raw, out)["status"], "INSTRUMENTATION_BLOCKED")
            raw.unlink()
            self.assertEqual(module.extract(raw, out)["status"], "INSTRUMENTATION_BLOCKED")

    def test_mame_tracelog_action_compares_all_cpu_register_names(self):
        shell = (ROOT / "scripts/r2-mame-probe.sh").read_text()
        self.assertIn("GNG_R2_PRE PC=%04X A=%02X", shell)
        self.assertIn("X=%04X Y=%04X U=%04X S=%04X DP=%02X CC=%02X", shell)
        self.assertIn("pc,a,b,x,y,u,s,dp,cc", shell)
        self.assertIn("scripts/r2_pretrace_report.py", shell)
        self.assertNotIn("R2_TRACE_CONTRACT=PASS", shell)


if __name__ == "__main__":
    unittest.main()
