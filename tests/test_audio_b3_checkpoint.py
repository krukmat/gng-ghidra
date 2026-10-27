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
        self.assertEqual(out["ym_chip_0_writes"], 2)
        self.assertEqual(out["ym_chip_1_writes"], 1)
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
        with patch.object(b3, "call", side_effect=fake_call), \
             patch.object(b3, "verify_rom_identity", return_value=True):
            report = b3.run_b3(tape=tape, ymfm_source=src, duration_ms=2000)
        self.assertEqual(len(calls), 3)
        self.assertEqual(report["status"],
                         "LAB_NON_SILENT_FROM_MAME_YM_EVENTS_NOT_CERTIFIED")
        self.assertEqual(report["wav"]["peak"], 1000)
        self.assertEqual(report["reference_status"], "NOT_AVAILABLE")
        self.assertIsNone(report["mame_capture_version"])
        self.assertFalse(report["mame_capture_version_pinned"])
        self.assertFalse(report["lab_unpinned_mame_used"])
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
        with patch.object(b3, "call", side_effect=mocked), \
             patch.object(b3, "verify_rom_identity", return_value=True):
            with self.assertRaisesRegex(b3.B3Stop, "PCM_SILENT_STOP"):
                b3.run_b3(tape=tape, ymfm_source=src)

    def test_private_gg2_identity_rejects_arbitrary_rom_and_missing_file(self):
        with self.assertRaisesRegex(b3.B3Stop, "PRIVATE_INPUT_MISSING"):
            b3.verify_rom_identity()
        (self.base / "gg2.bin").write_bytes(bytes(32768))
        with self.assertRaisesRegex(b3.B3Stop, "LOCAL_SOUND_ROM_IDENTITY_STOP"):
            b3.verify_rom_identity()

    def test_mame_capture_refuses_unpinned_version(self):
        from types import SimpleNamespace
        with patch.object(b3.shutil, "which", return_value="mame"), \
             patch.object(b3, "call",
                          return_value=SimpleNamespace(stdout="0.288", stderr="")):
            with self.assertRaisesRegex(b3.B3Stop, "MAME_VERSION_NOT_PINNED_0289"):
                b3.capture_tape("mame", "roms")

    def test_mame_capture_writes_private_tape_in_one_interactive_session(self):
        from types import SimpleNamespace
        args_seen = []
        def mock_mame(argv, **kwargs):
            args_seen.append(argv)
            self.tape([self.event(1, "YM2203_WRITE", 100, 0xe000, 7)])
            return SimpleNamespace(returncode=0)
        with patch.object(b3.shutil, "which", return_value="mame"), \
             patch.object(b3, "call",
                          return_value=SimpleNamespace(stdout="0.289", stderr="")), \
             patch.object(b3.subprocess, "run", side_effect=mock_mame):
            path = b3.capture_tape("mame", "roms")
        self.assertEqual(path, self.base / "mame-audio-events.jsonl")
        self.assertEqual(args_seen[0][0:2], ["mame", "gngb"])
        self.assertIn("-autoboot_script", args_seen[0])
        self.assertIn("-wavwrite", args_seen[0])
        self.assertIn(str(self.base / "mame-native-audio.wav"), args_seen[0])

    def test_unpinned_mame_lab_capture_is_opt_in_and_provenance_is_explicit(self):
        from types import SimpleNamespace
        metadata = {}
        def mock_mame(argv, **kwargs):
            self.tape([self.event(1, "YM2203_WRITE", 10, 0xe000, 7)])
            return SimpleNamespace(returncode=0)
        with patch.object(b3.shutil, "which", return_value="mame"), \
             patch.object(b3, "call", return_value=SimpleNamespace(
                 stdout="MAME 0.290 (mame0290)", stderr="")):
            with self.assertRaisesRegex(b3.B3Stop, "MAME_VERSION_NOT_PINNED_0289"):
                b3.capture_tape("mame", "roms")
            with patch.object(b3.subprocess, "run", side_effect=mock_mame):
                path = b3.capture_tape("mame", "roms",
                                       allow_unpinned_lab=True,
                                       metadata=metadata)
        self.assertEqual(path, b3.OUT_TAPE)
        self.assertEqual(metadata["mame_version"], "0.290")
        self.assertFalse(metadata["mame_version_pinned"])
        # Capture metadata intentionally also records private artifact paths;
        # adding them must not break the version-provenance contract test.
        self.assertEqual(metadata["reference_wav_path"],
                         self.base / "mame-native-audio.wav")
        self.assertEqual(metadata["tap_health_path"],
                         self.base / "mame-audio-health.json")

    def test_strict_version_requires_a_recognizable_mame_release(self):
        from types import SimpleNamespace
        with patch.object(b3.shutil, "which", return_value="mame"), \
             patch.object(b3, "call", return_value=SimpleNamespace(
                 stdout="mame unknown", stderr="")):
            with self.assertRaisesRegex(b3.B3Stop, "MAME_VERSION_UNRECOGNIZED"):
                b3.capture_tape("mame", "roms", allow_unpinned_lab=True)

    def test_lab_override_cannot_be_used_for_replayed_tape(self):
        output = io.StringIO()
        with redirect_stdout(output):
            rc = b3.main(["--tape", str(b3.OUT_TAPE),
                          "--ymfm-src", str(self.base),
                          "--lab-allow-unpinned-mame"])
        self.assertEqual(rc, 2)
        report = json.loads(output.getvalue())
        self.assertEqual(report["reason"], "MAME_LAB_OVERRIDE_REQUIRES_CAPTURE")

    def test_native_capture_never_overwrites_existing_private_tape(self):
        from types import SimpleNamespace
        self.tape([self.event(1, "YM2203_WRITE", 1, 0xe000, 3)])
        original = b3.OUT_TAPE.read_bytes()
        with patch.object(b3.shutil, "which", return_value="mame"), \
             patch.object(b3, "call",
                          return_value=SimpleNamespace(stdout="0.289", stderr="")):
            with self.assertRaisesRegex(b3.B3Stop, "MAME_CAPTURE_OUTPUT_ALREADY_EXISTS"):
                b3.capture_tape("mame", "roms")
        self.assertEqual(b3.OUT_TAPE.read_bytes(), original)

    def test_diagnosis_empty_capture_returns_safe_zero_counts(self):
        path = self.tape([])
        detail = b3.summarize_capture(path)
        self.assertEqual(detail["kind"], "GNG_AUDIO_B3_CAPTURE_DIAG_V1")
        self.assertEqual(detail["ym_writes"], 0)
        self.assertEqual(detail["events_total"], 0)
        self.assertEqual(detail["activity_hint"], "NO_TAP_BUS_EVENTS_OBSERVED")
        self.assertNotIn(str(path), json.dumps(detail))

    def test_diagnosis_splits_main_sound_commands_vs_sound_cpu_reads(self):
        path = self.tape([self.event(1, "SOUNDLATCH_WRITE", 10, 0x3a00, 0x11)])
        detail = b3.summarize_capture(path)
        self.assertEqual(detail["activity_hint"],
                         "MAIN_SOUND_COMMANDS_BUT_NO_Z80_LATCH_READS")
        self.assertEqual(detail["sound_commands"], 1)
        self.assertEqual(detail["latch_reads"], 0)
        self.assertFalse(detail["z80_execution_verified"])
        with self.assertRaisesRegex(b3.B3Stop, "TAPE_NO_YM_EVENTS"):
            b3.inspect_tape(path)
        path = self.tape([self.event(1, "Z80_LATCH_READ", 12, 0xc800, 0x11)])
        self.assertEqual(b3.summarize_capture(path)["activity_hint"],
                         "Z80_LATCH_READS_BUT_NO_YM_WRITES")

    def test_diagnose_cli_needs_no_ymfm_or_private_rom(self):
        self.tape([self.event(1, "AUDIO_RESET_WRITE", 1, 0x3d01, 0)])
        output = io.StringIO()
        with patch.object(b3, "verify_repository_privacy", return_value=True), \
             redirect_stdout(output):
            rc = b3.main(["--diagnose", "--tape", str(b3.OUT_TAPE)])
        self.assertEqual(rc, 0)
        summary = json.loads(output.getvalue())
        self.assertEqual(summary["status"], "ACTIVITY_SUMMARY_NOT_NATIVE_PARITY")
        self.assertEqual(summary["reset_asserted_writes"], 1)
        self.assertEqual(summary["activity_hint"],
                         "RESET_WRITE_ASSERTED_NO_RELEASE_OBSERVED")

    def test_capture_id_preserves_previous_output_and_uses_unique_private_env(self):
        from types import SimpleNamespace
        self.tape([self.event(1, "YM2203_WRITE", 1, 0xe000, 0x44)])
        original = b3.OUT_TAPE.read_bytes()
        output = []
        def mock_mame(argv, **kwargs):
            output.append((argv, kwargs.get("env", {}).get("GNG_AUDIO_TAP_OUT")))
            dest = self.base / "mame-audio-events-second_run.jsonl"
            dest.write_text(json.dumps(self.event(1, "YM2203_WRITE",
                                                  10, 0xe001, 9)) + "\n")
            return SimpleNamespace(returncode=0)
        with patch.object(b3.shutil, "which", return_value="mame"), \
             patch.object(b3, "call", return_value=SimpleNamespace(
                 stdout="0.289", stderr="")), \
             patch.object(b3.subprocess, "run", side_effect=mock_mame):
            new_tape = b3.capture_tape("mame", "roms", capture_id="second_run")
        self.assertEqual(new_tape, self.base / "mame-audio-events-second_run.jsonl")
        self.assertEqual(output[0][1], str(new_tape))
        self.assertIn(str(self.base / "mame-native-audio-second_run.wav"), output[0][0])
        self.assertEqual(b3.OUT_TAPE.read_bytes(), original)

    def test_capture_id_rejects_traversal_and_preexisting_named_output(self):
        from types import SimpleNamespace
        with patch.object(b3.shutil, "which", return_value="mame"), \
             patch.object(b3, "call", return_value=SimpleNamespace(
                 stdout="0.289", stderr="")):
            with self.assertRaisesRegex(b3.B3Stop, "MAME_CAPTURE_ID_INVALID"):
                b3.capture_tape("mame", "roms", capture_id="../outside")
            prior = self.base / "mame-audio-events-retry2.jsonl"
            prior.write_text("old")
            with self.assertRaisesRegex(b3.B3Stop,
                                        "MAME_CAPTURE_OUTPUT_ALREADY_EXISTS"):
                b3.capture_tape("mame", "roms", capture_id="retry2")
            self.assertEqual(prior.read_text(), "old")

    def test_tap_heartbeat_reports_frames_even_with_zero_bus_events(self):
        self.tape([])
        health = self.base / "mame-audio-health.json"
        health.write_text(json.dumps({
            "kind": "GNG_AUDIO_MAME_TAP_HEALTH_V1",
            "tap_armed": True,
            "capture_closed": True,
            "frames_observed": 320,
            "ym_callbacks": 0,
            "main_latch_callbacks": 0,
            "sound_latch_callbacks": 0,
            "reset_callbacks": 0,
            "disabled_side_effect_callbacks": 0
        }))
        result = b3.summarize_capture(b3.OUT_TAPE)
        self.assertEqual(result["activity_hint"],
                         "FRAMES_ADVANCED_NO_BUS_TAP_CALLBACKS")
        self.assertEqual(result["tap_health"]["frames_observed"], 320)
        self.assertFalse(result["z80_execution_verified"])
        self.assertNotIn(str(health), json.dumps(result))

    def test_tap_heartbeat_rejects_forged_or_untrusted_values(self):
        self.tape([])
        health = self.base / "mame-audio-health.json"
        health.write_text(json.dumps({
            "kind": "GNG_AUDIO_MAME_TAP_HEALTH_V1",
            "tap_armed": True,
            "capture_closed": True,
            "frames_observed": "1000"
        }))
        self.assertEqual(b3.summarize_capture(b3.OUT_TAPE)["tap_health"]["status"],
                         "INVALID_TAP_HEALTH")

    def test_no_ym_stop_returns_diagnostic_without_file_contents(self):
        path = self.tape([self.event(1, "SOUNDLATCH_WRITE", 20, 0x3a00, 55)])
        output = io.StringIO()
        with patch.object(b3, "verify_repository_privacy", return_value=True), \
             patch.object(b3, "verify_rom_identity", return_value=True), \
             redirect_stdout(output):
            rc = b3.main(["--tape", str(path), "--ymfm-src",
                          str(self.base)])
        self.assertEqual(rc, 2)
        result = json.loads(output.getvalue())
        self.assertEqual(result["reason"], "TAPE_NO_YM_EVENTS")
        self.assertEqual(result["capture_diagnostics"]["sound_commands"], 1)
        self.assertNotIn(str(self.base), output.getvalue())

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
