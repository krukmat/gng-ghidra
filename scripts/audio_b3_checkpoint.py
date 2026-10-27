#!/usr/bin/env python3
"""B3: private MAME YM2203 tape -> verified ymfm renderer -> WAV gate.

Real ROM, captured events, generated TSV, and WAV never leave out/audio.
No PCM or MAME parity claim; only non-silent lab audio from native YM writes.
"""
import argparse
import hashlib
import json
import math
import re
import shutil
import struct
import subprocess
import sys
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PRIVATE = ROOT / "out" / "audio"
EXPECTED_RATE = 62500
MAX_EVENTS = 1000000
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
    """Deny path escapes/symlinks while allowing canonical OS path aliases.

    On macOS /var may resolve to /private/var, including Python tempfile's
    default location. That system-level alias is safe when BOTH the intended
    private root and the candidate resolve within the same canonical root.
    """
    p = Path(p)
    candidate = (p if p.is_absolute() else ROOT / p).absolute()
    private_root = PRIVATE.absolute()
    # Traversal is denied even if resolving it would re-enter the root.
    if ".." in candidate.parts or not candidate.is_relative_to(private_root) \
            or candidate == private_root:
        raise B3Stop("PRIVATE_PATH_REQUIRED")
    canonical_root = private_root.resolve()
    canonical_candidate = candidate.resolve()
    if (not canonical_candidate.is_relative_to(canonical_root)
            or canonical_candidate == canonical_root):
        raise B3Stop("PRIVATE_PATH_SYMLINK_OR_TRAVERSAL")
    # A symlink below our designated root is never accepted, even if its
    # destination is still inside out/audio. OS parent aliases are allowed.
    current = private_root
    for part in candidate.relative_to(private_root).parts:
        current = current / part
        if current.is_symlink():
            raise B3Stop("PRIVATE_PATH_SYMLINK_OR_TRAVERSAL")
    if must_exist and not candidate.is_file():
        raise B3Stop("PRIVATE_INPUT_MISSING")
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


def capture_tape(mame, rompath, *, allow_unpinned_lab=False,
                 metadata=None, capture_id=None):
    if not shutil.which(mame) and not Path(mame).is_file():
        raise B3Stop("MAME_NOT_FOUND")
    version = call([mame, "-version"], timeout=10)
    # Keep only a canonical numeric version. Do not echo arbitrary binary output.
    match = re.search(r"(?<![0-9])0\.[0-9]{3}(?![0-9])",
                      version.stdout + "\n" + version.stderr)
    if match is None:
        raise B3Stop("MAME_VERSION_UNRECOGNIZED")
    actual_version = match.group(0)
    is_pinned = actual_version == "0.289"
    if not is_pinned and not allow_unpinned_lab:
        raise B3Stop("MAME_VERSION_NOT_PINNED_0289")
    if metadata is not None:
        metadata.update({"mame_version": actual_version,
                         "mame_version_pinned": is_pinned})
    if capture_id is not None and (type(capture_id) is not str or
            re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,31}", capture_id) is None):
        raise B3Stop("MAME_CAPTURE_ID_INVALID")
    tape_path = (OUT_TAPE if capture_id is None else
                 PRIVATE / ("mame-audio-events-" + capture_id + ".jsonl"))
    wav_path = (OUT_MAME_WAV if capture_id is None else
                PRIVATE / ("mame-native-audio-" + capture_id + ".wav"))
    health_path = (PRIVATE / "mame-audio-health.json" if capture_id is None else
                   PRIVATE / ("mame-audio-health-" + capture_id + ".json"))
    tape_path = ensure_private(tape_path)
    wav_path = ensure_private(wav_path)
    health_path = ensure_private(health_path)
    if tape_path.exists() or wav_path.exists() or health_path.exists():
        # Preserve operator's prior MAME evidence, never overwrite on retry.
        raise B3Stop("MAME_CAPTURE_OUTPUT_ALREADY_EXISTS")
    if metadata is not None:
        metadata["reference_wav_path"] = wav_path
        metadata["tap_health_path"] = health_path
    argv = [mame, "gngb", "-rompath", str(rompath),
            "-autoboot_script", "scripts/audio_mame_taps.lua",
            "-autoboot_delay", "0", "-wavwrite", str(wav_path)]
    # Interactive native session; stop MAME after representative title/gameplay audio.
    try:
        import os
        env = dict(os.environ)
        env["GNG_AUDIO_TAP_OUT"] = str(tape_path)
        env["GNG_AUDIO_TAP_HEALTH_OUT"] = str(health_path)
        result = subprocess.run(argv, cwd=ROOT, timeout=180, stdout=subprocess.DEVNULL,
                                stderr=subprocess.DEVNULL, env=env, check=False)
    except (OSError, subprocess.TimeoutExpired):
        raise B3Stop("MAME_CAPTURE_STOP") from None
    if result.returncode != 0:
        raise B3Stop("MAME_CAPTURE_STOP")
    return ensure_private(tape_path, must_exist=True)


def inspect_tape(tape, *, require_ym=True):
    tape = ensure_private(tape, must_exist=True)
    if tape.stat().st_size > MAX_CAPTURE_BYTES:
        raise B3Stop("TAPE_TOO_LARGE")
    kinds = {k: 0 for k in ALLOWED_KINDS}
    ym_chip_writes = [0, 0]
    prior_tick = -1
    prior_frame = -1
    prior_seq = 0
    first_ym_tick = None
    reset_after_first_write = False
    resets_asserted = 0
    resets_released = 0
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
                ym_chip_writes[int(addr >= 0xe002)] += 1
                if first_ym_tick is None:
                    first_ym_tick = tick
            elif k == "AUDIO_RESET_WRITE":
                if addr != 0x3d01 or value not in (0, 1):
                    raise B3Stop("TAPE_BAD_RESET")
                resets_asserted += (value == 0)
                resets_released += (value == 1)
                if first_ym_tick is not None and value == 0:
                    reset_after_first_write = True
            elif k == "SOUNDLATCH_WRITE" and addr != 0x3a00:
                raise B3Stop("TAPE_BAD_LATCH")
            elif k == "Z80_LATCH_READ" and addr != 0xc800:
                raise B3Stop("TAPE_BAD_LATCH")
            kinds[k] += 1
            prior_tick, prior_frame, prior_seq = tick, frame, seq
    if require_ym and not kinds["YM2203_WRITE"]:
        raise B3Stop("TAPE_NO_YM_EVENTS")
    if reset_after_first_write:
        # Current ymfm offline renderer has no timed reset event support.
        raise B3Stop("TAPE_MID_STREAM_RESET_UNSUPPORTED")
    return {"events": lines, "ym_writes": kinds["YM2203_WRITE"],
            "ym_chip_0_writes": ym_chip_writes[0],
            "ym_chip_1_writes": ym_chip_writes[1],
            "sound_commands": kinds["SOUNDLATCH_WRITE"],
            "latch_reads": kinds["Z80_LATCH_READ"],
            "first_ym_tick": first_ym_tick,
            "reset_asserted_writes": resets_asserted,
            "reset_released_writes": resets_released,
            "last_observed_frame": prior_frame,
            "last_observed_tick12m": prior_tick}


def inspect_chronology_diagnostics(tape):
    """Sanitized, read-only audit of recorded event ordering.

    Never return raw tick/frame/sequence values, bus addresses or YM bytes.
    This function is diagnostic only; it can NEVER certify or repair a tape.
    """
    tape = ensure_private(tape, must_exist=True)
    if tape.stat().st_size > MAX_CAPTURE_BYTES:
        raise B3Stop("TAPE_TOO_LARGE")
    counters = {
        "records_scanned": 0,
        "bad_sequence": 0,
        "sequence_gaps": 0,
        "sequence_duplicates_or_backwards": 0,
        "tick_regressions": 0,
        "frame_regressions": 0,
        "negative_clock_or_frame": 0,
        "invalid_chronology_types": 0,
        "invalid_rows": 0,
    }
    first_bad = None
    last_seq, last_tick, last_frame = 0, -1, -1
    with tape.open("r", encoding="utf8") as stream:
        for line in stream:
            if not line.strip():
                continue
            counters["records_scanned"] += 1
            index = counters["records_scanned"]
            if index > MAX_EVENTS:
                raise B3Stop("TAPE_EVENT_LIMIT")
            try:
                row = json.loads(line)
            except (ValueError, UnicodeError):
                raise B3Stop("TAPE_BAD_JSON") from None
            if not isinstance(row, dict) or row.get("kind") not in ALLOWED_KINDS:
                counters["invalid_rows"] += 1
                if first_bad is None:
                    first_bad = index
                continue
            seq, tick, frame = row.get("seq"), row.get("tick12m"), row.get("frame")
            if any(type(v) is not int for v in (seq, tick, frame)):
                counters["invalid_chronology_types"] += 1
                if first_bad is None:
                    first_bad = index
                continue
            bad = False
            if seq != last_seq + 1:
                counters["bad_sequence"] += 1
                if seq > last_seq + 1:
                    counters["sequence_gaps"] += 1
                else:
                    counters["sequence_duplicates_or_backwards"] += 1
                bad = True
            if tick < last_tick:
                counters["tick_regressions"] += 1
                bad = True
            if frame < last_frame:
                counters["frame_regressions"] += 1
                bad = True
            if tick < 0 or frame < 0:
                counters["negative_clock_or_frame"] += 1
                bad = True
            if bad and first_bad is None:
                first_bad = index
            last_seq, last_tick, last_frame = seq, tick, frame
    return {
        "kind": "GNG_AUDIO_B3_CHRONOLOGY_DIAG_V1",
        "status": ("CHRONOLOGY_INVALID_NOT_RENDERABLE" if first_bad
                   else "NO_CHRONOLOGY_ERROR_OBSERVED"),
        "first_bad_event_index": first_bad,
        **counters,
        "capture_validated": False,
        "native_parity_verified": False,
        "rom_bytes_exported": False,
    }


def read_tap_health(tape):
    """Read allowlisted Lua instrumentation counters; never raw capture content."""
    tape = ensure_private(tape, must_exist=True)
    match = re.fullmatch(r"mame-audio-events(?:-([A-Za-z0-9_-]+))?\.jsonl",
                         tape.name)
    if match is None:
        return {"status": "NOT_AVAILABLE_NONSTANDARD_TAPE_NAME"}
    suffix = ("-" + match.group(1)) if match.group(1) else ""
    target = ensure_private(PRIVATE / ("mame-audio-health" + suffix + ".json"))
    if not target.is_file():
        return {"status": "NOT_AVAILABLE_LEGACY_CAPTURE"}
    if target.stat().st_size > 4096:
        return {"status": "INVALID_TAP_HEALTH"}
    try:
        obj = json.loads(target.read_text(encoding="utf8"))
    except (OSError, ValueError, UnicodeError):
        return {"status": "INVALID_TAP_HEALTH"}
    fields = ("frames_observed", "ym_callbacks", "main_latch_callbacks",
              "sound_latch_callbacks", "reset_callbacks",
              "disabled_side_effect_callbacks")
    extras = ("written_events", "format_errors", "write_errors", "flush_errors")
    detailed = ("clock_errors", "value_errors", "clock_fallbacks")
    fields_v3 = ("frame_errors", "address_errors", "data_errors",
                 "frame_fallbacks")
    present = [k in obj for k in extras] if isinstance(obj, dict) else []
    extra_present = [k in obj for k in detailed] if isinstance(obj, dict) else []
    v3_present = [k in obj for k in fields_v3] if isinstance(obj, dict) else []
    if (not isinstance(obj, dict) or
        obj.get("kind") != "GNG_AUDIO_MAME_TAP_HEALTH_V1" or
        obj.get("tap_armed") is not True or
        type(obj.get("capture_closed")) is not bool or
        any(type(obj.get(k)) is not int or obj.get(k) < 0 for k in fields)
        or (any(present) and not all(present))
        or (all(present) and any(type(obj.get(k)) is not int or
            obj.get(k) < 0 for k in extras))
        or (any(extra_present) and not all(extra_present))
        or (all(extra_present) and any(type(obj.get(k)) is not int or
            obj.get(k) < 0 for k in detailed))
        or (any(v3_present) and not all(v3_present))
        or (all(v3_present) and any(type(obj.get(k)) is not int or
            obj.get(k) < 0 for k in fields_v3))):
        return {"status": "INVALID_TAP_HEALTH"}
    return {"status": "ARMED_CAPTURE_CLOSED" if obj["capture_closed"]
            else "ARMED_CAPTURE_NOT_CLOSED",
            "tap_armed": True,
            "capture_closed": obj["capture_closed"],
            **{k: obj[k] for k in fields},
            **({k: obj[k] for k in extras} if all(present) else {}),
            **({k: obj[k] for k in detailed} if all(extra_present) else {}),
            **({k: obj[k] for k in fields_v3} if all(v3_present) else {})}


def summarize_capture(tape):
    """Diagnostic metadata only; never emit raw ROM, YM register values, or audio."""
    try:
        report = inspect_tape(tape, require_ym=False)
    except B3Stop as error:
        if str(error) != "TAPE_BAD_CHRONOLOGY":
            raise
        chronology = inspect_chronology_diagnostics(tape)
        return {
            "kind": "GNG_AUDIO_B3_CAPTURE_DIAG_V1",
            "status": "STOP_CHRONOLOGY_NOT_RENDERABLE",
            "activity_hint": "CHRONOLOGY_INVALID_NEEDS_CLASSIFICATION",
            "chronology": chronology,
            "tap_health": read_tap_health(tape),
            "native_parity_verified": False,
            "rom_bytes_exported": False,
        }
    tap_health = read_tap_health(tape)
    callbacks = sum(tap_health.get(k, 0) for k in (
        "ym_callbacks", "main_latch_callbacks",
        "sound_latch_callbacks", "reset_callbacks"))
    if report["events"] == 0 and tap_health.get("clock_errors", 0) > 0:
        hint = "LUA_CLOCK_ACCESS_FAILURES"
    elif report["events"] == 0 and tap_health.get("address_errors", 0) > 0:
        hint = "LUA_ADDRESS_CONVERSION_FAILURES"
    elif report["events"] == 0 and tap_health.get("data_errors", 0) > 0:
        hint = "LUA_DATA_CONVERSION_FAILURES"
    elif report["events"] == 0 and tap_health.get("frame_errors", 0) > 0:
        hint = "LUA_FRAME_CONVERSION_FAILURES"
    elif report["events"] == 0 and tap_health.get("value_errors", 0) > 0:
        hint = "LUA_NUMERIC_CONVERSION_FAILURES"
    elif report["events"] == 0 and tap_health.get("format_errors", 0) > 0:
        hint = "LUA_EVENT_SERIALIZATION_FAILURES"
    elif report["events"] == 0 and (
            tap_health.get("write_errors", 0) > 0 or
            tap_health.get("flush_errors", 0) > 0):
        hint = "LUA_EVENT_FILE_WRITE_FAILURES"
    elif report["events"] == 0 and tap_health.get("written_events", 0) > 0:
        hint = "LUA_WROTE_ROWS_BUT_TAPE_IS_EMPTY"
    elif report["events"] == 0 and callbacks > 0:
        hint = "BUS_CALLBACKS_OBSERVED_BUT_NO_JSONL_ROWS"
    elif report["events"] == 0 and tap_health.get("status") == "ARMED_CAPTURE_CLOSED" \
            and tap_health.get("frames_observed", 0) > 0:
        hint = "FRAMES_ADVANCED_NO_BUS_TAP_CALLBACKS"
    elif report["events"] == 0 and tap_health.get("tap_armed") is True \
            and tap_health.get("frames_observed") == 0:
        hint = "TAPS_ARMED_BUT_NO_FRAMES_OBSERVED"
    elif report["events"] == 0:
        hint = "NO_TAP_BUS_EVENTS_OBSERVED"
    elif report["ym_writes"]:
        hint = "YM_EVENTS_PRESENT"
    elif report["latch_reads"]:
        hint = "Z80_LATCH_READS_BUT_NO_YM_WRITES"
    elif report["sound_commands"]:
        hint = "MAIN_SOUND_COMMANDS_BUT_NO_Z80_LATCH_READS"
    elif report["reset_asserted_writes"] and not report["reset_released_writes"]:
        hint = "RESET_WRITE_ASSERTED_NO_RELEASE_OBSERVED"
    else:
        hint = "NO_YM_WRITES_CAUSE_UNDETERMINED"
    return {
        "kind": "GNG_AUDIO_B3_CAPTURE_DIAG_V1",
        "status": "ACTIVITY_SUMMARY_NOT_NATIVE_PARITY",
        "events_total": report["events"],
        "ym_writes": report["ym_writes"],
        "ym_chip_0_writes": report["ym_chip_0_writes"],
        "ym_chip_1_writes": report["ym_chip_1_writes"],
        "sound_commands": report["sound_commands"],
        "latch_reads": report["latch_reads"],
        "reset_asserted_writes": report["reset_asserted_writes"],
        "reset_released_writes": report["reset_released_writes"],
        "last_observed_frame": report["last_observed_frame"],
        "activity_hint": hint,
        "tap_health": tap_health,
        "z80_execution_verified": False,
        "mame_tap_coverage_verified": False,
        "rom_bytes_exported": False,
    }


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
           source_mode="OPERATOR_PROVIDED_TAPE", mame_metadata=None):
    if type(duration_ms) is not int or not 1 <= duration_ms <= SAMPLE_LIMIT:
        raise B3Stop("DURATION_INVALID")
    if source_mode not in ("OPERATOR_PROVIDED_TAPE", "MAME_SESSION_CAPTURE"):
        raise B3Stop("CAPTURE_SOURCE_INVALID")
    # Regression / privacy guard is independent of partial Z80 reachability.
    verify_rom_identity()
    integrity = inspect_tape(tape)
    health = read_tap_health(tape)
    if health.get("status") == "ARMED_CAPTURE_CLOSED" and "written_events" in health:
        if (health["written_events"] != integrity["events"]
            or any(health.get(k, 0) != 0 for k in (
                "format_errors", "write_errors", "flush_errors",
                "clock_errors", "value_errors"))):
            # A render from a truncated/missing row stream is not evidence
            # for native replay. Preserve all inputs for local diagnosis.
            raise B3Stop("NATIVE_TAPE_INCOMPLETE_OR_LOSSY")
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
        "mame_capture_version": (mame_metadata or {}).get("mame_version"),
        "mame_capture_version_pinned": (mame_metadata or {}).get("mame_version_pinned", False),
        "lab_unpinned_mame_used": (
            source_mode == "MAME_SESSION_CAPTURE"
            and (mame_metadata or {}).get("mame_version_pinned") is False
        ),
        "mame_loaded_same_rom_verified": False,
        "events_total": integrity["events"],
        "ym_writes": integrity["ym_writes"],
        "ym_chip_0_writes": integrity["ym_chip_0_writes"],
        "ym_chip_1_writes": integrity["ym_chip_1_writes"],
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
        "native_capture_health": health,
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
    p.add_argument("--ymfm-src", type=Path, help="Pinned ymfm git checkout (required for render)")
    p.add_argument("--duration-ms", type=int, default=5000)
    p.add_argument("--mame", default="mame")
    p.add_argument("--diagnose", action="store_true",
                   help="Only summarize private MAME bus activity; no ROM access or rendering")
    p.add_argument("--capture-id", type=str,
                   help="Unique 1-32 character [A-Za-z0-9_-] capture suffix; preserves previous captures")
    p.add_argument("--lab-allow-unpinned-mame", action="store_true",
                   help="Explicit laboratory exception for an installed MAME other than 0.289; never native parity")
    p.add_argument("--rompath", default="roms")
    p.add_argument("--reference-wav", type=Path,
                   help="Optional private native WAV; diagnostics ONLY, not parity")
    args = p.parse_args(argv)
    try:
        if args.lab_allow_unpinned_mame and not args.capture:
            raise B3Stop("MAME_LAB_OVERRIDE_REQUIRES_CAPTURE")
        if args.capture_id is not None and not args.capture:
            raise B3Stop("MAME_CAPTURE_ID_REQUIRES_CAPTURE")
        if args.diagnose and (args.capture or args.reference_wav is not None):
            raise B3Stop("MAME_DIAGNOSE_REQUIRES_EXISTING_TAPE")
        if not args.diagnose and args.ymfm_src is None:
            raise B3Stop("YMFM_SOURCE_REQUIRED")
        PRIVATE.mkdir(parents=True, exist_ok=True)
        # Reject symlinks in our controlled out/audio hierarchy, but permit
        # macOS /var -> /private/var parent aliases.
        if PRIVATE.is_symlink() or PRIVATE.parent.is_symlink():
            raise B3Stop("PRIVATE_ROOT_SYMLINK")
        verify_repository_privacy()
        if args.diagnose:
            report = summarize_capture(args.tape)
            print(json.dumps(report, separators=(",", ":")))
            return 0
        verify_rom_identity()
        capture_meta = {}
        tape = (capture_tape(args.mame, args.rompath,
                             allow_unpinned_lab=args.lab_allow_unpinned_mame,
                             metadata=capture_meta,
                             capture_id=args.capture_id)
                if args.capture else args.tape)
        reference = args.reference_wav
        capture_reference = capture_meta.get("reference_wav_path")
        if args.capture and reference is None and capture_reference is not None and capture_reference.exists():
            reference = capture_reference
        report = run_b3(tape=tape, ymfm_source=args.ymfm_src,
                        duration_ms=args.duration_ms, native_wav=reference,
                        source_mode=("MAME_SESSION_CAPTURE" if args.capture
                                     else "OPERATOR_PROVIDED_TAPE"),
                        mame_metadata=capture_meta)
        print(json.dumps(report, separators=(",", ":")))
        return 0
    except B3Stop as e:
        result = {"kind": "GNG_AUDIO_B3_CHECKPOINT_V1",
                  "status": "STOP", "reason": str(e),
                  "audio_working": False, "rom_bytes_exported": False}
        if str(e) in ("TAPE_NO_YM_EVENTS", "TAPE_BAD_CHRONOLOGY") and "tape" in locals():
            try:
                result["capture_diagnostics"] = summarize_capture(tape)
            except (B3Stop, OSError, ValueError):
                result["capture_diagnostics"] = {"status": "UNAVAILABLE"}
        print(json.dumps(result, separators=(",", ":")))
        return 2
    except (OSError, ValueError, OverflowError):
        print(json.dumps({"kind": "GNG_AUDIO_B3_CHECKPOINT_V1",
                          "status": "STOP", "reason": "B3_IO_OR_INPUT_STOP",
                          "audio_working": False, "rom_bytes_exported": False}))
        return 2


if __name__ == "__main__":
    sys.exit(main())
