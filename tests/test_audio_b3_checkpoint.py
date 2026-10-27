"""ROM-free B3 tests: private capture validation, PCM gate and orchestration."""
import importlib.util
import io
import json
import struct
import tempfile
import unittest
import wave
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[1] / "scripts/audio_b3_checkpoint.py"
spec = importlib.util.spec_from_file_location("audio_b3_checkpoint", SOURCE)
b3 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(b3)


class B3CheckpointTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name) / "audio"
        self.base.mkdir()
        self.original = {
            "PRIVATE": b3.PRIVATE,
            "OUT_TAPE": b3.OUT_TAPE,
            "OUT_TSV": b3.OUT_TSV,
            "OUT_WAV": b3.OUT_WAV,
            "OUT_REPORT": b3.OUT_REPORT,
            "OUT_MAME_WAV": b3.OUT_MAME_WAV,
        }
        b3.PRIVATE = self.base
        b3.OUT_TAPE = self.base / "mame-audio-events.jsonl"
        b3.OUT_TSV = self.base / "b3-ym-events.tsv"
        b3.OUT_WAV = self.base / "b3-first-audio.wav"
        b3.OUT_REPORT = self.base / "b3-checkpoint.json"
        b3.OUT_MAME_WAV = self.base / "mame-native-audio.wav"
        self.addCleanup(lambda: [setattr(b3, k, v) for k, v in self.original.items()])

    def tape(self, rows):
        path = self.base / "mame-audio-events.jsonl"
        path.write_text("\n".join(json.dumps(r) for r in rows) + "\n")
        return path

    @staticmethod
    def event(seq, kind, tick, address, value, frame=0):
        return {"kind": kind, "seq": seq, "tick12m": tick,
                "address": address, "value": value, "frame": frame}

    def make_wav(self, samples, filename="test.wav", channels=1, rate=62500):
        dest = self.base / filename
        with wave.open(str(dest), "wb") as f:
            f.setnchannels(channels)
            f.setsampwidth(2)
            f.setframerate(rate)
            f.writeframes(b"".join(struct.pack("<h", n) for n in samples))
        return dest

    def test_tape_accepts_native_chronology_and_ym_activity(self):
        path = self.tape([
            self.event(1, "AUDIO_RESET_WRITE", 0, 0x3d01, 1),
            self.event(2, "SOUNDLATCH_WRITE", 20, 0x3a00, 42),
            self.event(3, "Z80_LATCH_READ", 20, 0xc800, 42),
            self.event(4, "YM2203_WRITE", 40, 0xe000, 7),
            self.event(5, "YM2203_WRITE", 40, 0xe001, 65),
            self.event(6, "YM2203_WRITE", 44, 0xe002, 1),
        ])
        out = b3.inspect_tape(path)
        self.assertEqual(out["events"], 6)
        self.assertEqual(out["ym_writes"], 3)
        self.assertEqual(out["sound_commands"], 1)
        self.assertEqual(out["latch_reads"], 1)

    def test_tape_rejects_missing_ym_and_bad_counter(self):
        with self.assertRaisesRegex(b3.B3Stop, "TAPE_NO_YM_EVENTS"):
            b3.inspect_tape(self.tape([self.event(1, "SOUNDLATCH_WRITE",
                                                0, 0x3a00, 1)]))
        with self.assertRaisesRegex(b3.B3Stop, "TAPE_BAD_CHRONOLOGY"):
            b3.inspect_tape(self.tape([
                self.event(1, "YM2203_WRITE", 100, 0xe000, 4),
                self.event(3, "YM2203_WRITE", 90, 0xe001, 8),
            ]))

    def test_tape_rejects_second_reset_after_audio_begins(self):
        with self.assertRaisesRegex(b3.B3Stop, "TAPE_MID_STREAM_RESET_UNSUPPORTED"):
            b3.inspect_tape(self.tape([
                self.event(1, "YM2203_WRITE", 100, 0xe000, 4),
                self.event(2, "AUDIO_RESET_WRITE", 110, 0x3d01, 0),
            ]))

    def test_private_path_blocks_parent_and_symlink(self):
        with self.assertRaises(b3.B3Stop):
            b3.ensure_private(self.base / "../exposed.wav")
        outside = Path(self.temp.name) / "outside.txt"
        outside.write_text("test")
        link = self.base / "link.txt"
        link.symlink_to(outside)
        with self.assertRaises(b3.B3Stop):
            b3.ensure_private(link, must_exist=True)

    def test_wav_metrics_measures_pcm_and_detects_silence(self):
        sound = self.make_wav([0, 500, -500, 1000, -1000])
        stats = b3.wav_metrics(sound, expected_rate=62500)
        self.assertEqual(stats["channels"], 1)
        self.assertEqual(stats["rate_hz"], 62500)
        self.assertEqual(stats["peak"], 1000)
        self.assertEqual(stats["nonzero_samples"], 4)
        self.assertGreater(stats["rms"], 0)
        silence = b3.wav_metrics(self.make_wav([0] * 16, "silent.wav"))
        self.assertEqual(silence["peak"], 0)
        with self.assertRaisesRegex(b3.B3Stop, "WAV_FORMAT_INVALID"):
            b3.wav_metrics(self.make_wav([1, 2], "wrong-rate.wav", rate=44100),
                           expected_rate=62500)

    def test_end_to_end_lab_gate_mocked_but_cannot_claim_native_parity(self):
        tape = self.tape([
            self.event(1, "AUDIO_RESET_WRITE", 0, 0x3d01, 1),
            self.event(2, "YM2203_WRITE", 20, 0xe000, 42),
            self.event(3, "YM2203_WRITE", 21, 0xe001, 65),
        ])
        src = Path(self.temp.name) / "public-ymfm"
        src.mkdir()
        calls = []

        def fake_call(argv, **_kwargs):
            calls.append(argv)
            if len(calls) == 1:
                (self.base / "ym2203_lab").write_bytes(b"synthetic build")
            if len(calls) == 2:
                b3.OUT_TSV.write_text("0 57344 42\n")
            if len(calls) == 3:
                self.make_wav([0, 300, -500, 1000, -1000] * 100,
                              b3.OUT_WAV.name)
        with patch.object(b3, "call", side_effect=fake_call):
            report = b3.run_b3(tape=tape, ymfm_source=src, duration_ms=2000)
        self.assertEqual(len(calls), 3)
        self.assertEqual(report["status"],
                         "LAB_NON_SILENT_FROM_MAME_YM_EVENTS_NOT_CERTIFIED")
        self.assertEqual(report["wav"]["peak"], 1000)
        self.assertEqual(report["reference_status"], "NOT_AVAILABLE")
        self.assertFalse(report["ym_waveform_parity_verified"])
        self.assertFalse(report["z80_native_parity_verified"])
        self.assertFalse(report["gameplay_audio_verified"])
        self.assertTrue(b3.OUT_REPORT.exists())

    def test_silent_render_is_a_hard_stop(self):
        tape = self.tape([self.event(1, "YM2203_WRITE", 1, 0xe000, 4)])
        src = Path(self.temp.name) / "public-ymfm"
        src.mkdir()
        count = [0]

        def mocked(argv, **_kwargs):
            count[0] += 1
            if count[0] == 1:
                (self.base / "ym2203_lab").write_bytes(b"dummy")
            elif count[0] == 2:
                b3.OUT_TSV.write_text("0 57344 4\n")
            else:
                self.make_wav([0] * 256, b3.OUT_WAV.name)
        with patch.object(b3, "call", side_effect=mocked):
            with self.assertRaisesRegex(b3.B3Stop, "PCM_SILENT_STOP"):
                b3.run_b3(tape=tape, ymfm_source=src)

    def test_cli_fail_closed_and_no_private_path_in_stdout(self):
        output = io.StringIO()
        with redirect_stdout(output):
            rc = b3.main(["--tape", str(self.base / "../missing.jsonl"),
                          "--ymfm-src", str(self.base)])
        self.assertEqual(rc, 2)
        result = json.loads(output.getvalue())
        self.assertEqual(result["kind"], "GNG_AUDIO_B3_CHECKPOINT_V1")
        self.assertEqual(result["status"], "STOP")
        self.assertNotIn(str(self.temp.name), output.getvalue())


if __name__ == "__main__":
    unittest.main()
