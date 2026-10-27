#!/usr/bin/env python3
"""Convert a PRIVATE MAME bus JSONL to timestamped YM2203 register writes."""
import argparse
import json
import sys
from pathlib import Path

MASTER_HZ = 12_000_000
YM_ADDRESSES = frozenset(range(0xe000, 0xe004))
ROOT = Path(__file__).resolve().parents[1]
PRIVATE = ROOT / "out" / "audio"

def safe_private_output(path):
    """Accept either cwd-relative or absolute out/audio path, never an escape."""
    provided = Path(path)
    if ".." in provided.parts or PRIVATE.is_symlink() or PRIVATE.parent.is_symlink():
        raise ValueError("AUDIO_OUTPUT_MUST_BE_PRIVATE_OUT")
    candidate = (provided if provided.is_absolute()
                 else ROOT / provided).absolute()
    if not candidate.is_relative_to(PRIVATE) or candidate == PRIVATE:
        raise ValueError("AUDIO_OUTPUT_MUST_BE_PRIVATE_OUT")
    current = PRIVATE
    for component in candidate.relative_to(PRIVATE).parts:
        current = current / component
        if current.is_symlink():
            raise ValueError("AUDIO_OUTPUT_MUST_BE_PRIVATE_OUT")
    if not candidate.resolve().is_relative_to(PRIVATE.resolve()):
        raise ValueError("AUDIO_OUTPUT_MUST_BE_PRIVATE_OUT")
    return candidate

def convert(lines):
    last = -1
    writes = []
    for number, line in enumerate(lines, 1):
        if not line.strip(): continue
        row = json.loads(line)
        if not isinstance(row, dict) or not isinstance(row.get("kind"), str):
            raise ValueError(f"AUDIO_BAD_ROW_{number}")
        if row["kind"] != "YM2203_WRITE": continue
        tick, addr, value = row.get("tick12m"), row.get("address"), row.get("value")
        if any(type(v) is not int for v in (tick, addr, value)):
            raise ValueError(f"AUDIO_BAD_TYPE_{number}")
        if tick < last or tick < 0 or addr not in YM_ADDRESSES or not 0 <= value <= 255:
            raise ValueError(f"AUDIO_BAD_YM_WRITE_{number}")
        writes.append((tick, addr, value))
        last = tick
    if not writes: raise ValueError("AUDIO_NO_YM_WRITES")
    return writes

def main(argv=None):
    p=argparse.ArgumentParser()
    p.add_argument("--in-jsonl", type=Path, required=True)
    p.add_argument("--out-tsv", type=Path, required=True)
    p.add_argument("--window-ms", type=int, default=0,
                   help="Optional first N milliseconds of YM events (up to 30000)")
    args=p.parse_args(argv)
    try:
        dest = safe_private_output(args.out_tsv)
        if args.window_ms < 0 or args.window_ms > 30000:
            raise ValueError("AUDIO_INVALID_WINDOW")
        with args.in_jsonl.open(encoding="utf8") as stream:
            rows=convert(stream)
        total=len(rows)
        origin=rows[0][0]
        if args.window_ms:
            rows=[r for r in rows if (r[0]-origin) < args.window_ms*12000]
        dest.parent.mkdir(parents=True,exist_ok=True)
        with dest.open("w",encoding="ascii") as output:
            for tick,addr,value in rows:
                output.write(f"{tick-origin} {addr} {value}\n")
    except (ValueError,OSError,json.JSONDecodeError) as error:
        print(json.dumps({"kind":"GNG_AUDIO_YM_TAPE_V1","status":"STOP","error":type(error).__name__}))
        return 2
    print(json.dumps({"kind":"GNG_AUDIO_YM_TAPE_V1",
                      "status":"LAB_EVENTS_ONLY","writes":len(rows),"truncated":total-len(rows),
                      "time_origin":"first_ym_write","master_hz":MASTER_HZ,
                      "z80_certified":False,"pcm_certified":False}))
    return 0

if __name__=="__main__": sys.exit(main())
