"""B4.T2: ROM-free debugger profile gate tests; never emit a ROM or raw trace."""
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[1] / "scripts" / "audio_z80_native_pc.py"
import sys
if str(SOURCE.parent) not in sys.path:
    sys.path.insert(0, str(SOURCE.parent))
spec = importlib.util.spec_from_file_location("audio_z80_native_pc", SOURCE)
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)
import audio_b3_checkpoint as b3


class NativeZ80PCTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.directory = Path(self.tmp.name) / "audio"
        self.directory.mkdir()
        self.previous = b3.PRIVATE
        b3.PRIVATE = self.directory
        self.addCleanup(lambda: setattr(b3, "PRIVATE", self.previous))
        self.files = p.paths("trial_a")

    def write_heartbeat(self, **overrides):
        data = {"kind": "GNG_AUDIO_Z80_PC_TRACE_HEALTH_V1",
                "debugger_enabled": True, "trace_armed": True,
                "frames_observed": 650, "frame_limit": 600,
                "trace_stopped": True, "session_closed": True,
                "rom_bytes_exported": False}
        data.update(overrides)
        self.files["health"].write_text(json.dumps(data))

    def test_private_pc_markers_generate_native_backed_roots_only(self):
        self.write_heartbeat()
        self.files["trace"].write_text(
            '0000 disassembly confidential\n'
            'AUDIOPC=007F\n'
            'ignored raw MAME opcode\n'
            'AUDIOPC=0080\n'
            'AUDIOPC=0080\n'
            'AUDIOPC=9000\n')
        with patch.object(p, "verify_sound_rom", return_value=None):
            result = p.profile("trial_a")
        self.assertEqual(result["status"], "PRIVATE_NATIVE_TRACE_PROFILE_NOT_CPU_PARITY")
        self.assertEqual(result["native_trace_pc_markers"], 4)
        self.assertEqual(result["unique_sound_rom_pcs"], 2)
        self.assertEqual(result["unique_outside_sound_rom_pcs"], 1)
        self.assertEqual(result["native_backed_roots_written"], 3)
        self.assertFalse(result["mame_loaded_same_rom_verified"])
        roots = json.loads(self.files["roots"].read_text())
        self.assertEqual(roots["kind"], "GNG_AUDIO_Z80_OPERATOR_PCS_V1")
        self.assertEqual(roots["pcs"], [0, 0x80, 0x7f])
        self.assertNotIn("disassembly", json.dumps(result))
        self.assertNotIn("0x9000", json.dumps(result))
        self.assertNotIn(str(self.directory), json.dumps(result))

    def test_mame_0288_standard_disassembly_fallback_recovers_sound_cpu_pcs(self):
        self.write_heartbeat()
        self.files["trace"].write_text(
            "0000: ld sp,$c7ff\n"
            "0003: jp $00fa\n"
            "0003: jp $00fa\n"
            "c002: nop\n"
            "   (loops for 347 instructions)\n"
            "AUDIOPC garbage\n")
        with patch.object(p, "verify_sound_rom", return_value=None):
            diagnosis = p.inspect("trial_a")
            self.assertEqual(diagnosis["status"],
                             "MAME_STANDARD_DISASSEMBLY_PC_LINES_RECOVERABLE")
            self.assertEqual(diagnosis["marker_pc_lines"], 0)
            self.assertEqual(diagnosis["standard_disassembly_pc_lines"], 4)
            self.assertFalse(self.files["roots"].exists())
            result = p.profile("trial_a")
        self.assertEqual(result["pc_extraction_format"],
                         "STANDARD_MAME_DISASSEMBLY_LINES_NOT_PARITY")
        self.assertEqual(result["native_trace_pc_markers"], 0)
        self.assertEqual(result["selected_pc_line_records"], 4)
        self.assertFalse(result["source_cpu_independently_verified"])
        roots = json.loads(self.files["roots"].read_text())
        self.assertEqual(roots["pcs"], [0, 3])
        self.assertNotIn("jp", json.dumps(diagnosis))
        self.assertNotIn("nop", json.dumps(result))

    def test_inspect_never_creates_roots_and_no_trace_lines_fail_closed(self):
        self.write_heartbeat()
        self.files["trace"].write_text("  (loops for 123 instructions)\n")
        report = p.inspect("trial_a")
        self.assertEqual(report["status"], "NO_RECOGNIZED_PC_LINES")
        self.assertEqual(report["lines_scanned"], 1)
        self.assertFalse(self.files["roots"].exists())
        with patch.object(p, "verify_sound_rom", return_value=None):
            with self.assertRaisesRegex(p.TraceStop, "TRACE_MARKER_NOT_SEEN"):
                p.profile("trial_a")
        self.assertFalse(self.files["roots"].exists())

    def test_marker_preferred_when_both_marker_and_canonical_trace_are_present(self):
        self.write_heartbeat()
        self.files["trace"].write_text(
            "AUDIOPC=0123\n"
            "0001: ld a,$42\n"
            "0002: jp $1000\n")
        with patch.object(p, "verify_sound_rom", return_value=None):
            report = p.profile("trial_a")
        self.assertEqual(report["pc_extraction_format"], "DEBUGGER_ACTION_MARKERS")
        self.assertEqual(report["native_trace_pc_markers"], 1)
        self.assertEqual(report["native_trace_standard_pc_lines"], 2)
        self.assertEqual(report["selected_pc_line_records"], 1)
        roots = json.loads(self.files["roots"].read_text())
        self.assertEqual(roots["pcs"], [0, 0x123])

    def test_no_unsafe_fallback_to_hex_strings_not_disassembly_headers(self):
        self.write_heartbeat()
        self.files["trace"].write_text(
            "PC=1234\n"
            "ffff deadbeef\n"
            "0000X: nop\n"
            "AUDIOPC=0abcd\n"
            "abcd: \n"
            "maincpu: 0010: jp $20\n")
        diagnosis = p.inspect("trial_a")
        self.assertEqual(diagnosis["status"], "NO_RECOGNIZED_PC_LINES")
        self.assertEqual(diagnosis["marker_pc_lines"], 0)
        self.assertEqual(diagnosis["standard_disassembly_pc_lines"], 0)
        self.assertFalse(self.files["roots"].exists())

    def test_trace_must_be_closed_and_provide_debugger_markers(self):
        self.write_heartbeat(session_closed=False)
        self.files["trace"].write_text("AUDIOPC=0005\n")
        with patch.object(p, "verify_sound_rom", return_value=None):
            with self.assertRaisesRegex(p.TraceStop, "TRACE_NOT_CLOSED"):
                p.profile("trial_a")
        self.write_heartbeat()
        self.files["trace"].write_text("0005 LD A,dump\n")
        with patch.object(p, "verify_sound_rom", return_value=None):
            with self.assertRaisesRegex(p.TraceStop, "TRACE_MARKER_NOT_SEEN"):
                p.profile("trial_a")
        self.assertFalse(self.files["roots"].exists())

    def test_roots_are_never_overwritten_and_invalid_ids_rejected(self):
        self.write_heartbeat()
        self.files["trace"].write_text("AUDIOPC=0001\n")
        self.files["roots"].write_text("operator existing roots\n")
        with patch.object(p, "verify_sound_rom", return_value=None):
            with self.assertRaisesRegex(p.TraceStop, "ROOTS_OUTPUT_ALREADY_EXISTS"):
                p.profile("trial_a")
        self.assertEqual(self.files["roots"].read_text(), "operator existing roots\n")
        for unsafe in ("../escape", "with space", "!", "", "a"*40):
            with self.assertRaisesRegex(p.TraceStop, "CAPTURE_ID_INVALID"):
                p.paths(unsafe)

    def test_trace_size_and_pcm_are_not_included_in_profile(self):
        self.write_heartbeat()
        self.files["trace"].write_text("AUDIOPC=0010\nAUDIOPC=C000\n")
        with patch.object(p, "verify_sound_rom", return_value=None), \
             patch.object(p, "RAW_LIMIT", 8):
            with self.assertRaisesRegex(p.TraceStop, "TRACE_TOO_LARGE"):
                p.profile("trial_a")
        self.assertFalse(self.files["roots"].exists())

    def test_capture_refuses_existing_evidence_before_starting_mame(self):
        self.files["health"].write_text("untouched")
        with patch.object(p, "version_of") as version:
            with self.assertRaisesRegex(p.TraceStop, "TRACE_OUTPUT_ALREADY_EXISTS"):
                p.capture("trial_a")
        version.assert_not_called()
        self.assertEqual(self.files["health"].read_text(), "untouched")


if __name__ == "__main__":
    unittest.main()
