"""ROM-free bank follow-up tests. Not evidence of MAME CPU equivalence."""
from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "r2_probe_report", ROOT / "scripts/r2_probe_report.py"
)
probe = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(probe)

WRITE = ("BANK_CONTROL_WRITE_SAMPLE", ["2", "24578", "15872", "4", "0"])
FOLLOWUP = ("FRAME_SAMPLE", ["3", "24581", "4"])


def classify(events):
    return probe.classify_deferred_bank_entry(events)


class R2BankFrameFollowupTests(unittest.TestCase):
    def test_exactly_one_write_and_later_expected_bank_entry(self):
        report = classify([
            ("FRAME_SAMPLE", ["2", "24578", "0"]),
            WRITE,
            ("MMIO_WRITE_SAMPLE", ["2", "24578", "15872", "4"]),
            FOLLOWUP,
        ])
        self.assertEqual(report["write_samples_examined"], 1)
        self.assertEqual(
            report["counts"]["expected_entry_visible_next_frame"], 1)
        self.assertEqual(
            report["counts"]["different_entry_seen_after_write"], 1)
        self.assertTrue(report["all_writes_resolved_at_next_frame"])
        self.assertFalse(report["post_handler_bank_edge_proven"])
        self.assertFalse(report["instruction_bus_complete"])
        # Aggregate results never copy PCs, original bytes, or ROM content.
        self.assertNotIn("24578", json.dumps(report))
        self.assertNotIn("15872", json.dumps(report))

    def test_redundant_or_post_handler_tap_is_not_a_transition(self):
        same = ("BANK_CONTROL_WRITE_SAMPLE",
                ["2", "24578", "15872", "4", "4"])
        report = classify([same, FOLLOWUP])
        self.assertEqual(report["counts"]["already_selected_at_write_tap"], 1)
        self.assertEqual(report["counts"]["different_entry_seen_after_write"], 0)
        self.assertFalse(report["post_handler_bank_edge_proven"])

    def test_wrong_followup_bank_not_reinterpreted_as_success(self):
        report = classify([WRITE, ("FRAME_SAMPLE", ["3", "24581", "3"])])
        self.assertFalse(report["all_writes_resolved_at_next_frame"])
        self.assertEqual(report["counts"]["unexpected_entry_next_frame"], 1)

    def test_multiple_writes_before_followup_are_ambiguous(self):
        second = ("BANK_CONTROL_WRITE_SAMPLE",
                  ["2", "24579", "15872", "3", "4"])
        report = classify([WRITE, second, FOLLOWUP])
        self.assertEqual(report["write_samples_examined"], 2)
        self.assertEqual(report["counts"]["multiple_writes_before_frame"], 2)
        self.assertEqual(report["counts"]["expected_entry_visible_next_frame"], 0)

    def test_reset_request_or_notification_invalidates_pending(self):
        for signal in ("SOFT_RESET_REQUESTED", "RESET_NOTIFICATION"):
            with self.subTest(signal=signal):
                report = classify([WRITE, (signal, ["2", "24578"]), FOLLOWUP])
                self.assertEqual(
                    report["counts"]["interrupted_by_reset"], 1)
                self.assertFalse(report["all_writes_resolved_at_next_frame"])

    def test_end_of_run_without_followup_remains_unconfirmed(self):
        report = classify([WRITE])
        self.assertEqual(report["counts"]["no_followup_frame"], 1)
        self.assertFalse(report["all_writes_resolved_at_next_frame"])

    def test_invalid_or_missing_frame_bank_sample_is_rejected(self):
        for later in ("unavailable", "5", "-1", "0x04", ""):
            with self.subTest(later=later):
                report = classify(
                    [WRITE, ("FRAME_SAMPLE", ["3", "24581", later])])
                self.assertEqual(report["counts"]["invalid_frame_sample"], 1)
                self.assertFalse(report["all_writes_resolved_at_next_frame"])

    def test_special_data_four_selects_four_other_values_mask_low_bits(self):
        masked_write = ("BANK_CONTROL_WRITE_SAMPLE",
                        ["2", "24578", "15872", "7", "0"])
        report = classify(
            [masked_write, ("FRAME_SAMPLE", ["3", "24581", "3"])])
        self.assertEqual(
            report["counts"]["expected_entry_visible_next_frame"], 1)

    def test_live_report_still_does_not_claim_full_bank_edge(self):
        from test_r2_mame_probe import evidence
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            evidence(folder)
            stream = folder / "observations.tsv"
            lines = stream.read_text().splitlines()
            # Insert the observed frame boundary immediately after the
            # write, before the counters.
            index = next(i for i, x in enumerate(lines)
                         if x.startswith("OBSERVED_RESET_COUNT"))
            lines.insert(index, "FRAME_SAMPLE\t3\t24581\t4")
            lines = [x.replace("OBSERVED_FRAME_COUNT\t2",
                               "OBSERVED_FRAME_COUNT\t3") for x in lines]
            stream.write_text("\n".join(lines) + "\n")
            result = probe.classify(stream, folder / "cpu.trace")
            followup = result["bank_control"]["deferred_frame_followup"]
            self.assertEqual(
                followup["counts"]["expected_entry_visible_next_frame"], 1)
            self.assertFalse(result["capabilities"]["observed_bank_switch_edges"])
            self.assertFalse(
                result["bank_control"]["post_handler_bank_entry_verified"])
            self.assertFalse(result["r2_instruction_trace_complete"])


if __name__ == "__main__":
    unittest.main()
