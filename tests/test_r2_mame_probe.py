"""R2.2.A ROM-free smoke: never represents synthetic probe samples as gameplay."""
from __future__ import annotations

import importlib.util
import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "r2_probe_report", ROOT / "scripts/r2_probe_report.py")
probe = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(probe)


def evidence(dir: Path, with_trace: bool = True):
    observations = [
        ("PROBE", "r2-mame-capability-v1"),
        ("DRIVER", "gngb"),
        ("DEBUGGER_AVAILABLE", "1"),
        ("CPU_DEBUGGER_AVAILABLE", "1"),
        ("CPU_PROGRAM_WIDTH", "8"),
        ("BANK_ENTRY_AVAILABLE", "1"),
        ("BANK_INITIAL_OBSERVED", "0"),
    ]
    observations.extend(("REGISTER_AVAILABLE", reg, "1") for reg in
                        ("PC", "A", "B", "X", "Y", "U", "S", "DP", "CC"))
    observations += [
        ("FRAME_SAMPLE", "1", "24576", "0"),
        ("FRAME_SAMPLE", "2", "24578", "0"),
        ("RESET_NOTIFICATION", "0", "24576"),
        ("MMIO_READ_SAMPLE", "1", "24576", "12288", "255"),
        ("MMIO_WRITE_SAMPLE", "2", "24578", "15872", "4"),
        ("BANK_CONTROL_WRITE_SAMPLE", "2", "24578", "15872", "4", "0"),
        ("OBSERVED_RESET_COUNT", "1"),
        ("OBSERVED_FRAME_COUNT", "2"),
        ("OBSERVED_MMIO_READ_COUNT", "1"),
        ("OBSERVED_MMIO_WRITE_COUNT", "1"),
        ("OBSERVED_BANK_CONTROL_WRITE_COUNT", "1"),
        ("PROBE_END", "frame-limit"),
    ]
    (dir / "observations.tsv").write_text(
        "".join("\t".join(x) + "\n" for x in observations), encoding="utf-8")
    if with_trace:
        (dir / "cpu.trace").write_text(
            ("6000: 12 NOP  A=00 B=00 X=0000\n" * 4), encoding="utf-8")


class R2MameProbeTests(unittest.TestCase):
    def test_synthetic_probe_can_only_establish_partial_instrumentation(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            evidence(root)
            result = probe.classify(root / "observations.tsv", root / "cpu.trace")
            self.assertEqual(result["status"], "PARTIAL_NATIVE_INSTRUMENTATION")
            self.assertTrue(result["real_mame_execution_observed"])
            self.assertFalse(result["reference_execution_verified"])
            self.assertFalse(result["r2_instruction_trace_complete"])
            self.assertTrue(result["capabilities"]["instruction_log"])
            self.assertTrue(result["capabilities"]["mmio_read_taps"])
            self.assertFalse(result["capabilities"]["observed_irq_assert_entry"])
            self.assertFalse(result["capabilities"]["exhaustive_ordered_bus"])

    def test_bank_control_write_is_observed_not_forged_into_bank_switch(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            evidence(root)
            result = probe.classify(root / "observations.tsv", root / "cpu.trace")
            self.assertTrue(result["capabilities"]["bank_control_writes_observed"])
            self.assertFalse(result["capabilities"]["observed_bank_switch_edges"])
            self.assertEqual(result["bank_control"]["control_write_count"], 1)
            self.assertEqual(result["bank_control"]["recorded_samples"], 1)
            self.assertFalse(result["bank_control"]["post_handler_bank_entry_verified"])

    def test_missing_truncated_and_wrong_address_bank_samples_block_evidence(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            evidence(root)
            path = root / "observations.tsv"
            initial = path.read_text()
            for broken in (
                initial.replace("BANK_CONTROL_WRITE_SAMPLE\t2\t24578\t15872\t4\t0\n", ""),
                initial.replace("BANK_CONTROL_WRITE_SAMPLE\t2\t24578\t15872\t4\t0",
                                "BANK_CONTROL_WRITE_SAMPLE\t2\t24578\t15104\t4\t0"),
                initial.replace("OBSERVED_BANK_CONTROL_WRITE_COUNT\t1",
                                "OBSERVED_BANK_CONTROL_WRITE_COUNT\t65"),
            ):
                with self.subTest(broken=broken[-90:]):
                    path.write_text(broken)
                    result = probe.classify(path, root / "cpu.trace")
                    self.assertFalse(result["capabilities"]["bank_control_writes_observed"])
                    self.assertTrue(any("bank-control" in item for item in result["blockers"]))
                    self.assertFalse(result["reference_execution_verified"])

    def test_missing_native_trace_never_qualifies(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            evidence(root, with_trace=False)
            result = probe.classify(root / "observations.tsv", root / "cpu.trace")
            self.assertEqual(result["status"], "INSTRUMENTATION_BLOCKED")
            self.assertIn("MAME debugger noloop instruction trace not authenticated",
                          result["blockers"])

    def test_absent_reset_stays_explicitly_blocked_not_implicitly_passed(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            evidence(root)
            path = root / "observations.tsv"
            path.write_text(path.read_text().replace(
                "OBSERVED_RESET_COUNT\t1", "OBSERVED_RESET_COUNT\t0"
            ).replace("RESET_NOTIFICATION\t0\t24576\n", ""))
            result = probe.classify(path, root / "cpu.trace")
            self.assertFalse(result["capabilities"]["reset_notifier"])
            self.assertIn("reset notifier not observed (late Lua attachment)",
                          result["blockers"])

    def test_scheduled_soft_reset_is_not_misrepresented_as_power_on_reset(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            evidence(root)
            path = root / "observations.tsv"
            path.write_text(
                path.read_text().replace(
                    "RESET_NOTIFICATION\t0\t24576\n",
                    "SOFT_RESET_REQUESTED\t1\t24576\n" +
                    "RESET_NOTIFICATION\t0\t24576\n").replace(
                    "OBSERVED_RESET_COUNT\t1",
                    "CONTROLLED_SOFT_RESET_REQUESTED\t1\nOBSERVED_RESET_COUNT\t1"
                )
            )
            result = probe.classify(path, root / "cpu.trace")
            self.assertTrue(result["capabilities"]["controlled_soft_reset_observed"])
            self.assertFalse(result["reference_execution_verified"])
            self.assertIn("observed soft reset is NOT proof of initial cold-boot reset",
                          result["blockers"])

    def test_soft_reset_request_must_precede_exactly_one_notification(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            evidence(root)
            path = root / "observations.tsv"
            base = path.read_text()
            base = base.replace(
                "OBSERVED_RESET_COUNT\t1",
                "CONTROLLED_SOFT_RESET_REQUESTED\t1\nOBSERVED_RESET_COUNT\t1"
            )
            # Reset notification before the first request is not valid.
            misplaced = base.replace(
                "RESET_NOTIFICATION\t0\t24576",
                "RESET_NOTIFICATION\t0\t24576\nSOFT_RESET_REQUESTED\t1\t24576"
            )
            # The order is notification -> request rather than causal.
            path.write_text(misplaced)
            bad = probe.classify(path, root / "cpu.trace")
            self.assertFalse(bad["capabilities"]["controlled_soft_reset_observed"])
            self.assertIn(
                "controlled soft reset requested but notification not observed",
                bad["blockers"]
            )
            # Exactly one request followed by one observed notification.
            valid = base.replace(
                "RESET_NOTIFICATION\t0\t24576",
                "SOFT_RESET_REQUESTED\t1\t24576\nRESET_NOTIFICATION\t0\t24576"
            )
            path.write_text(valid)
            good = probe.classify(path, root / "cpu.trace")
            self.assertTrue(good["capabilities"]["controlled_soft_reset_observed"])
            # A duplicate notification is not a stronger confirmation.
            dupe = valid.replace(
                "OBSERVED_RESET_COUNT\t1",
                "OBSERVED_RESET_COUNT\t2"
            ).replace(
                "RESET_NOTIFICATION\t0\t24576",
                "RESET_NOTIFICATION\t0\t24576\nRESET_NOTIFICATION\t0\t24576"
            )
            path.write_text(dupe)
            duplicate = probe.classify(path, root / "cpu.trace")
            self.assertFalse(
                duplicate["capabilities"]["controlled_soft_reset_observed"]
            )

    def test_duplicate_or_forged_provenance_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            evidence(root)
            path = root / "observations.tsv"
            path.write_text(path.read_text() + "DRIVER\tgngb\n")
            self.assertEqual(probe.classify(path, root / "cpu.trace")["status"],
                             "INSTRUMENTATION_BLOCKED")
            evidence(root)
            path.write_text(path.read_text().replace("DRIVER\tgngb", "DRIVER\tunknown"))
            self.assertEqual(probe.classify(path, root / "cpu.trace")["status"],
                             "INSTRUMENTATION_BLOCKED")

    def test_launcher_and_lua_probe_do_not_modify_blackbox_or_assert_equivalence(self):
        script = (ROOT / "scripts/r2-mame-probe.sh").read_text()
        lua = (ROOT / "scripts/r2-mame-probe.lua").read_text()
        self.assertIn("-debugscript", script)
        self.assertIn(",:maincpu,noloop", script)
        self.assertIn("-seconds_to_run 8", script)
        self.assertIn("R2.3_NOT_STARTED", script)
        self.assertNotIn("r0-blackbox-baseline.sh", script)
        self.assertIn("install_read_tap(", lua)
        self.assertIn("install_write_tap(", lua)
        self.assertIn('if addr == 0x3e00 then', lua)
        self.assertIn('OBSERVED_BANK_CONTROL_WRITE_COUNT', lua)
        self.assertIn("add_machine_reset_notifier", lua)
        self.assertIn("manager.machine", lua)
        self.assertNotIn("GNG_R2_TRACE_CONTRACT=PASS", lua)
        if shutil.which("bash"):
            proc = subprocess.run(["bash", "-n", str(ROOT / "scripts/r2-mame-probe.sh")],
                                  capture_output=True, text=True)
            self.assertEqual(proc.returncode, 0, proc.stderr)

    def test_soft_reset_reentry_and_closed_callbacks_are_idempotent(self):
        lua = (ROOT / "scripts/r2-mame-probe.lua").read_text()
        shell = (ROOT / "scripts/r2-mame-probe.sh").read_text()
        self.assertIn('rawget(_G, "gng_r2_probe_bootstrapped")', lua)
        self.assertIn('_G.gng_r2_probe_bootstrapped = true', lua)
        self.assertIn("if finished or file_closed then return end", lua)
        self.assertIn("local finished, file_closed, finishing = false, false, false", lua)
        self.assertIn("if file_closed or finished and not finishing then return end", lua)
        self.assertIn("if [[ $LUA_FAULT -ne 0 ]]; then fail", shell)
        self.assertIn('pretrace["status"] != "PRE_INSTRUCTION_FORMAT_PARSED"', shell)
        self.assertNotIn('GNG_R2_PROBE=OBSERVED_PARTIAL_ONLY', shell)

    def test_trace_report_does_not_invent_cpu_irq(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            evidence(root)
            result = probe.classify(root / "observations.tsv", root / "cpu.trace")
            self.assertNotIn("COMPLETE", json.dumps(result))
            for key in ("per_instruction_register_before_after",
                        "observed_bank_switch_edges", "observed_sync_enter_exit"):
                self.assertFalse(result["capabilities"][key])


if __name__ == "__main__":
    unittest.main()
