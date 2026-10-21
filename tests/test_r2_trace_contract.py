"""ROM-free contract tests: synthetic traces never assert real gameplay."""
from __future__ import annotations

import copy
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "r2_trace_contract", ROOT / "scripts/r2_trace_contract.py"
)
validator = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(validator)


def regs(pc=0):
    return {key: 0 for key in ("PC", "A", "B", "X", "Y", "U", "S", "DP", "CC")} | {"PC": pc}


def sample():
    return [
        {"schema": "gng.r2.cpu-trace.v1", "kind": "header",
         "driver": "gngb", "cpu": "maincpu", "origin": "independent-test-oracle",
         "origin_revision": "synthetic-v1", "rom_sha256": "a" * 64,
         "input_plan_sha256": "b" * 64, "initial_reset_vector": 0,
         "frame_clock": "screen.frame_number",
         "instruction_phase": "pre-fetch", "bank_initial": 0,
         "capture_policy": "full-instruction-and-ordered-bus-effects"},
        {"kind": "event", "seq": 0, "frame": 0,
         "pc": 0, "name": "RESET", "details": {}},
        {"kind": "step", "seq": 1, "frame": 0, "pc": 0,
         "opcode_bytes": "12", "bank": 0, "before": regs(), "after": regs(1),
         "bus": [{"kind": "read", "space": "ram", "addr": 6, "width": 1, "value": 12}]},
        {"kind": "event", "seq": 2, "frame": 1,
         "pc": 1, "name": "SYNC_ENTER", "details": {}},
        {"kind": "event", "seq": 3, "frame": 1,
         "pc": 1, "name": "IRQ_ASSERT", "details": {}},
        {"kind": "event", "seq": 4, "frame": 1,
         "pc": 1, "name": "IRQ_ENTRY",
         "details": {"vector_addr": 0xfff8, "handler_pc": 0x6200}},
        {"kind": "footer", "seq": 5, "frame": 1,
         "status": "COMPLETE", "steps": 1,
         "coverage": {"reset_observed": True, "sync_observed": True,
                      "first_irq_entry_observed": True},
         "stop_reason": "synthetic unit-test only"},
    ]


class R2TraceContractTests(unittest.TestCase):
    def test_synthetic_complete_is_only_structure_not_real_evidence(self):
        result = validator.validate_records(sample())
        self.assertEqual(result["status"], "STRUCTURE_VALID")
        self.assertEqual(result["capture_status"], "COMPLETE")
        self.assertEqual(result["steps"], 1)
        self.assertFalse(result["reference_execution_verified"])

    def test_jsonl_stream_validates_without_rom(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "synthetic.jsonl"
            path.write_text("".join(json.dumps(x) + "\n" for x in sample()),
                            encoding="utf-8")
            self.assertEqual(validator.validate_file(path)["record_count"], 5)

    def test_missing_or_fake_interrupt_coverage_blocks(self):
        missing = sample()
        missing.pop(5)
        missing[-1]["seq"] -= 1
        missing[-1]["coverage"]["first_irq_entry_observed"] = False
        with self.assertRaisesRegex(ValueError, "COMPLETE requires"):
            validator.validate_records(missing)
        fake = sample()
        fake[-1]["coverage"]["sync_observed"] = False
        with self.assertRaisesRegex(ValueError, "falsely claims"):
            validator.validate_records(fake)

    def test_noncontiguous_records_and_frames_block(self):
        bad = sample()
        bad[2]["seq"] = 3
        with self.assertRaisesRegex(ValueError, "noncontiguous"):
            validator.validate_records(bad)
        bad = sample()
        bad[3]["frame"] = 0
        bad[2]["frame"] = 1
        with self.assertRaisesRegex(ValueError, "regressed"):
            validator.validate_records(bad)

    def test_missing_bus_effects_or_untrusted_registers_block(self):
        bad = sample()
        bad[2]["before"].pop("CC")
        with self.assertRaisesRegex(ValueError, "fields mismatch"):
            validator.validate_records(bad)
        bad = sample()
        bad[2]["bus"][0]["width"] = 3
        with self.assertRaisesRegex(ValueError, "width"):
            validator.validate_records(bad)
        bad = sample()
        bad[2]["pc"] = 99
        with self.assertRaisesRegex(ValueError, "before-PC mismatch"):
            validator.validate_records(bad)

    def test_generated_or_unpinned_provider_is_not_independent(self):
        bad = sample()
        bad[0]["origin"] = "generated-js-runtime"
        with self.assertRaisesRegex(ValueError, "independent"):
            validator.validate_records(bad)
        bad = sample()
        bad[0]["input_plan_sha256"] = "not a digest"
        with self.assertRaisesRegex(ValueError, "digest"):
            validator.validate_records(bad)

    def test_incomplete_trace_can_only_pass_structural_gate(self):
        partial = sample()
        partial[5]["status"] = "INCOMPLETE"
        report = validator.validate_records(partial)
        self.assertEqual(report["capture_status"], "INCOMPLETE")
        self.assertFalse(report["reference_execution_verified"])


if __name__ == "__main__":
    unittest.main()
