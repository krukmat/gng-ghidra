#!/usr/bin/env python3
"""Convert a PRIVATE MAME bus JSONL to timestamped YM2203 register writes."""
import argparse
import json
import sys
from pathlib import Path

MASTER_HZ = 12_000_000
YM_ADDRESSES = frozenset(range(0xe000, 0xe004))

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
    args=p.parse_args(argv)
    if not args.out_tsv.as_posix().startswith("out/audio/"):
        print("AUDIO_OUTPUT_MUST_BE_PRIVATE_OUT", file=sys.stderr)
        return 2
    try:
        with args.in_jsonl.open(encoding="utf8") as stream:
            rows=convert(stream)
        args.out_tsv.parent.mkdir(parents=True,exist_ok=True)
        with args.out_tsv.open("w",encoding="ascii") as output:
            for tick,addr,value in rows:
                output.write(f"{tick} {addr} {value}\n")
    except (ValueError,OSError,json.JSONDecodeError) as error:
        print(json.dumps({"kind":"GNG_AUDIO_YM_TAPE_V1","status":"STOP","error":type(error).__name__}))
        return 2
    print(json.dumps({"kind":"GNG_AUDIO_YM_TAPE_V1",
                      "status":"LAB_EVENTS_ONLY","writes":len(rows),"master_hz":MASTER_HZ,
                      "z80_certified":False,"pcm_certified":False}))
    return 0

if __name__=="__main__": sys.exit(main())
