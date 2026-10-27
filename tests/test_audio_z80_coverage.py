"""B4.T2-B7 ROM-free private Z80 executed-versus-compiled PC census tests."""
import json
import sys
import tempfile
import unittest
from collections import Counter
from pathlib import Path
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))
import audio_b3_checkpoint as b3
import audio_z80_coverage as c


class NativeCoverageTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name) / "audio"
        self.root.mkdir()
        self.prior = b3.PRIVATE
        b3.PRIVATE = self.root
        self.addCleanup(lambda: setattr(b3, "PRIVATE", self.prior))
        self.name = "z80-frontier-example-b8.json"
        self.path = self.root / self.name

    def report(self, **overrides):
        data = {
            "kind": "GNG_AUDIO_Z80_FRONTIER_SCAN_V1",
            "status": "PARTIAL_UNCERTIFIED",
            "seed_source": "OPERATOR_SUPPLIED_PCS",
            "rom_identity": "SHA1_MATCH",
            "native_trace_parity_verified": False,
            "static_generated_code_exported": False,
            "operator_seed_pcs": [0, 2],
            "static_visited_pcs": [0, 2, 3, 5],
            "static_decoded_pcs": 4,
        }
        data.update(overrides)
        self.path.write_text(json.dumps(data))
        return data

    def test_overlap_of_native_observed_and_compiled_is_count_only(self):
        self.report()
        seen = {"marker_pc_lines": 0, "standard_disassembly_pc_lines": 40}
        trace = (seen, Counter(), Counter({0: 20, 2: 10, 3: 8, 4: 2,
                                         0xc000: 1}),
                 {"trace_closed": True})
        with patch.object(c.pc, "scan_native_trace", return_value=trace), \
             patch.object(c.pc, "verify_sound_rom", return_value=None):
            got = c.coverage("sample", self.name)
        self.assertEqual(got["status"], "PC_SET_OVERLAP_ONLY_NOT_EXECUTION_PARITY")
        self.assertEqual(got["observed_unique_rom_pcs"], 4)
        self.assertEqual(got["observed_unique_nonrom_pcs"], 1)
        self.assertEqual(got["static_compiled_rom_pcs"], 4)
        self.assertEqual(got["overlap_observed_compiled_pcs"], 3)
        self.assertEqual(got["observed_rom_pcs_not_compiled"], 1)
        self.assertEqual(got["static_compiled_pcs_not_observed"], 1)
        self.assertFalse(got["native_trace_instruction_parity_verified"])
        self.assertNotIn("0xc000", json.dumps(got))
        self.assertNotIn(str(self.root), json.dumps(got))

    def test_invalid_static_report_and_forged_root_are_rejected(self):
        for data in (
            {"native_trace_parity_verified": True},
            {"static_generated_code_exported": True},
            {"seed_source": "RESET_VECTOR_ONLY"},
            {"static_visited_pcs": [0, 2, 2, 5]},
            {"static_visited_pcs": [0, 2, 3, 32768]},
            {"static_decoded_pcs": 100},
            {"operator_seed_pcs": [0, 0]},
            {"operator_seed_pcs": [0, 0x8000]},
        ):
            self.report(**data)
            with self.assertRaises(c.CoverageStop):
                c.validate_report(self.name)
        self.report(operator_seed_pcs=[0, 5])
        observed = ({}, Counter(), Counter({0: 2, 2: 1}),
                    {"trace_closed": True})
        with patch.object(c.pc, "scan_native_trace", return_value=observed), \
             patch.object(c.pc, "verify_sound_rom", return_value=None):
            with self.assertRaisesRegex(c.CoverageStop, "STATIC_ROOTS_NOT_NATIVE_BACKED"):
                c.coverage("sample", self.name)

    def test_private_filename_gates_and_absent_native_pc_samples(self):
        self.report()
        for bad in ("../escape.json", "out/audio/z80-frontier-x.json",
                    "/tmp/z80-frontier-x.json", "z80-frontier-❌.json"):
            with self.assertRaisesRegex(c.CoverageStop, "STATIC_REPORT_NAME_INVALID"):
                c.validate_report(bad)
        empty = ({}, Counter(), Counter(), {"trace_closed": True})
        with patch.object(c.pc, "scan_native_trace", return_value=empty), \
             patch.object(c.pc, "verify_sound_rom", return_value=None):
            with self.assertRaisesRegex(c.CoverageStop, "NATIVE_TRACE_NO_PC_OBSERVATIONS"):
                c.coverage("sample", self.name)


if __name__ == "__main__":
    unittest.main()
