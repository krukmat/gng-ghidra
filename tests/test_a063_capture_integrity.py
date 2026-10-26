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
        self.root = Path(self.tmp.name).resolve()
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

    def oracle_fixture(self, *, full=False):
        self.output = self.root / (contract.FULL_ORACLE_OUTPUT if full else
                                  "out/r3/a063-oracle-smoke")
        self.output.mkdir(parents=True)
        self.preflight = self.root / (contract.FULL_ORACLE_PREFLIGHT if full else
                         "out/r3/a063-oracle-preflight/private-a063-preflight.json")
        contract.create_preflight("4000", "5000", str(self.mame), self.preflight,
                                  root=self.root, oracle=True, full_oracle=full)
        for filename in integrity.ARTIFACTS:
            (self.output / filename).write_text("synthetic fixture\n")
        action = contract.build_action("4000", "5000", oracle=True)
        (self.output / "start-debugger.txt").write_text(
            f"trace {self.output / 'cpu.trace'},:maincpu,noloop,{action}\ng\n")
        (self.output / "pretrace-report.json").write_text(
            json.dumps({"status": "PRE_INSTRUCTION_FORMAT_PARSED", "snapshots": 300}))
        (self.output / "capabilities.json").write_text(json.dumps({
            "status": "PARTIAL_NATIVE_INSTRUMENTATION",
            "capabilities": {"controlled_soft_reset_observed": True},
        }))
        if full:
            (self.output / "observations.tsv").write_text(
                "PROBE\tr2-mame-capability-v1\nDRIVER\tgngb\n"
                "SPRITE_RAM_TAP_ENABLED\t1\nA04_VIDEO_WRITE_TAP_ENABLED\t1\n"
                "R36_TARGETED_READ_ENABLED\t1\nR36_UNMAP_POLICY_ENABLED\t1\n"
                "SOFT_RESET_REQUESTED\t1\nRESET_NOTIFICATION\t1\n"
                "A063_ORACLE_RESET_EPOCH\t1\n"
                "CONTROLLED_SOFT_RESET_REQUESTED\t1\nOBSERVED_RESET_COUNT\t1\n")

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

    def test_oracle_capture_requires_unchanged_explicit_binary(self):
        # Private diagnostic source hashes and action must be bound to
        # the exact 0.289 MAME binary through BOTH postflight stages.
        self.oracle_fixture()
        self.assertTrue(self.finalize()["capture_artifacts_complete"])
        with self.assertRaisesRegex(contract.ContractError, "ORACLE_BINARY_REQUIRED"):
            integrity.verify_postflight(self.root, self.output, self.preflight)
        integrity.verify_postflight(self.root, self.output, self.preflight,
                                    mame_bin=str(self.mame))
        self.mame.write_text('#!/bin/sh\necho "MAME test 0.289"\necho tampered\n')
        self.mame.chmod(0o755)
        with self.assertRaisesRegex(contract.ContractError, "ORACLE_BINARY_CHANGED"):
            integrity.verify_postflight(self.root, self.output, self.preflight,
                                        mame_bin=str(self.mame))

    def test_full_oracle_exact_scope_chain_and_binary_binding(self):
        self.oracle_fixture(full=True)
        report = self.finalize()
        self.assertTrue(report["capture_artifacts_complete"])
        self.assertEqual(report["oracle_capture_scope"], "full")
        self.assertEqual(report["capture_output_relative"], contract.FULL_ORACLE_OUTPUT)
        with self.assertRaisesRegex(contract.ContractError, "ORACLE_BINARY_REQUIRED"):
            integrity.verify_postflight(self.root, self.output, self.preflight)
        integrity.verify_postflight(self.root, self.output, self.preflight,
                                   mame_bin=str(self.mame))
        self.mame.write_text("changed binary\n")
        with self.assertRaisesRegex(contract.ContractError, "ORACLE_BINARY_CHANGED"):
            integrity.verify_postflight(self.root, self.output, self.preflight,
                                       mame_bin=str(self.mame))

    def test_full_oracle_preflight_cannot_be_reused_even_unchanged(self):
        self.oracle_fixture(full=True)
        with self.assertRaisesRegex(contract.ContractError, "PREFLIGHT_EXISTS_PRESERVE"):
            contract.create_preflight("4000", "5000", str(self.mame), self.preflight,
                                      root=self.root, oracle=True, full_oracle=True)

    def test_full_oracle_is_never_inferred_from_destination(self):
        self.oracle_fixture()
        self.output = self.root / contract.FULL_ORACLE_OUTPUT
        self.output.mkdir(parents=True)
        with self.assertRaisesRegex(contract.ContractError, "ORACLE_MODE_INVALID"):
            self.finalize()

    def test_full_oracle_rejects_sibling_output(self):
        self.oracle_fixture(full=True)
        self.output = self.output.with_name("arbitrary-private-capture")
        self.output.mkdir(parents=True)
        with self.assertRaisesRegex(contract.ContractError, "ORACLE_MODE_INVALID"):
            self.finalize()

    def test_full_oracle_missing_sprite_tap_never_complete(self):
        self.oracle_fixture(full=True)
        path = self.output / "observations.tsv"
        path.write_text(path.read_text().replace("SPRITE_RAM_TAP_ENABLED\t1\n", ""))
        self.assertFalse(self.finalize()["capture_artifacts_complete"])

    def test_full_oracle_duplicate_reset_delimiter_never_complete(self):
        self.oracle_fixture(full=True)
        path = self.output / "observations.tsv"
        path.write_text(path.read_text() + "A063_ORACLE_RESET_EPOCH\t1\n")
        self.assertFalse(self.finalize()["capture_artifacts_complete"])

    def test_full_oracle_reset_not_independently_observed_never_complete(self):
        self.oracle_fixture(full=True)
        path = self.output / "capabilities.json"
        path.write_text(json.dumps({"status": "PARTIAL_NATIVE_INSTRUMENTATION"}))
        self.assertFalse(self.finalize()["capture_artifacts_complete"])

    def test_preflight_cannot_omit_frozen_source(self):
        plan = json.loads(self.preflight.read_text())
        plan["source_sha256"].pop("scripts/r2-mame-probe.lua")
        self.preflight.write_text(json.dumps(plan))
        with self.assertRaisesRegex(contract.ContractError, "SOURCE_MANIFEST_MISSING"):
            self.finalize()

    def test_verification_rechecks_actual_action(self):
        self.finalize()
        path = self.output / "start-debugger.txt"
        path.write_text(path.read_text().replace("b@4000", "w@4000"))
        postflight = self.output / "private-a063-postflight.json"
        saved = json.loads(postflight.read_text())
        saved["artifacts_sha256"]["start-debugger.txt"] = integrity.digest(path)
        postflight.write_text(json.dumps(saved))
        with self.assertRaisesRegex(contract.ContractError, "CHAIN_MISMATCH"):
            integrity.verify_postflight(self.root, self.output, self.preflight)

    def test_full_source_changed_after_postflight_rejected(self):
        self.oracle_fixture(full=True)
        self.finalize()
        (self.root / "scripts/r3_native_video_write_gate.mjs").write_text("changed\n")
        with self.assertRaisesRegex(contract.ContractError, "CHAIN_MISMATCH"):
            integrity.verify_postflight(self.root, self.output, self.preflight,
                                       mame_bin=str(self.mame))

    def test_full_rom_authentication_sources_are_frozen(self):
        self.oracle_fixture(full=True)
        for name in ("src/poc.py", "src/graphics_preview.py"):
            with self.subTest(source=name):
                self.assertIn(name, contract.SOURCE_FILES)
                source = self.root / name
                original = source.read_text()
                source.write_text("mutated ROM authentication source\n")
                with self.assertRaisesRegex(contract.ContractError, "PREFLIGHT_MISMATCH"):
                    self.finalize()
                source.write_text(original)
        self.assertTrue(self.finalize()["capture_artifacts_complete"])

    def test_symlinked_artifact_cannot_complete_capture(self):
        path = self.output / "cpu.trace"
        path.unlink()
        path.symlink_to(self.output / "mame.log")
        self.assertFalse(self.finalize()["capture_artifacts_complete"])

    def test_reject_public_location(self):
        with self.assertRaisesRegex(contract.ContractError, "PRIVATE_CAPTURE"):
            integrity.capture_postflight(self.root, self.root / "docs",
                self.preflight, "4000", "5000", str(self.mame), 0,
                identity=self.identity)

if __name__ == "__main__":
    unittest.main()
