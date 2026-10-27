#!/usr/bin/env python3
"""B4.T3-B: read-only MAME gngb audio event chronology diagnostics.

Evidence from MAME 0.288 gng.cpp: 3MHz Z80, 240Hz HOLD_LINE periodic IRQ,
active-low CPU and YM reset, latch C800, YM ports E000..E003.
THE EXISTING AUDIO TAPE DOES NOT CONTAIN IRQ ACK OR Z80 REGISTER SNAPSHOTS.
Only aggregate counters leave private out/audio. No ROM bytes or event data.
"""
import argparse
from bisect import bisect_right
import json
import re
import sys
from pathlib import Path

import audio_b3_checkpoint as b3

ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,31}\Z")


class NativeBoardStop(Exception):
    pass


def audit(tape):
    tape = b3.ensure_private(tape, must_exist=True)
    # Reuse existing rigorous per-CPU chronology and data/port validation.
    validated = b3.inspect_tape(tape, require_ym=True,
                                allow_cross_cpu_skew_lab=True)
    latch_times, latch_values, reads = [], [], []
    ym_first = None
    ym_last = None
    kinds = {kind: 0 for kind in b3.ALLOWED_KINDS}
    reset_events = []
    with tape.open("r", encoding="utf8") as stream:
        for line in stream:
            if not line.strip():
                continue
            row = json.loads(line)
            kind, tick, value = row["kind"], row["tick12m"], row["value"]
            kinds[kind] += 1
            if kind == "SOUNDLATCH_WRITE":
                latch_times.append(tick)
                latch_values.append(value)
            elif kind == "Z80_LATCH_READ":
                reads.append((tick, value))
            elif kind == "AUDIO_RESET_WRITE":
                reset_events.append((tick, value))
            elif kind == "YM2203_WRITE":
                if ym_first is None:
                    ym_first = tick
                ym_last = tick
    matched = 0
    mismatched = 0
    without_preceding = 0
    for tick, value in reads:
        # Compare by 12MHz tick, NOT interleaved tape line order: B3 allows
        # cross-CPU clock inversions when MAME schedules two CPUs.
        idx = bisect_right(latch_times, tick) - 1
        if idx < 0:
            without_preceding += 1
        elif latch_values[idx] == value:
            matched += 1
        else:
            mismatched += 1
    reset_asserted = 0
    reset_released = 0
    for tick, value in reset_events:
        reset_asserted += value == 0
        reset_released += value == 1
    return {
        "kind": "GNG_AUDIO_B4_T3_NATIVE_BOARD_AUDIT_V1",
        "status": "EVENT_CHRONOLOGY_ONLY_IRQ_NOT_OBSERVED",
        "source_driver": "MAME_0_288_GNG_CPP",
        "source_irq_type": "HOLD_LINE",
        "source_irq_hz": 240,
        "source_z80_clock_hz": 3000000,
        "source_irq_nominal_tstates": 12500,
        "recorded_sound_commands": kinds["SOUNDLATCH_WRITE"],
        "recorded_sound_latch_reads": kinds["Z80_LATCH_READ"],
        "latch_read_matches_prior_tick_write": matched,
        "latch_read_mismatches_prior_tick_write": mismatched,
        "latch_reads_without_prior_tick_write": without_preceding,
        "recorded_reset_assertions": reset_asserted,
        "recorded_reset_releases": reset_released,
        "recorded_ym_writes": kinds["YM2203_WRITE"],
        "recorded_two_ym_chips_addressed": validated["ym_chip_0_writes"] > 0 and
                                            validated["ym_chip_1_writes"] > 0,
        "cross_cpu_clock_inversions_lab": validated["lab_cross_cpu_clock_inversions"],
        "ym_observed_after_capture_start": ym_first is not None,
        "last_ym_tick_monotonic": ym_last is not None and ym_last >= ym_first,
        "native_irq_requests_directly_observed": False,
        "native_irq_acknowledgements_observed": False,
        "z80_register_parity_verified": False,
        "z80_timing_parity_verified": False,
        "pcm_generated_live": False,
        "rom_bytes_exported": False,
        "private_artifacts_safe": True,
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description="Sanitized existing native audio tape audit")
    parser.add_argument("--id", required=True, help="existing MAME audio capture ID")
    args = parser.parse_args(argv)
    try:
        if ID.fullmatch(args.id) is None:
            raise NativeBoardStop("AUDIO_T3_NATIVE_ID_INVALID")
        b3.verify_repository_privacy()
        file = b3.PRIVATE / ("mame-audio-events-" + args.id + ".jsonl")
        report = audit(file)
        print(json.dumps(report, separators=(",", ":")))
        return 0
    except (NativeBoardStop, b3.B3Stop, OSError, ValueError, KeyError):
        error = sys.exc_info()[1]
        reason = (str(error) if isinstance(error, (NativeBoardStop, b3.B3Stop))
                  else "AUDIO_T3_NATIVE_AUDIT_IO_STOP")
        print(json.dumps({
            "kind": "GNG_AUDIO_B4_T3_NATIVE_BOARD_AUDIT_V1",
            "status": "STOP", "reason": reason,
            "private_artifacts_safe": True, "rom_bytes_exported": False,
        }, separators=(",", ":")))
        return 2


if __name__ == "__main__":
    sys.exit(main())
