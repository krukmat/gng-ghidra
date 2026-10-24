"""A063 R1 ROM-free postflight/hash-chain and mutation tests."""
from __future__ import annotations
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import a063_trace_contract as contract
import a063_capture_integrity as integrity

class IntegrityTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        scripts = self.root / "scripts"
        scripts.mkdir()
        for file in contract.SOURCE_FILES:
            p = self.root / file
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text("private synthetic source fixture\n")
        self.mame = self.root / "fake-mame"
        self.mame.write_text('#!/bin/sh\necho "MAME test 0.289"\n')
        self.mame.chmod(0o755)
        self.output = self.root / "out/r3/a063-smoke"
        self.output.mkdir(parents=True)
        self.preflight = self.root / "out/r3/a063-smoke-preflight/private-a063-preflight.json"
        contract.create_preflight("4000", "5000", str(self.mame),
                                  self.preflight, root=self.root)
        self.identity = {"git_head": "a" * 40, "tracked_tree_clean": True}
        for filename in integrity.ARTIFACTS:
            (self.output / filename).write_text("synthetic fixture\n")
        action = contract.build_action("4000", "5000")
        (self.output / "start-debugger.txt").write_text(
            f"trace {self.output / 'cpu.trace'},:maincpu,noloop,{action}\ng\n")
        (self.output / "pretrace-report.json").write_text(
            json.dumps({"status": "PRE_INSTRUCTION_FORMAT_PARSED", "snapshots": 300}))
        (self.output / "capabilities.json").write_text(
            json.dumps({"status": "PARTIAL_NATIVE_INSTRUMENTATION"}))

    def finalize(self, code=0):
        return integrity.capture_postflight(
            self.root, self.output, self.preflight, "4000", "5000",
            str(self.mame), code, identity=self.identity)

    def test_chain_and_tampered_artifact(self):
        summary = self.finalize()
        self.assertTrue(summary["capture_artifacts_complete"])
        self.assertFalse(summary["native_bank_identity_per_instruction_proven"])
        self.assertTrue(integrity.verify_postflight(
            self.root, self.output, self.preflight)["status"].endswith("NOT_BANK_PROVENANCE"))
        (self.output / "cpu.trace").write_text("tampered\n")
        with self.assertRaisesRegex(contract.ContractError, "CHAIN_MISMATCH"):
            integrity.verify_postflight(self.root, self.output, self.preflight)

    def test_source_mutation_detected_at_postflight(self):
        (self.root / "scripts/r2-mame-probe.sh").write_text("mutated\n")
        with self.assertRaisesRegex(contract.ContractError, "PREFLIGHT_MISMATCH"):
            self.finalize()

    def test_corrupted_debugger_action_never_complete(self):
        actionfile = self.output / "start-debugger.txt"
        actionfile.write_text(actionfile.read_text().replace("b@4000", "w@4000"))
        report = self.finalize()
        self.assertFalse(report["capture_artifacts_complete"])
        self.assertFalse(report["debugger_action_matches_preflight"])
        with self.assertRaisesRegex(contract.ContractError, "CHAIN_MISMATCH"):
            integrity.verify_postflight(self.root, self.output, self.preflight)

    def test_missing_artifact_and_bad_exit_never_complete(self):
        (self.output / "cpu.trace").unlink()
        report = self.finalize(code=1)
        self.assertFalse(report["capture_artifacts_complete"])
        self.assertIsNone(report["artifacts_sha256"]["cpu.trace"])

    def test_refuse_overwriting_old_postflight(self):
        self.finalize()
        with self.assertRaisesRegex(contract.ContractError, "EXISTS_PRESERVE"):
            self.finalize()

    def test_reject_public_location(self):
        with self.assertRaisesRegex(contract.ContractError, "PRIVATE_CAPTURE"):
            integrity.capture_postflight(self.root, self.root / "docs",
                self.preflight, "4000", "5000", str(self.mame), 0,
                identity=self.identity)

if __name__ == "__main__":
    unittest.main()
