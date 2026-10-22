"""ROM-free test of strict upstream-anchored native MAME IRQ/SYNC instrumentation."""
from __future__ import annotations

import importlib.util
import json
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
MICROCODE = """NMI:
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


if __name__ == "__main__":
    unittest.main()
