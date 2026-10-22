#!/usr/bin/env python3
"""A0.6 ROM-free bank inventory and private image materialization tests."""
from __future__ import annotations
import io
import json
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import r3_bank_inventory as bank


class BankInventoryTests(unittest.TestCase):
    def test_control_value_formula_exhaustively(self):
        for value in range(256):
            expected = 4 if value == 4 else value & 3
            self.assertEqual(bank.bank_entry_from_control(value), expected)
        for invalid in (-1, 256, True, 1.5, "4"):
            with self.assertRaises(ValueError):
                bank.bank_entry_from_control(invalid)

    def test_five_authentic_bank_offsets_preserve_gg4_fixed_segment(self):
        gg4 = bytes(i % 256 for i in range(0x4000))
        gg5 = bytes((i // 8192 + 10) for i in range(0x8000))
        flat = bytearray(0x10000)
        flat[0x4000:0x8000] = gg4
        flat[0xfffe:0x10000] = b"\x60\x00"
        with tempfile.TemporaryDirectory() as folder:
            file = Path(folder) / "test.zip"
            with zipfile.ZipFile(file, "w") as archive:
                archive.writestr("path/gg5.bin", gg5)
                archive.writestr("path/gg4.bin", gg4)
            with patch.object(bank, "read_rom", return_value=(bytes(flat), {})):
                packed, image = bank.assemble_banks(file)
            self.assertEqual(image, bytes(flat))
            self.assertEqual(len(packed), 5 * 0x2000)
            for i in range(4):
                self.assertEqual(packed[i * 0x2000:(i+1)*0x2000],
                                 gg5[i * 0x2000:(i+1)*0x2000])
            self.assertEqual(packed[4 * 0x2000:], gg4[:0x2000])

    def test_native_samples_are_only_frame_and_write_tap_observations(self):
        tsv = "\n".join([
            "PROBE\tr2-mame-capability-v1",
            "BANK_INITIAL_OBSERVED\t4",
            "FRAME_SAMPLE\t1\t24600\t4",
            "BANK_CONTROL_WRITE_SAMPLE\t1\t24599\t15872\t1\t4",
            "FRAME_SAMPLE\t2\t24604\t1",
            "BANK_CONTROL_WRITE_SAMPLE\t2\t24605\t15872\t4\t1",
            "RESET_NOTIFICATION\t2\t24576",
            "FRAME_SAMPLE\t3\t24576\t4",
            "OBSERVED_BANK_CONTROL_WRITE_COUNT\t2",
            "PROBE_END\tframe-limit",
            "",
        ])
        result = bank.analyze_native_bank_samples(tsv)
        self.assertEqual(result["bank_initial_observed_entry"], 4)
        self.assertEqual(result["sampled_frame_bank_entries"]["4"], 2)
        self.assertEqual(result["sampled_frame_bank_entries"]["1"], 1)
        self.assertEqual(result["total_bank_control_writes"], 2)
        self.assertEqual(result["sampled_control_writes_before_handler"], 2)
        self.assertEqual(result["expected_selected_bank_entries_from_control_data"]["1"], 1)
        self.assertEqual(result["expected_selected_bank_entries_from_control_data"]["4"], 1)
        self.assertEqual(result["native_soft_reset_notifications"], 1)
        self.assertFalse(result["complete_bank_switch_edges_proven"])
        self.assertFalse(result["bank_entry_for_each_instruction_proven"])

    def test_incomplete_malformed_and_multiple_probe_reports_reject(self):
        good = ("BANK_INITIAL_OBSERVED\t0\n"
                "OBSERVED_BANK_CONTROL_WRITE_COUNT\t0\n"
                "PROBE_END\tframe-limit\n")
        for invalid in [
            good.replace("BANK_INITIAL_OBSERVED\t0\n", ""),
            good.replace("PROBE_END\tframe-limit\n", ""),
            good.replace("WRITE_COUNT\t0", "WRITE_COUNT\tgarbled"),
            good.replace("WRITE_COUNT\t0", "WRITE_COUNT\t0") +
                "PROBE_END\tframe-limit\n",
            good.replace("WRITE_COUNT\t0", "WRITE_COUNT\t0") +
                "BANK_INITIAL_OBSERVED\t0\n",
        ]:
            with self.assertRaises(ValueError):
                bank.analyze_native_bank_samples(invalid)
        self.assertEqual(bank.analyze_native_bank_samples(good)
                         ["sampled_control_writes_before_handler"], 0)

    def test_pc_coverage_is_not_bank_entry_attribution(self):
        pcs = [0x6000, 0x4000, 0x4a21, 0x4000, 0x5fff, 0x6016]
        lines = []
        for seq, pc in enumerate(pcs):
            lines.append(json.dumps({
                "schema": "gng.r2.pre-instruction.v1",
                "kind": "pre_instruction",
                "origin": "mame-native-tracelog",
                "seq": seq,
                "pc": pc, "before": {"PC": pc}
            }))
        trace = "\n".join(lines)
        result = bank.count_trace_banked_pcs(trace)
        self.assertEqual(result["bank_window_pc_samples"], 4)
        self.assertEqual(result["distinct_bank_window_pcs"], 3)
        self.assertEqual(result["native_preinstruction_samples"], 6)
        lines[1] = lines[1].replace('"seq": 1', '"seq": 5')
        with self.assertRaises(ValueError):
            bank.count_trace_banked_pcs("\n".join(lines))

    def test_private_output_is_confined_to_ignored_out_r3(self):
        (ROOT / "out" / "r3").mkdir(parents=True, exist_ok=True)
        self.assertTrue(bank.private_destination(
            ROOT / "out" / "r3" / "banked-rom"))
        self.assertFalse(bank.private_destination(ROOT / "docs"))
        self.assertFalse(bank.private_destination(ROOT / "src"))
        self.assertFalse(bank.private_destination(ROOT / "out" / "r3"))


if __name__ == "__main__":
    unittest.main()
