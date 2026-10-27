#!/usr/bin/env python3
"""B3: private MAME YM2203 tape -> verified ymfm renderer -> WAV gate.

Real ROM, captured events, generated TSV, and WAV never leave out/audio.
No PCM or MAME parity claim; only non-silent lab audio from native YM writes.
"""
import argparse
import hashlib
import json
import math
import shutil
import struct
import subprocess
import sys
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PRIVATE = ROOT / "out" / "audio"
EXPECTED_RATE = 62500
MAX_EVENTS = 250000
MAX_CAPTURE_BYTES = 64 * 1024 * 1024
EXPECTED_ROM_SHA1 = "7ef9ec5c2072e21c787a6bbf700033f50c759c1d"
SAMPLE_LIMIT = 30000
ALLOWED_KINDS = frozenset({
    "SOUNDLATCH_WRITE", "AUDIO_RESET_WRITE", "Z80_LATCH_READ",
    "YM2203_WRITE",
})
OUT_TAPE = PRIVATE / "mame-audio-events.jsonl"
OUT_TSV = PRIVATE / "b3-ym-events.tsv"
OUT_WAV = PRIVATE / "b3-first-audio.wav"
OUT_REPORT = PRIVATE / "b3-checkpoint.json"
OUT_MAME_WAV = PRIVATE / "mame-native-audio.wav"


class B3Stop(Exception):
    pass


def ensure_private(p, *, must_exist=False):
    """Deny traversal, symlinks and outputs anywhere outside ignored out/audio."""
    p = Path(p)
    if not p.is_absolute():
        p = ROOT / p
    candidate = p.absolute()
    if not candidate.is_relative_to(PRIVATE) or candidate == PRIVATE:
        raise B3Stop("PRIVATE_PATH_REQUIRED")
    if candidate.resolve() != candidate:
        raise B3Stop("PRIVATE_PATH_SYMLINK_OR_TRAVERSAL")
    if must_exist and not candidate.is_file():
        raise B3Stop("PRIVATE_INPUT_MISSING")
    if candidate.exists() and candidate.is_symlink():
        raise B3Stop("PRIVATE_PATH_SYMLINK")
    return candidate


def call(argv, *, timeout=120):
    try:
        result = subprocess.run(argv, cwd=ROOT, timeout=timeout, capture_output=True,
                                text=True, check=False)
    except (OSError, subprocess.TimeoutExpired):
        raise B3Stop("LOCAL_COMMAND_STOP") from None
    if result.returncode:
        # The child output can contain paths, raw timings, ROM data or audio.
        raise B3Stop("LOCAL_COMMAND_STOP")
    return result


def verify_repository_privacy():
    # A private path alone does not stop accidental git-add -f; refuse tracked outputs.
    try:
        ignore = (ROOT / ".gitignore").read_text(encoding="utf8").splitlines()
        tracked = subprocess.run(["git", "ls-files", "--", "out"],
                                 cwd=ROOT, capture_output=True, text=True,
                                 timeout=10, check=False)
    except (OSError, subprocess.TimeoutExpired):
        raise B3Stop("GIT_PRIVACY_GUARD_STOP") from None
    if "out/" not in ignore or tracked.returncode != 0 or tracked.stdout.strip():
        raise B3Stop("GIT_PRIVACY_GUARD_STOP")
    return True


def verify_rom_identity():
    rom = ensure_private(PRIVATE / "gg2.bin", must_exist=True)
    if rom.stat().st_size != 32768:
        raise B3Stop("LOCAL_SOUND_ROM_IDENTITY_STOP")
    with rom.open("rb") as stream:
        identity = hashlib.sha1(stream.read()).hexdigest()
    if identity != EXPECTED_ROM_SHA1:
        raise B3Stop("LOCAL_SOUND_ROM_IDENTITY_STOP")
    # Does not independently establish MAME's loaded ROM or gameplay scenario.
    return True


def capture_tape(mame, rompath):
    if not shutil.which(mame) and not Path(mame).is_file():
        raise B3Stop("MAME_NOT_FOUND")
    version = call([mame, "-version"], timeout=10)
    if "0.289" not in (version.stdout + version.stderr):
        raise B3Stop("MAME_VERSION_NOT_PINNED_0289")
    if OUT_TAPE.exists() or OUT_MAME_WAV.exists():
        # Do not destroy an earlier native session's private evidence.
        # To reuse it choose --tape; otherwise archive/rename it privately first.
        raise B3Stop("MAME_CAPTURE_OUTPUT_ALREADY_EXISTS")
    argv = [mame, "gngb", "-rompath", str(rompath),
            "-autoboot_script", "scripts/audio_mame_taps.lua",
            "-autoboot_delay", "0", "-wavwrite", str(OUT_MAME_WAV)]
    # Interactive native session; stop MAME after representative title/gameplay audio.
    try:
        result = subprocess.run(argv, cwd=ROOT, timeout=180, stdout=subprocess.DEVNULL,
                                stderr=subprocess.DEVNULL, check=False)
    except (OSError, subprocess.TimeoutExpired):
        raise B3Stop("MAME_CAPTURE_STOP") from None
    if result.returncode != 0:
        raise B3Stop("MAME_CAPTURE_STOP")
    return ensure_private(OUT_TAPE, must_exist=True)


def inspect_tape(tape):
    tape = ensure_private(tape, must_exist=True)
    if tape.stat().st_size > MAX_CAPTURE_BYTES:
        raise B3Stop("TAPE_TOO_LARGE")
    kinds = {k: 0 for k in ALLOWED_KINDS}
    prior_tick = -1
    prior_frame = -1
    prior_seq = 0
    first_ym_tick = None
    reset_after_first_write = False
    lines = 0
    with tape.open("r", encoding="utf8") as handle:
        for line in handle:
            if not line.strip():
                continue
            lines += 1
            if lines > MAX_EVENTS:
                raise B3Stop("TAPE_EVENT_LIMIT")
            try:
                row = json.loads(line)
            except (ValueError, UnicodeError):
                raise B3Stop("TAPE_BAD_JSON") from None
            if not isinstance(row, dict) or row.get("kind") not in ALLOWED_KINDS:
                raise B3Stop("TAPE_BAD_KIND")
            seq, tick, frame = row.get("seq"), row.get("tick12m"), row.get("frame")
            addr, value = row.get("address"), row.get("value")
            if any(type(n) is not int for n in (seq, tick, frame, addr, value)):
                raise B3Stop("TAPE_BAD_TYPES")
            if seq != prior_seq + 1 or tick < prior_tick or frame < prior_frame or tick < 0 or frame < 0:
                raise B3Stop("TAPE_BAD_CHRONOLOGY")
            if not 0 <= value <= 255:
                raise B3Stop("TAPE_BAD_VALUE")
            k = row["kind"]
            if k == "YM2203_WRITE":
                if not 0xe000 <= addr <= 0xe003:
                    raise B3Stop("TAPE_BAD_YM_PORT")
                if first_ym_tick is None:
                    first_ym_tick = tick
            elif k == "AUDIO_RESET_WRITE":
                if addr != 0x3d01 or value not in (0, 1):
                    raise B3Stop("TAPE_BAD_RESET")
                if first_ym_tick is not None and value == 0:
                    reset_after_first_write = True
            elif k == "SOUNDLATCH_WRITE" and addr != 0x3a00:
                raise B3Stop("TAPE_BAD_LATCH")
            elif k == "Z80_LATCH_READ" and addr != 0xc800:
                raise B3Stop("TAPE_BAD_LATCH")
            kinds[k] += 1
            prior_tick, prior_frame, prior_seq = tick, frame, seq
    if not kinds["YM2203_WRITE"]:
        raise B3Stop("TAPE_NO_YM_EVENTS")
    if reset_after_first_write:
        # Current ymfm offline renderer has no timed reset event support.
        raise B3Stop("TAPE_MID_STREAM_RESET_UNSUPPORTED")
    return {"events": lines, "ym_writes": kinds["YM2203_WRITE"],
            "ym_chip_0_writes": None, "sound_commands": kinds["SOUNDLATCH_WRITE"],
            "latch_reads": kinds["Z80_LATCH_READ"],
            "first_ym_tick": first_ym_tick}


def wav_metrics(source, *, expected_rate=None, max_ms=SAMPLE_LIMIT):
    source = ensure_private(source, must_exist=True)
    try:
        with wave.open(str(source), "rb") as wav:
            channels = wav.getnchannels()
            width = wav.getsampwidth()
            rate = wav.getframerate()
            frames = wav.getnframes()
            compression = wav.getcomptype()
            if channels not in (1, 2) or width != 2 or rate <= 0 or frames <= 0 or compression != "NONE":
                raise B3Stop("WAV_FORMAT_INVALID")
            if expected_rate is not None and (rate != expected_rate or channels != 1):
                raise B3Stop("WAV_FORMAT_INVALID")
            if frames > max_ms * rate // 1000 + rate:
                raise B3Stop("WAV_TOO_LONG")
            payload = wav.readframes(frames)
    except (wave.Error, EOFError, OSError, struct.error):
        raise B3Stop("WAV_INVALID") from None
    if len(payload) != frames * channels * 2:
        raise B3Stop("WAV_TRUNCATED")
    count = frames * channels
    square = 0
    peak = 0
    clipped = 0
    nonzero = 0
    # Aggregate only; no waveform data leaves ignored out/audio.
    for (sample,) in struct.iter_unpack("<h", payload):
        v = abs(sample)
        square += sample * sample
        peak = max(peak, v)
        clipped += v >= 32767
        nonzero += v != 0
    return {"rate_hz": rate, "channels": channels, "frames": frames,
            "duration_ms": round(1000 * frames / rate),
            "peak": peak, "rms": round(math.sqrt(square / count), 3),
            "nonzero_samples": nonzero,
            "clipped_fraction": round(clipped / count, 6)}


def run_b3(*, tape, ymfm_source, duration_ms=5000, native_wav=None,
           source_mode="OPERATOR_PROVIDED_TAPE"): 
    if type(duration_ms) is not int or not 1 <= duration_ms <= SAMPLE_LIMIT:
        raise B3Stop("DURATION_INVALID")
    if source_mode not in ("OPERATOR_PROVIDED_TAPE", "MAME_SESSION_CAPTURE"):
        raise B3Stop("CAPTURE_SOURCE_INVALID")
    # Regression / privacy guard is independent of partial Z80 reachability.
    verify_rom_identity()
    integrity = inspect_tape(tape)
    source = Path(ymfm_source).expanduser().resolve()
    if not source.is_dir():
        raise B3Stop("YMFM_SOURCE_MISSING")
    call(["bash", "scripts/audio_ym_native_build.sh", str(source)])
    call([sys.executable, "scripts/audio_ym_events_to_tsv.py",
          "--in-jsonl", str(ensure_private(tape, must_exist=True)),
          "--out-tsv", str(ensure_private(OUT_TSV)),
          "--window-ms", str(duration_ms)])
    call([str(ensure_private(PRIVATE / "ym2203_lab", must_exist=True)),
          str(ensure_private(OUT_TSV, must_exist=True)),
          str(ensure_private(OUT_WAV)), str(duration_ms)])
    signal = wav_metrics(OUT_WAV, expected_rate=EXPECTED_RATE)
    if signal["nonzero_samples"] == 0 or signal["peak"] == 0:
        raise B3Stop("PCM_SILENT_STOP")
    reference = "NOT_AVAILABLE"
    native = None
    if native_wav is not None:
        native = wav_metrics(native_wav, max_ms=180000)
        reference = "REFERENCE_DIAGNOSTICS_ONLY" if native["peak"] else "REFERENCE_SILENT"
    contrast = None
    if native is not None:
        # Native MAME WAV begins at the emulator session's audio epoch,
        # while the YM tape is rebased to its first write. No sample/time
        # alignment is asserted; ratios are descriptive ONLY.
        contrast = {
            "duration_difference_ms_unaligned": signal["duration_ms"] - native["duration_ms"],
            "rms_ratio_unaligned": (
                round(signal["rms"] / native["rms"], 4) if native["rms"] else None
            ),
            "peak_ratio_unaligned": (
                round(signal["peak"] / native["peak"], 4) if native["peak"] else None
            ),
            "sample_timeline_aligned": False,
            "waveform_parity_verified": False,
        }
    result = {
        "kind": "GNG_AUDIO_B3_CHECKPOINT_V1",
        "status": "LAB_NON_SILENT_FROM_MAME_YM_EVENTS_NOT_CERTIFIED",
        "rom_identity": "SHA1_MATCH_LOCAL_ONLY",
        "event_capture_source": source_mode,
        "mame_loaded_same_rom_verified": False,
        "events_total": integrity["events"],
        "ym_writes": integrity["ym_writes"],
        "sound_commands": integrity["sound_commands"],
        "latch_reads": integrity["latch_reads"],
        "wav": signal,
        "reference_status": reference,
        "native_reference_stats": native,
        "native_activity_contrast": contrast,
        "mame_input_alignment_verified": False,
        "z80_native_parity_verified": False,
        "ym_waveform_parity_verified": False,
        "gameplay_audio_verified": False,
        "lab_pcm_generated": True,
        "private_outputs_only": True,
        "rom_bytes_exported": False,
    }
    ensure_private(OUT_REPORT).write_text(json.dumps(result, indent=2) + "\n", encoding="utf8")
    return result


def main(argv=None):
    p = argparse.ArgumentParser(description="Private YM2203 B3 PCM lab pipeline")
    sources = p.add_mutually_exclusive_group(required=True)
    sources.add_argument("--capture", action="store_true",
                         help="Launch interactive MAME and record native YM bus writes")
    sources.add_argument("--tape", type=Path,
                         help="Existing private MAME audio JSONL (out/audio only)")
    p.add_argument("--ymfm-src", type=Path, required=True, help="Pinned ymfm git checkout")
    p.add_argument("--duration-ms", type=int, default=5000)
    p.add_argument("--mame", default="mame")
    p.add_argument("--rompath", default="roms")
    p.add_argument("--reference-wav", type=Path,
                   help="Optional private native WAV; diagnostics ONLY, not parity")
    args = p.parse_args(argv)
    try:
        PRIVATE.mkdir(parents=True, exist_ok=True)
        if PRIVATE.resolve() != PRIVATE:
            raise B3Stop("PRIVATE_ROOT_SYMLINK")
        verify_repository_privacy()
        tape = capture_tape(args.mame, args.rompath) if args.capture else args.tape
        reference = args.reference_wav
        if args.capture and reference is None and OUT_MAME_WAV.exists():
            reference = OUT_MAME_WAV
        report = run_b3(tape=tape, ymfm_source=args.ymfm_src,
                        duration_ms=args.duration_ms, native_wav=reference,
                        source_mode=("MAME_SESSION_CAPTURE" if args.capture
                                     else "OPERATOR_PROVIDED_TAPE"))
        print(json.dumps(report, separators=(",", ":")))
        return 0
    except B3Stop as e:
        print(json.dumps({"kind": "GNG_AUDIO_B3_CHECKPOINT_V1",
                          "status": "STOP", "reason": str(e),
                          "audio_working": False, "rom_bytes_exported": False}))
        return 2
    except (OSError, ValueError, OverflowError):
        print(json.dumps({"kind": "GNG_AUDIO_B3_CHECKPOINT_V1",
                          "status": "STOP", "reason": "B3_IO_OR_INPUT_STOP",
                          "audio_working": False, "rom_bytes_exported": False}))
        return 2


if __name__ == "__main__":
    sys.exit(main())
