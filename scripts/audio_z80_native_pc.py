#!/usr/bin/env python3
"""B4.T2: private MAME audiocpu executed-PC capture -> sanitized seed profile.

MAME debugger trace may contain full disassembly: NEVER publish or print it.
Only debugger-marked PCs are parsed; no ROM/register/opcode bytes leave out/audio.
ROM-backed roots are diagnostic evidence, NOT certified Z80 runtime coverage.
"""
import argparse
from collections import Counter
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

import audio_b3_checkpoint as b3

EXPECTED_SHA1 = b3.EXPECTED_ROM_SHA1
RAW_LIMIT = 128 * 1024 * 1024
MAX_MARKER_RECORDS = 2_500_000
TRACE_MARKER = re.compile(r"\bAUDIOPC=([0-9A-Fa-f]{4})(?![0-9A-Fa-f])")
# MAME 0.288 src/emu/debug/debugcpu.cpp tracer::update():
# util::stream_format(*m_file, "%s: %s\\n", buffer.pc_to_string(pc), instruction)
# Z80 uses four hexadecimal PC digits. This is an alternate instrument
# source ONLY for a private audiocpu-selected trace, not an arbitrary hex scan.
STANDARD_Z80_TRACE_PC = re.compile(r"^[ \\t]*([0-9A-Fa-f]{4}):[ \\t]+\\S")
ID_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,31}\Z")
HEALTH_KIND = "GNG_AUDIO_Z80_PC_TRACE_HEALTH_V1"


class TraceStop(Exception):
    pass


def paths(capture_id):
    if not isinstance(capture_id, str) or ID_PATTERN.fullmatch(capture_id) is None:
        raise TraceStop("CAPTURE_ID_INVALID")
    return {
        "trace": b3.ensure_private(b3.PRIVATE / f"z80-native-pc-{capture_id}.tr"),
        "health": b3.ensure_private(b3.PRIVATE / f"z80-native-pc-{capture_id}-health.json"),
        "roots": b3.ensure_private(b3.PRIVATE / f"z80-native-roots-{capture_id}.json"),
    }


def checked_health(path):
    path = b3.ensure_private(path, must_exist=True)
    if path.stat().st_size > 4096:
        raise TraceStop("TRACE_HEALTH_INVALID")
    try:
        data = json.loads(path.read_text(encoding="utf8"))
    except (UnicodeError, ValueError, OSError):
        raise TraceStop("TRACE_HEALTH_INVALID") from None
    if (not isinstance(data, dict) or data.get("kind") != HEALTH_KIND or
        data.get("debugger_enabled") is not True or
        data.get("trace_armed") is not True or
        data.get("trace_stopped") is not True or
        data.get("session_closed") is not True or
        data.get("rom_bytes_exported") is not False or
        any(type(data.get(k)) is not int for k in ("frames_observed", "frame_limit")) or
        data["frame_limit"] < 60 or data["frame_limit"] > 1800 or
        data["frames_observed"] < 1):
        raise TraceStop("TRACE_NOT_CLOSED_OR_HEALTH_INVALID")
    return {"frames_observed": data["frames_observed"],
            "frame_limit": data["frame_limit"],
            "trace_closed": True}


def verify_sound_rom():
    p = b3.ensure_private(b3.PRIVATE / "gg2.bin", must_exist=True)
    if p.stat().st_size != 0x8000:
        raise TraceStop("LOCAL_SOUND_ROM_IDENTITY_STOP")
    if hashlib.sha1(p.read_bytes()).hexdigest() != EXPECTED_SHA1:
        raise TraceStop("LOCAL_SOUND_ROM_IDENTITY_STOP")


def version_of(mame):
    if shutil.which(mame) is None and not Path(mame).is_file():
        raise TraceStop("MAME_NOT_FOUND")
    try:
        run = subprocess.run([mame, "-version"], capture_output=True,
                             text=True, timeout=10, check=False)
    except (OSError, subprocess.TimeoutExpired):
        raise TraceStop("MAME_VERSION_CHECK_STOP") from None
    combined = (run.stdout or "") + "\n" + (run.stderr or "")
    match = re.search(r"(?<![0-9])0\.[0-9]{3}(?![0-9])", combined)
    if run.returncode != 0 or match is None:
        raise TraceStop("MAME_VERSION_CHECK_STOP")
    return match.group(0)


def capture(capture_id, *, mame="mame", rompath="roms",
            allow_unpinned=False, frame_limit=600):
    files = paths(capture_id)
    if not isinstance(frame_limit, int) or not 60 <= frame_limit <= 1800:
        raise TraceStop("TRACE_BAD_FRAME_LIMIT")
    if any(p.exists() for p in files.values()):
        raise TraceStop("TRACE_OUTPUT_ALREADY_EXISTS")
    version = version_of(mame)
    if version != "0.289" and not allow_unpinned:
        raise TraceStop("MAME_VERSION_NOT_PINNED_0289")
    env = dict(os.environ)
    # MAME Lua script requires relative, basename-sanitized paths.
    env["GNG_Z80_PC_TRACE_OUT"] = files["trace"].relative_to(b3.ROOT).as_posix()
    env["GNG_Z80_PC_TRACE_HEALTH_OUT"] = files["health"].relative_to(b3.ROOT).as_posix()
    env["GNG_Z80_PC_TRACE_FRAME_LIMIT"] = str(frame_limit)
    try:
        run = subprocess.run([mame, "gngb", "-rompath", str(rompath), "-debug",
                              "-autoboot_script", "scripts/audio_z80_native_trace.lua",
                              "-autoboot_delay", "0"],
                             cwd=b3.ROOT, env=env, timeout=180,
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                             check=False)
    except (OSError, subprocess.TimeoutExpired):
        raise TraceStop("MAME_TRACE_CAPTURE_STOP") from None
    if run.returncode != 0:
        raise TraceStop("MAME_TRACE_CAPTURE_STOP")
    return {"mame_version": version, "mame_version_pinned": version == "0.289"}


def scan_native_trace(capture_id):
    """Read existing private trace once; only return PC counters and safe stats.

    Never prints disassembly, ROM data, memory, symbols or trace lines.
    MAME 0.288 naturally emits "PC: disassembly" even without tracelog.
    """
    files = paths(capture_id)
    heartbeat = checked_health(files["health"])
    trace = b3.ensure_private(files["trace"], must_exist=True)
    if trace.stat().st_size > RAW_LIMIT:
        raise TraceStop("TRACE_TOO_LARGE")
    markers, standard = Counter(), Counter()
    seen = {"raw_trace_bytes": trace.stat().st_size,
            "lines_scanned": 0, "marker_pc_lines": 0,
            "standard_disassembly_pc_lines": 0,
            "unrecognized_lines": 0}
    try:
        with trace.open("r", encoding="utf8", errors="replace") as stream:
            for line in stream:
                seen["lines_scanned"] += 1
                if seen["lines_scanned"] > MAX_MARKER_RECORDS * 2:
                    raise TraceStop("TRACE_RECORD_LIMIT")
                marker = TRACE_MARKER.search(line)
                standard_pc = STANDARD_Z80_TRACE_PC.match(line)
                if marker:
                    markers[int(marker.group(1), 16)] += 1
                    seen["marker_pc_lines"] += 1
                if standard_pc:
                    standard[int(standard_pc.group(1), 16)] += 1
                    seen["standard_disassembly_pc_lines"] += 1
                if not marker and not standard_pc:
                    seen["unrecognized_lines"] += 1
                if max(seen["marker_pc_lines"], seen["standard_disassembly_pc_lines"]) > MAX_MARKER_RECORDS:
                    raise TraceStop("TRACE_RECORD_LIMIT")
    except OSError:
        raise TraceStop("TRACE_IO_STOP") from None
    return seen, markers, standard, heartbeat


def inspect(capture_id):
    """For a failed b4trace1, audit RAW trace shape without sharing contents."""
    seen, markers, standard, heartbeat = scan_native_trace(capture_id)
    if markers:
        status = "MARKED_PC_LINES_AVAILABLE"
    elif standard:
        status = "MAME_STANDARD_DISASSEMBLY_PC_LINES_RECOVERABLE"
    else:
        status = "NO_RECOGNIZED_PC_LINES"
    return {"kind": "GNG_AUDIO_B4_Z80_PC_TRACE_INSPECT_V1",
            "status": status,
            **seen,
            "trace_health": heartbeat,
            "source_cpu_independently_verified": False,
            "native_z80_parity_verified": False,
            "rom_bytes_exported": False}


def profile(capture_id):
    files = paths(capture_id)
    seen, markers, standard, heartbeat = scan_native_trace(capture_id)
    verify_sound_rom()
    occurrences = markers if markers else standard
    source_format = ("DEBUGGER_ACTION_MARKERS" if markers
                     else "STANDARD_MAME_DISASSEMBLY_LINES_NOT_PARITY")
    records = sum(occurrences.values())
    if not occurrences:
        raise TraceStop("TRACE_MARKER_NOT_SEEN")
    sound_rom = {pc: count for pc, count in occurrences.items() if pc < 0x8000}
    if not sound_rom:
        raise TraceStop("TRACE_NO_SOUND_ROM_PCS")
    # Hot paths are useful dynamic seeds, but no PC frequency parity is claimed:
    # MAME's debugger may condense loops in trace output.
    candidates = sorted(sound_rom, key=lambda pc: (-sound_rom[pc], pc))
    roots = list(dict.fromkeys([0] + candidates))[:64]
    if files["roots"].exists():
        raise TraceStop("ROOTS_OUTPUT_ALREADY_EXISTS")
    root_document = {"kind": "GNG_AUDIO_Z80_OPERATOR_PCS_V1",
                     "rom_sha1": EXPECTED_SHA1, "pcs": roots}
    with files["roots"].open("x", encoding="utf8") as output:
        json.dump(root_document, output, indent=2)
        output.write("\n")
    return {
        "kind": "GNG_AUDIO_B4_Z80_PC_PROFILE_V1",
        "status": "PRIVATE_NATIVE_TRACE_PROFILE_NOT_CPU_PARITY",
        "native_trace_pc_markers": seen["marker_pc_lines"],
        "native_trace_standard_pc_lines": seen["standard_disassembly_pc_lines"],
        "selected_pc_line_records": records,
        "pc_extraction_format": source_format,
        "source_cpu_independently_verified": False,
        "unique_pc_addresses": len(occurrences),
        "unique_sound_rom_pcs": len(sound_rom),
        "unique_outside_sound_rom_pcs": len(occurrences) - len(sound_rom),
        "native_backed_roots_written": len(roots),
        "roots_private": True,
        "trace_health": heartbeat,
        "loop_condensation_may_affect_counts": True,
        "mame_loaded_same_rom_verified": False,
        "z80_register_parity_verified": False,
        "z80_irq_parity_verified": False,
        "sound_runtime_working": False,
        "rom_bytes_exported": False,
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description="Private MAME Z80 executed PC profiling")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--capture", action="store_true")
    mode.add_argument("--profile", action="store_true")
    mode.add_argument("--inspect", action="store_true",
                      help="Classify saved raw trace structure without writing roots")
    parser.add_argument("--id", required=True)
    parser.add_argument("--mame", default="mame")
    parser.add_argument("--rompath", default="roms")
    parser.add_argument("--frame-limit", type=int, default=600)
    parser.add_argument("--lab-allow-unpinned-mame", action="store_true")
    args = parser.parse_args(argv)
    try:
        b3.PRIVATE.mkdir(parents=True, exist_ok=True)
        b3.verify_repository_privacy()
        if args.capture:
            metadata = capture(args.id, mame=args.mame, rompath=args.rompath,
                               allow_unpinned=args.lab_allow_unpinned_mame,
                               frame_limit=args.frame_limit)
            # Profile separately to preserve all captured evidence if parsing fails.
            result = {"kind": "GNG_AUDIO_B4_Z80_PC_CAPTURE_V1",
                      "status": "NATIVE_TRACE_CAPTURED_PRIVATE_PROFILE_PENDING",
                      **metadata, "private_artifacts_safe": True,
                      "z80_native_parity_verified": False}
        else:
            if args.lab_allow_unpinned_mame:
                raise TraceStop("LAB_MAME_OVERRIDE_REQUIRES_CAPTURE")
            result = inspect(args.id) if args.inspect else profile(args.id)
        print(json.dumps(result, separators=(",", ":")))
        return 0
    except (TraceStop, b3.B3Stop, OSError, ValueError):
        exc = sys.exc_info()[1]
        reason = str(exc) if isinstance(exc, (TraceStop, b3.B3Stop)) else "TRACE_IO_STOP"
        print(json.dumps({"kind": "GNG_AUDIO_B4_Z80_PC_CHECKPOINT_V1",
                          "status": "STOP", "reason": reason,
                          "private_artifacts_safe": True,
                          "z80_native_parity_verified": False,
                          "rom_bytes_exported": False}, separators=(",", ":")))
        return 2


if __name__ == "__main__":
    sys.exit(main())
