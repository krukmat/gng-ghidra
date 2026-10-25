"""ROM-free integration: synthetic raw trace -> R2 prestate extractor -> A063 dual oracle.

This suite deliberately uses NO ROM, MAME, or unverifiable source attribution.
It verifies that real parsers agree on trace position, registers and bank.
"""
from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from a063_oracle_replay import fake_capture, build_synthetic_five_banks
from a063_bank_oracle_gate import parse_driver_entries, compare
from a063_trace_contract import build_action, CPU_SYMBOLS
from r2_pretrace_report import extract
from r3_bank_inventory import BANK_SIZE
from r3_bank_provenance import parse_debugger_bank_signatures


def synthetic_window():
    return fake_capture([bank for bank in (4, 0, 1, 2, 3) for _ in range(75)])


def tracer_order_window(*, oracle=True, strip_separator=False, live_entry=None):
    """Render the real action before invented MAME-style disassembly.

    MAME executes tracelog first, then writes the instruction PC without
    adding a separator. The action must terminate its own last value.
    """
    entries = [bank for bank in (4, 0, 1, 2, 3) for _ in range(75)]
    _, templates = fake_capture(entries)
    image = build_synthetic_five_banks()
    action = build_action("4000", "4001", oracle=oracle)
    format_text = action.split('"', 2)[1]
    if strip_separator:
        format_text = format_text.rstrip()
    rows = []
    lines = []
    edge_pcs = (0x4000, 0x0000, 0x0004, 0x00FF, 0xFFFF)
    for index, (entry, template) in enumerate(zip(entries, templates)):
        pc = edge_pcs[index % len(edge_pcs)]
        cpu = {**template["before"], "PC": pc}
        rows.append({**template, "pc": pc, "before": cpu})
        args = tuple(cpu[name.upper()] for name in CPU_SYMBOLS)
        args += (image[entry * BANK_SIZE], image[entry * BANK_SIZE + 1])
        if oracle:
            args += (entry if live_entry is None else live_entry,)
        lines.append((format_text % args) + f"{pc:04X}: synthetic instruction")
    return "\n".join(lines), rows, entries


class R2ToOracleIntegration(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.trace = Path(self.temp.name) / "cpu.trace"
        self.out = Path(self.temp.name) / "pre-instruction.jsonl"

    def parse(self, raw):
        self.trace.write_text(raw, encoding="utf-8")
        status = extract(self.trace, self.out)
        rows = ([json.loads(line) for line in
                 self.out.read_text(encoding="utf-8").splitlines()]
                if self.out.is_file() else [])
        return status, rows

    def test_complete_synthetic_window_passes_both_real_parsers(self):
        trace, expected_rows = synthetic_window()
        report, rows = self.parse(trace)
        self.assertEqual(report["status"], "PRE_INSTRUCTION_FORMAT_PARSED")
        self.assertEqual(report["snapshots"], 375)
        self.assertFalse(report["provenance_authenticated"])
        self.assertEqual(rows, expected_rows)
        rom = parse_debugger_bank_signatures(
            trace, rows, build_synthetic_five_banks(), (0, 1))
        live = parse_driver_entries(trace, rows)
        self.assertEqual(rom, live)
        sample = {"sampled_control_writes_before_handler": 4,
                  "total_bank_control_writes": 4,
                  "native_soft_reset_notifications": 0}
        outcome = compare(rom, live, sample)
        self.assertEqual(
            outcome["status"],
            "A063_ORACLE_MINIPROBE_NATIVE_MATCHED_NOT_FULL_A063")
        self.assertFalse(outcome["native_bank_per_instruction_full_run_proven"])

    def test_action_then_disassembly_preserves_all_banks_and_edge_pcs(self):
        trace, expected_rows, expected_banks = tracer_order_window()
        report, rows = self.parse(trace)
        self.assertEqual(report["status"], "PRE_INSTRUCTION_FORMAT_PARSED")
        self.assertEqual(rows, expected_rows)
        mapped = parse_debugger_bank_signatures(
            trace, rows, build_synthetic_five_banks(), (0, 1))
        live = parse_driver_entries(trace, rows)
        self.assertEqual(mapped, expected_banks)
        self.assertEqual(live, expected_banks)
        outcome = compare(mapped, live, {
            "sampled_control_writes_before_handler": 4,
            "total_bank_control_writes": 4,
            "native_soft_reset_notifications": 0,
        })
        self.assertEqual(outcome["rom_pair_vs_live_bank_comparisons"], 375)
        self.assertFalse(outcome["native_bank_per_instruction_full_run_proven"])

    def test_legacy_action_also_delimits_last_signature_before_disassembly(self):
        trace, expected_rows, expected_banks = tracer_order_window(oracle=False)
        report, rows = self.parse(trace)
        self.assertEqual(report["status"], "PRE_INSTRUCTION_FORMAT_PARSED")
        self.assertEqual(rows, expected_rows)
        mapped = parse_debugger_bank_signatures(
            trace, rows, build_synthetic_five_banks(), (0, 1))
        self.assertEqual(mapped, expected_banks)
        self.assertNotIn("GNG_A063_ENTRY", trace)

    def test_missing_action_separator_remains_rejected_without_truncation(self):
        for oracle in (True, False):
            with self.subTest(oracle=oracle):
                trace, _, _ = tracer_order_window(
                    oracle=oracle, strip_separator=True)
                report, rows = self.parse(trace)
                self.assertEqual(report["status"], "PRE_INSTRUCTION_FORMAT_PARSED")
                if oracle:
                    # The two ROM reads remain valid: only the final E token
                    # consumes the following four hexadecimal PC digits.
                    parse_debugger_bank_signatures(
                        trace, rows, build_synthetic_five_banks(), (0, 1))
                    with self.assertRaisesRegex(
                            ValueError, "A063_ORACLE_BANK_OUT_OF_RANGE"):
                        parse_driver_entries(trace, rows)
                else:
                    with self.assertRaisesRegex(
                            ValueError, "A063_NATIVE_SIGNATURE_EXCEEDS_BYTE"):
                        parse_debugger_bank_signatures(
                            trace, rows, build_synthetic_five_banks(), (0, 1))

    def test_delimited_genuinely_invalid_live_entries_remain_rejected(self):
        for entry in (5, 255, 256, 0xFFFFFFFFFFFFFFFF):
            with self.subTest(entry=entry):
                trace, _, _ = tracer_order_window(live_entry=entry)
                report, rows = self.parse(trace)
                self.assertEqual(report["status"], "PRE_INSTRUCTION_FORMAT_PARSED")
                parse_debugger_bank_signatures(
                    trace, rows, build_synthetic_five_banks(), (0, 1))
                with self.assertRaisesRegex(
                        ValueError, "A063_ORACLE_BANK_OUT_OF_RANGE"):
                    parse_driver_entries(trace, rows)

    def test_split_signature_rejected_by_bank_parser(self):
        trace, _ = synthetic_window()
        lines = trace.splitlines()
        lines[12] = lines[12].replace(
            " GNG_A06_BANKSIG", "\nGNG_A06_BANKSIG", 1)
        malformed = "\n".join(lines)
        report, rows = self.parse(malformed)
        self.assertEqual(report["status"], "PRE_INSTRUCTION_FORMAT_PARSED")
        with self.assertRaisesRegex(ValueError, "MARKERS_NOT_SAME_INSTRUCTION"):
            parse_debugger_bank_signatures(
                malformed, rows, build_synthetic_five_banks(), (0, 1))

    def test_malformed_duplicate_cpu_prestates_not_emitted(self):
        trace, _ = synthetic_window()
        lines = trace.splitlines()
        lines[12] += " GNG_R2_PRE PC=4000"
        report, rows = self.parse("\n".join(lines))
        self.assertEqual(report["status"], "INSTRUMENTATION_BLOCKED")
        self.assertFalse(rows)
        self.assertFalse(report["provenance_authenticated"])

    def test_wrong_cpu_value_aligned_to_old_snapshot_rejected(self):
        trace, expected_rows = synthetic_window()
        bad = trace.splitlines()
        bad[3] = bad[3].replace("A=03", "A=FE", 1)
        modified = "\n".join(bad)
        report, new_rows = self.parse(modified)
        self.assertEqual(report["status"], "PRE_INSTRUCTION_FORMAT_PARSED")
        self.assertNotEqual(new_rows[3]["before"], expected_rows[3]["before"])
        with self.assertRaisesRegex(ValueError, "REGISTERS_AND_PRESTATE"):
            parse_debugger_bank_signatures(
                modified, expected_rows, build_synthetic_five_banks(), (0, 1))

    def test_orphan_live_bank_marker_rejected(self):
        trace, _ = synthetic_window()
        trace += "\nGNG_A063_ENTRY E=04"
        report, rows = self.parse(trace)
        self.assertEqual(report["status"], "PRE_INSTRUCTION_FORMAT_PARSED")
        with self.assertRaisesRegex(ValueError, "MISSING_OR_DUPLICATE_MARKER"):
            parse_driver_entries(trace, rows)


if __name__ == "__main__":
    unittest.main()
