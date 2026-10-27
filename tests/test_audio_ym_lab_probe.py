"""ROM-free orchestration tests for pinned YMFM synthetic PSG smoke."""
import io
import json
import struct
import sys
import tempfile
import unittest
import wave
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))
import audio_ym_lab_probe as probe
import audio_b3_checkpoint as b3


class PSGProbeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.directory = Path(self.tmp.name) / "audio"
        self.directory.mkdir()
        original = (b3.PRIVATE, probe.PROBE_TSV, probe.PROBE_WAV)
        b3.PRIVATE = self.directory
        probe.PROBE_TSV = self.directory / "b3-probe-psg.tsv"
        probe.PROBE_WAV = self.directory / "b3-probe-psg.wav"
        self.addCleanup(lambda: (
            setattr(b3, "PRIVATE", original[0]),
            setattr(probe, "PROBE_TSV", original[1]),
            setattr(probe, "PROBE_WAV", original[2])
        ))

    def wav(self, value):
        with wave.open(str(probe.PROBE_WAV), "wb") as output:
            output.setnchannels(1)
            output.setsampwidth(2)
            output.setframerate(62500)
            output.writeframes(struct.pack("<h", value) * 62500)

    def test_probe_writes_public_tone_commands_without_rom_data(self):
        probe.make_psg_tsv()
        lines = probe.PROBE_TSV.read_text().splitlines()
        self.assertEqual(len(lines), 8)
        self.assertEqual(lines[0], "0 57344 0")
        self.assertEqual(lines[-1], "0 57345 15")
        with self.assertRaisesRegex(b3.B3Stop, "PROBE_ARTIFACT_ALREADY_EXISTS"):
            probe.make_psg_tsv()

    def test_synthetic_probe_requires_non_silent_renderer_output(self):
        ymfm = self.directory / "ymfm"
        ymfm.mkdir()
        calls = []
        def fake_call(cmd, **_kwargs):
            calls.append(cmd)
            if len(calls) == 1:
                (self.directory / "ym2203_lab").write_bytes(b"test")
            elif len(calls) == 2:
                self.wav(123)
        output = io.StringIO()
        with patch.object(b3, "verify_repository_privacy", return_value=True), \
             patch.object(b3, "call", side_effect=fake_call), \
             redirect_stdout(output):
            rc = probe.main([str(ymfm)])
        self.assertEqual(rc, 0)
        summary = json.loads(output.getvalue())
        self.assertEqual(summary["status"], "NON_SILENT_PSG_SYNTHETIC_ONLY")
        self.assertEqual(summary["peak"], 123)
        self.assertFalse(summary["game_audio_verified"])
        self.assertEqual(len(calls), 2)

    def test_silent_psg_probe_must_stop_and_not_claim_audio_working(self):
        ymfm = self.directory / "ymfm"
        ymfm.mkdir()
        step = [0]
        def fake_call(cmd, **_kwargs):
            step[0] += 1
            if step[0] == 1:
                (self.directory / "ym2203_lab").write_bytes(b"test")
            elif step[0] == 2:
                self.wav(0)
        out = io.StringIO()
        with patch.object(b3, "verify_repository_privacy", return_value=True), \
             patch.object(b3, "call", side_effect=fake_call), \
             redirect_stdout(out):
            result = probe.main([str(ymfm)])
        self.assertEqual(result, 2)
        summary = json.loads(out.getvalue())
        self.assertEqual(summary["reason"], "SYNTHETIC_PSG_SILENT")
        self.assertFalse(summary["game_audio_verified"])


if __name__ == "__main__":
    unittest.main()
