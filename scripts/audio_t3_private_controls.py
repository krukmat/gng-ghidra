#!/usr/bin/env python3
"""Extract ONLY captured main-CPU sound control events into ignored out/audio.

No native YM events, trace bytes or ROM are copied. Sound commands are actual
MAME input stimuli, not generated audio. Replaying them is LAB-only until
inter-CPU phase, exact IRQ schedule and CPU register parity are established.
"""
import argparse
import json
import os
import re
import sys

import audio_b3_checkpoint as b3

CAPTURE_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,31}\Z")

# This capture-file bound is independent of the 3M-T-state probe run limit.
MAX_NATIVE_CONTROLS_TICK12M = 12_000_000 * 3600

class ControlsStop(Exception):
    pass


def export(capture_id, output_id):
    if (CAPTURE_ID.fullmatch(capture_id) is None or
            CAPTURE_ID.fullmatch(output_id) is None):
        raise ControlsStop("AUDIO_T3_CONTROLS_BAD_ID")
    tape = b3.ensure_private(
        b3.PRIVATE / ("mame-audio-events-" + capture_id + ".jsonl"), must_exist=True)
    out = b3.ensure_private(
        b3.PRIVATE / ("z80-native-controls-" + output_id + ".json"))
    if out.exists():
        raise ControlsStop("AUDIO_T3_CONTROLS_OUTPUT_EXISTS")
    evidence = b3.inspect_tape(tape, require_ym=True,
                               allow_cross_cpu_skew_lab=True)
    first_release = None
    assertions = 0
    releases = 0
    latest_pre_release_latch = None
    main_controls = []
    first_ym_after_release = None
    first_latch_after_release = None
    last_main_tick = -1
    with tape.open("r", encoding="utf8") as stream:
        for line in stream:
            if not line.strip():
                continue
            row = json.loads(line)
            kind, tick, val = row["kind"], row["tick12m"], row["value"]
            if kind in ("AUDIO_RESET_WRITE", "SOUNDLATCH_WRITE"):
                if tick < last_main_tick:
                    raise ControlsStop("AUDIO_T3_CONTROLS_NONMONOTONIC_MAIN")
                last_main_tick = tick
            if kind == "AUDIO_RESET_WRITE":
                if val == 0:
                    assertions += 1
                    if first_release is not None:
                        raise ControlsStop("AUDIO_T3_CONTROLS_MULTIPLE_RESET_EPOCHS")
                elif val == 1:
                    releases += 1
                    if first_release is not None:
                        raise ControlsStop("AUDIO_T3_CONTROLS_MULTIPLE_RESET_EPOCHS")
                    first_release = tick
            elif kind == "SOUNDLATCH_WRITE":
                if first_release is None:
                    latest_pre_release_latch = val
                else:
                    relative = tick - first_release
                    if relative < 0 or relative % 8:
                        raise ControlsStop("AUDIO_T3_CONTROLS_CLOCK_ALIGNMENT_STOP")
                    if relative > MAX_NATIVE_CONTROLS_TICK12M:
                        raise ControlsStop("AUDIO_T3_CONTROLS_CLOCK_RANGE_STOP")
                    main_controls.append({
                        "kind": "SOUNDLATCH_WRITE",
                        "tick12m": relative,
                        "value": val,
                    })
                    if first_latch_after_release is None:
                        first_latch_after_release = relative
            elif kind == "YM2203_WRITE" and first_release is not None:
                if first_ym_after_release is None:
                    first_ym_after_release = tick - first_release
    if first_release is None or releases != 1 or assertions != 1:
        raise ControlsStop("AUDIO_T3_CONTROLS_RESET_EPOCH_UNVERIFIED")
    if len(main_controls) > 4096:
        raise ControlsStop("AUDIO_T3_CONTROLS_EVENT_LIMIT")
    if first_ym_after_release is not None and first_ym_after_release < 0:
        raise ControlsStop("AUDIO_T3_CONTROLS_YM_PHASE_INVALID")
    out_document = {
        "kind": "GNG_AUDIO_B4_T3_PRIVATE_NATIVE_CONTROLS_V1",
        "clock": "RESET_RELEASE_RELATIVE_MASTER_12MHZ",
        "irq_phase_native_verified": False,
        "main_sound_controls_only": True,
        "pre_release_latch": latest_pre_release_latch,
        "events": main_controls,
    }
    # Exclusive private file creation, never overwrite existing evidence.
    fd = os.open(out, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w", encoding="utf8") as dest:
        json.dump(out_document, dest, separators=(",", ":"))
        dest.write("\n")
    return {
        "kind": "GNG_AUDIO_B4_T3_NATIVE_CONTROLS_EXPORT_V1",
        "status": "PRIVATE_NATIVE_SOUND_CONTROLS_EXTRACTED_LAB_ONLY",
        "captured_sound_commands_after_reset_release": len(main_controls),
        "pre_release_latch_known": latest_pre_release_latch is not None,
        "first_native_sound_command_tstates_after_release": (
            first_latch_after_release // 4
            if first_latch_after_release is not None else None),
        "first_native_ym_event_tstates_after_release": (
            first_ym_after_release // 4
            if first_ym_after_release is not None else None),
        "first_ym_tick_alignment_remainder": (
            first_ym_after_release % 4
            if first_ym_after_release is not None else None),
        "cross_cpu_clock_inversions_lab": evidence["lab_cross_cpu_clock_inversions"],
        "private_artifacts_safe": True,
        "rom_bytes_exported": False,
        "ym_events_replayed": False,
        "native_irq_phase_verified": False,
        "z80_timing_parity_verified": False,
        "audio_working": False,
    }


def main(argv=None):
    ap = argparse.ArgumentParser(description="Private native sound-command stimulus extraction")
    ap.add_argument("--id", required=True)
    ap.add_argument("--out-id", required=True)
    args = ap.parse_args(argv)
    try:
        b3.verify_repository_privacy()
        result = export(args.id, args.out_id)
        print(json.dumps(result, separators=(",", ":")))
        return 0
    except (ControlsStop, b3.B3Stop, ValueError, OSError, KeyError):
        error = sys.exc_info()[1]
        reason = str(error) if isinstance(error, (ControlsStop, b3.B3Stop)) \
                 else "AUDIO_T3_CONTROLS_IO_STOP"
        print(json.dumps({
            "kind": "GNG_AUDIO_B4_T3_NATIVE_CONTROLS_EXPORT_V1",
            "status": "STOP", "reason": reason,
            "private_artifacts_safe": True, "rom_bytes_exported": False,
        }, separators=(",", ":")))
        return 2


if __name__ == "__main__":
    sys.exit(main())
