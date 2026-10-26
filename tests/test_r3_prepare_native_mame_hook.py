"""ROM-free test of strict upstream-anchored native MAME IRQ/SYNC instrumentation."""
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
    "r3_prepare_native_mame_hook",
    ROOT / "scripts/r3_prepare_native_mame_hook.py")
probe = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(probe)


# Minimal fixtures, not copied or packaged upstream MAME source.
CPU = """void m6809_base_device::device_reset()
{
	m_cc |= CC_F;       // FIRQ disabled
}
void m6809_base_device::execute_set_input(int inputnum, int state)
{
    switch(inputnum) { }
}
"""
MICROCODE = """\nNMI:
    return;
FIRQ:
    return;
IRQ:
    return;
SYNC:
	m_syncack_write_func(1);
    while (!m_irq_line) { }
	m_syncack_write_func(0);
    return;
INTERRUPT_VECTOR:
	@m_pc.b.l = read_vector(1);
    return;
"""


class NativeMameOverlayTests(unittest.TestCase):
    def test_cpu_observes_external_lines_and_reset_only_not_acceptance(self):
        patched = probe.instrument_cpu(CPU)
        self.assertIn("GNG_R35_NATIVE_V1", patched)
        self.assertIn("LINE_DELIVERED", patched)
        self.assertIn("CPU_RESET", patched)
        self.assertIn("M6809_IRQ_LINE", patched)
        self.assertIn("M6809_FIRQ_LINE", patched)
        self.assertIn("INPUT_LINE_NMI", patched)
        self.assertIn("total_cycles()", patched)
        self.assertNotIn("IRQ_HANDLER_CALLED", patched)
        self.assertEqual(CPU.count("GNG_R35_NATIVE_V1"), 0)

    def test_microcode_emits_actual_sync_entry_exit_and_handler_entry(self):
        compiled = probe.instrument_microcode(MICROCODE)
        self.assertEqual(compiled.count("GNG_R35_NATIVE_V1"), 6)
        self.assertEqual(compiled.count("IRQ_ENTRY"), 3)
        self.assertEqual(compiled.count("SYNC_ENTER"), 1)
        self.assertEqual(compiled.count("SYNC_EXIT"), 1)
        self.assertEqual(compiled.count("VECTOR_FETCH"), 1)
        self.assertIn("m_irq_line", compiled)
        self.assertIn("m_nmi_asserted", compiled)
        self.assertIn("m_firq_line", compiled)
        self.assertIn("std::string_view(machine().system().name)", compiled)
        self.assertIn("@m_pc.b.l = read_vector(1)", compiled)

    def test_upstream_source_drift_fails_closed(self):
        with self.assertRaisesRegex(ValueError, "R35_MAME_ANCHOR_MISMATCH"):
            probe.instrument_cpu(CPU.replace("CC_F", "CC_I"))
        with self.assertRaisesRegex(ValueError, "R35_MAME_ANCHOR_MISMATCH"):
            probe.instrument_microcode(MICROCODE.replace(
                "m_syncack_write_func(1)", "different_core()"))
        with self.assertRaisesRegex(ValueError, "R35_MAME_ANCHOR_MISMATCH"):
            probe.instrument_microcode(MICROCODE + "\nIRQ:\n")

    def test_prepare_only_creates_private_overlay_and_manifest_not_binary(self):
        (ROOT / "out/r3").mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=ROOT / "out/r3") as scratch:
            root = Path(scratch)
            upstream = root / "source"
            dest = root / "overlay"
            for path, content in ((probe.CPU_SRC, CPU),
                                  (probe.MICROCODE_SRC, MICROCODE)):
                location = upstream / path
                location.parent.mkdir(parents=True, exist_ok=True)
                location.write_text(content)
            result = probe.prepare(upstream, dest)
            self.assertEqual(result["status"],
                             "PATCHED_SOURCE_ONLY_BINARY_NOT_VERIFIED")
            self.assertFalse(result["binary_built"])
            self.assertFalse(result["native_irq_entry_verified"])
            self.assertEqual(len(result["files"]), 2)
            self.assertTrue(all(
                (dest / item["path"]).is_file()
                for item in result["files"]
            ))
            self.assertEqual(json.loads(
                (dest / "manifest.json").read_text())["binary_built"], False)
            self.assertEqual((upstream / probe.CPU_SRC).read_text(), CPU)
            # Idempotent, but an unexpected modified overlay is never replaced.
            probe.prepare(upstream, dest)
            (dest / probe.CPU_SRC).write_text("different")
            with self.assertRaisesRegex(ValueError,
                                        "R35_MAME_REFUSES_STALE_OVERLAY"):
                probe.prepare(upstream, dest)

    def test_public_paths_and_missing_source_are_rejected(self):
        with tempfile.TemporaryDirectory() as scratch:
            with self.assertRaisesRegex(
                    ValueError, "R35_MAME_OUTPUT_MUST_STAY_INSIDE"):
                probe.prepare(Path(scratch), ROOT / "docs/native")
        with self.assertRaisesRegex(ValueError, "R35_MAME_SOURCE_DIR_MISSING"):
            probe.prepare(ROOT / "missing-mame-source",
                          ROOT / "out/r3/native-missing")


    def test_bash_nounset_no_empty_array_expansion(self):
        # macOS ships Bash 3.2; Bash 3.x fails with nounset on an empty
        # ${array[@]}. Assert our argv-building logic avoids it entirely.
        script = (ROOT / "scripts/r2-mame-probe.sh").read_text()
        self.assertNotIn('NATIVE_LOG_ARGS=()', script)
        self.assertNotIn('NATIVE_LOG_ARGS[@]', script)
        self.assertIn('set -- gngb -rompath "$ROMPATH"', script)
        if not shutil.which("bash"):
            self.skipTest("bash not available")
        for mode, expected in (("0", "gngb,-rompath,example,-debug"),
                               ("1", "gngb,-rompath,example,-debug,-oslog")):
            snippet = (
                'set -euo pipefail\n'
                'ROMPATH=example\n'
                'set -- gngb -rompath "$ROMPATH" -debug\n'
                f'NATIVE_LOG_EVENTS={mode}\n'
                'if [[ "$NATIVE_LOG_EVENTS" == "1" ]]; then\n'
                '  set -- "$@" -oslog\n'
                'fi\n'
                'IFS=,; printf "%s" "$*"\n'
            )
            proc = subprocess.run(["bash", "-c", snippet], capture_output=True,
                                  text=True)
            self.assertEqual(proc.returncode, 0, proc.stderr)
            self.assertEqual(proc.stdout, expected)

    def test_r2_launcher_native_mode_is_opt_in_and_guarded(self):
        script = (ROOT / "scripts/r2-mame-probe.sh").read_text()
        self.assertIn('GNG_R3_MAME_NATIVE_EVENTS', script)
        self.assertIn('GNG_R3_MAME_BIN', script)
        self.assertIn('native_hook_requires_explicit_custom_mame_binary', script)
        self.assertIn('NATIVE_LOG_EVENTS=', script)
        self.assertIn('set -- "$@" -oslog', script)
        self.assertIn('"$MAME_BIN" "$@" -seconds_to_run', script)
        self.assertNotIn('NATIVE_LOG_ARGS[@]', script)
        self.assertIn('invalid_native_log_events_option', script)
        wrapper = (ROOT / "scripts/r3-native-irq-verify.sh").read_text()
        self.assertIn('missing_explicit_instrumented_mame_binary', wrapper)
        self.assertIn('binary_lacks_native_hook_marker', wrapper)
        self.assertIn('t4_operator_authorization_required', wrapper)
        self.assertIn('existing_evidence_use_isolated_checkout', wrapper)
        self.assertNotIn('cp -R out/r2/mame-probe', wrapper)
        self.assertIn('scripts/r3_native_irq_report.mjs', wrapper)
        if shutil.which("bash"):
            for file in ("scripts/r2-mame-probe.sh",
                         "scripts/r3-native-irq-verify.sh"):
                proc = subprocess.run(["bash", "-n", str(ROOT / file)],
                    capture_output=True, text=True)
                self.assertEqual(proc.returncode, 0, proc.stderr)

    def test_native_wrapper_fail_closed_before_any_capture(self):
        # Isolated synthetic checkout; never touches a real ROM or MAME.
        with tempfile.TemporaryDirectory() as scratch:
            root = Path(scratch)
            (root / "scripts").mkdir()
            (root / "scripts/r3-native-irq-verify.sh").write_text(
                (ROOT / "scripts/r3-native-irq-verify.sh").read_text())
            fake = root / "fake-instrumented-mame"
            fake.write_text("GNG_R35_NATIVE_V1\\n")
            fake.chmod(0o755)
            env = dict(__import__("os").environ,
                       GNG_R3_MAME_BIN=str(fake))
            command = ["bash", str(root / "scripts/r3-native-irq-verify.sh")]
            unauth = subprocess.run(command, env=env, capture_output=True,
                                    text=True)
            self.assertEqual(unauth.returncode, 2)
            self.assertIn("t4_operator_authorization_required", unauth.stderr)
            env["GNG_R35_NATIVE_T4_APPROVED"] = "EXPLICIT_OPERATOR_B2_T4"
            (root / "out/r2/mame-probe").mkdir(parents=True)
            (root / "out/r2/mame-probe/original.txt").write_text("preserve")
            collision = subprocess.run(command, env=env, capture_output=True,
                                       text=True)
            self.assertEqual(collision.returncode, 2)
            self.assertIn("existing_evidence_use_isolated_checkout",
                          collision.stderr)
            self.assertEqual((root / "out/r2/mame-probe/original.txt").read_text(),
                             "preserve")
            self.assertFalse((root / "out/r3/native-irq-report").exists())


if __name__ == "__main__":
    unittest.main()
