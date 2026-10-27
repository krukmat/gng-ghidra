#!/usr/bin/env python3
"""Strict soundlatch command comparison. Not a Z80/YM/audio parity gate."""
import argparse
import json
import sys
from pathlib import Path


def read_events(path):
    events = []
    with open(path, "r", encoding="utf-8") as f:
        for line_no, line in enumerate(f, 1):
            if not line.strip():
                continue
            event = json.loads(line)
            if not isinstance(event, dict) or not isinstance(event.get("kind"), str):
                raise ValueError(f"INVALID_EVENT_{line_no}")
            if event["kind"] == "SOUNDLATCH_WRITE":
                v = event.get("value")
                if type(v) is not int or not 0 <= v <= 255:
                    raise ValueError(f"INVALID_COMMAND_{line_no}")
            events.append(event)
    return events


def compare_commands(js_events, mame_events):
    local = [e["value"] for e in js_events if e["kind"] == "SOUNDLATCH_WRITE"]
    native = [e["value"] for e in mame_events if e["kind"] == "SOUNDLATCH_WRITE"]
    if not local or not native:
        return {"status": "BLOCKED_NO_COMMANDS", "js_commands": len(local),
                "mame_commands": len(native)}
    if local != native:
        first = next((i for i, (a, b) in enumerate(zip(local, native)) if a != b),
                     min(len(local),len(native)))
        return {"status":"DIFFERENT_COMMAND_STREAM", "first_difference_index": first,
                "js_commands":len(local), "mame_commands":len(native)}
    return {"status":"MATCHED_LATCH_COMMANDS_ONLY", "commands":len(local),
            "timing_verified":False, "z80_verified":False, "ym2203_verified":False}


def main(argv=None):
    p=argparse.ArgumentParser()
    p.add_argument("--js", type=Path, required=True, help="JSONL from onAudioEvent")
    p.add_argument("--mame", type=Path, required=True, help="JSONL from audio_mame_taps.lua")
    args=p.parse_args(argv)
    try:
        result=compare_commands(read_events(args.js),read_events(args.mame))
    except (OSError, ValueError, json.JSONDecodeError) as e:
        result={"status":"INVALID_CAPTURE","error":type(e).__name__}
    print(json.dumps({"kind":"GNG_AUDIO_COMMAND_PARITY_V1", **result}))
    return 0 if result["status"] == "MATCHED_LATCH_COMMANDS_ONLY" else 2


if __name__ == "__main__":
    sys.exit(main())
