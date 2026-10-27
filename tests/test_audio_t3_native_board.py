"""ROM-free read-only T3 native MAME audio tape metadata validation."""
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))
import audio_b3_checkpoint as b3
import audio_t3_native_board_audit as m


class NativeBoardAuditTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name) / "audio"
        self.root.mkdir()
        previous = b3.PRIVATE
        b3.PRIVATE = self.root
        self.addCleanup(lambda: setattr(b3, "PRIVATE", previous))
        self.tape = self.root / "mame-audio-events-test.jsonl"

    def write(self, rows):
        self.tape.write_text("".join(json.dumps({
            "seq": i+1, "tick12m": tick, "frame": 0,
            "kind": kind, "address": addr, "value": value
        })+"\n" for i, (tick, kind, addr, value) in enumerate(rows)))

    def test_counts_temporal_command_read_matches_without_event_export(self):
        self.write([
            (0, "AUDIO_RESET_WRITE", 0x3d01, 1),
            (10, "SOUNDLATCH_WRITE", 0x3a00, 0x42),
            (18, "Z80_LATCH_READ", 0xc800, 0x42),
            (30, "YM2203_WRITE", 0xe000, 0x34),
            (40, "YM2203_WRITE", 0xe002, 0x56),
            (50, "SOUNDLATCH_WRITE", 0x3a00, 0x28),
            (53, "Z80_LATCH_READ", 0xc800, 0x28)
        ])
        output = m.audit(self.tape)
        self.assertEqual(output["status"], "EVENT_CHRONOLOGY_ONLY_IRQ_NOT_OBSERVED")
        self.assertEqual(output["recorded_ym_writes"], 2)
        self.assertTrue(output["recorded_two_ym_chips_addressed"])
        self.assertEqual(output["latch_read_matches_prior_tick_write"], 2)
        self.assertEqual(output["latch_read_mismatches_prior_tick_write"], 0)
        self.assertEqual(output["source_irq_type"], "HOLD_LINE")
        self.assertFalse(output["native_irq_acknowledgements_observed"])
        self.assertNotIn("0x42", json.dumps(output))
        self.assertNotIn("0x56", json.dumps(output))
        self.assertNotIn(str(self.root), json.dumps(output))

    def test_detects_read_mismatch_and_cross_cpu_inversion_as_unverified(self):
        self.write([
            (0, "AUDIO_RESET_WRITE", 0x3d01, 1),
            (10, "Z80_LATCH_READ", 0xc800, 0x28),
            (30, "SOUNDLATCH_WRITE", 0x3a00, 0x42),
            (38, "YM2203_WRITE", 0xe001, 0x30),
            (35, "SOUNDLATCH_WRITE", 0x3a00, 0x28),
            (40, "Z80_LATCH_READ", 0xc800, 0x99)
        ])
        # Cross-stream inversion between audio YM and main latch is tolerated
        # by B3 lab validation, but never treated as timing parity.
        answer = m.audit(self.tape)
        self.assertEqual(answer["latch_reads_without_prior_tick_write"], 1)
        self.assertEqual(answer["latch_read_mismatches_prior_tick_write"], 1)
        self.assertEqual(answer["cross_cpu_clock_inversions_lab"], 1)
        self.assertFalse(answer["z80_timing_parity_verified"])

    def test_invalid_tape_port_and_invalid_id_fail_closed(self):
        self.write([(0, "YM2203_WRITE", 0xe004, 0)])
        with self.assertRaisesRegex(b3.B3Stop, "TAPE_BAD_YM_PORT"):
            m.audit(self.tape)
        for invalid in ("../x", "!", "with space", "x"*45):
            self.assertIsNone(m.ID.fullmatch(invalid))


if __name__ == "__main__":
    unittest.main()
