#!/usr/bin/env python3
"""Read-only, private MAME YM event activity profiler (counts only, no ROM bytes).

Uses the original global-first-YM-write epoch. It does not re-order events or
certify native waveform, Z80 timing, FM voice state or audibility.
"""
import argparse
import json
import sys
from pathlib import Path

import audio_b3_checkpoint as b3

TICKS_PER_5S = 60_000_000
MAX_BINS = 6


def activity(tape):
    tape = b3.ensure_private(tape, must_exist=True)
    if tape.stat().st_size > b3.MAX_CAPTURE_BYTES:
        raise b3.B3Stop("TAPE_TOO_LARGE")
    bins = [{"segment_seconds": f"{i*5}-{(i+1)*5}",
             "ym_port_writes": 0, "fm_key_on_commands": 0,
             "psg_positive_volume_writes": 0} for i in range(MAX_BINS)]
    first_tick = None
    prev_audio_tick = -1
    last_registers = [None, None]
    address_port_writes = 0
    data_port_writes = 0
    parsed = 0
    beyond = 0
    with tape.open("r", encoding="utf8") as stream:
        for line in stream:
            if not line.strip():
                continue
            parsed += 1
            if parsed > b3.MAX_EVENTS:
                raise b3.B3Stop("TAPE_EVENT_LIMIT")
            try:
                row = json.loads(line)
            except (ValueError, UnicodeError):
                raise b3.B3Stop("TAPE_BAD_JSON") from None
            if not isinstance(row, dict):
                raise b3.B3Stop("TAPE_BAD_ROW")
            if row.get("kind") != "YM2203_WRITE":
                continue
            tick, addr, val = (row.get("tick12m"), row.get("address"),
                               row.get("value"))
            if (any(type(v) is not int for v in (tick, addr, val))
                or tick < 0 or tick < prev_audio_tick
                or addr not in range(0xe000, 0xe004) or val < 0 or val > 255):
                raise b3.B3Stop("TAPE_YM_ACTIVITY_INVALID")
            prev_audio_tick = tick
            if first_tick is None:
                first_tick = tick
            bucket_index = (tick - first_tick) // TICKS_PER_5S
            index = int((addr - 0xe000) // 2)
            is_address = addr % 2 == 0
            if is_address:
                address_port_writes += 1
                last_registers[index] = val
            else:
                data_port_writes += 1
            if bucket_index >= MAX_BINS:
                beyond += 1
                continue
            current = bins[bucket_index]
            current["ym_port_writes"] += 1
            if not is_address:
                reg = last_registers[index]
                if reg == 0x28 and (val & 0xf0):
                    current["fm_key_on_commands"] += 1
                if reg in (0x08, 0x09, 0x0a) and (val & 0x1f):
                    current["psg_positive_volume_writes"] += 1
    if first_tick is None:
        raise b3.B3Stop("TAPE_NO_YM_EVENTS")
    for entry in bins:
        entry["possible_voice_activity_commands"] = (
            entry["fm_key_on_commands"] +
            entry["psg_positive_volume_writes"]
        )
    first_ym_activity = next(
        (entry["segment_seconds"] for entry in bins
         if entry["possible_voice_activity_commands"] > 0), None
    )
    return {"kind": "GNG_AUDIO_B3_YM_ACTIVITY_V1",
            "status": "REGISTER_COMMAND_COUNTS_ONLY_NO_AUDIBILITY_CLAIM",
            "ym_port_writes_total": address_port_writes + data_port_writes,
            "ym_address_port_writes": address_port_writes,
            "ym_data_port_writes": data_port_writes,
            "ym_port_writes_after_30s": beyond,
            "five_second_windows": bins,
            "first_window_with_voice_activity_commands": first_ym_activity,
            "native_waveform_parity_verified": False,
            "audibility_verified": False,
            "rom_bytes_exported": False}


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--tape", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        b3.verify_repository_privacy()
        result = activity(args.tape)
        print(json.dumps(result, separators=(",", ":")))
        return 0
    except (b3.B3Stop, OSError, ValueError) as error:
        reason = str(error) if isinstance(error, b3.B3Stop) else "ACTIVITY_IO_ERROR"
        print(json.dumps({"kind": "GNG_AUDIO_B3_YM_ACTIVITY_V1",
                          "status": "STOP", "reason": reason,
                          "audibility_verified": False}, separators=(",", ":")))
        return 2


if __name__ == "__main__":
    sys.exit(main())
