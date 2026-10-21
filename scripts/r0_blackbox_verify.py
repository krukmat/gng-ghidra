#!/usr/bin/env python3
"""Check original Blackbox input timeline and AVI without claiming gameplay.

Only a human view of the private video can establish a started game.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path


def verify(timeline_path: Path, video_path: Path) -> dict:
    if not timeline_path.is_file():
        raise ValueError("BLACKBOX_TIMELINE_MISSING")
    if not video_path.is_file() or video_path.stat().st_size < 1024:
        raise ValueError("BLACKBOX_VIDEO_MISSING_OR_EMPTY")
    data=json.loads(timeline_path.read_text(encoding="utf-8"))
    if not isinstance(data,list) or not data:
        raise ValueError("BLACKBOX_TIMELINE_EMPTY")
    frames={}
    for row in data:
        if (not isinstance(row,dict) or type(row.get("frame")) is not int or
                row["frame"] < 0 or not isinstance(row.get("buttons"),list) or
                not all(isinstance(button,str) for button in row["buttons"])):
            raise ValueError("BLACKBOX_TIMELINE_INVALID")
        if row["frame"] in frames:
            raise ValueError("BLACKBOX_DUPLICATED_FRAME")
        frames[row["frame"]]=set(row["buttons"])
    coin=[f for f,b in frames.items() if "coin" in b]
    start=[f for f,b in frames.items() if "start" in b]
    if not any(950 <= f < 960 for f in coin):
        raise ValueError("BLACKBOX_COIN_NOT_OBSERVED_AT_950")
    if not any(1020 <= f < 1025 for f in start):
        raise ValueError("BLACKBOX_START_NOT_OBSERVED_AT_1020")
    if max(frames) < 1505:
        raise ValueError("BLACKBOX_RECORDING_ENDED_BEFORE_STAGE_INTRO")
    return {
        "schema":"gng.blackbox-baseline.v1",
        "source":"original-blackbox-lua-and-boot-plan",
        "status":"INPUTS_OBSERVED_VIDEO_RECORDED_GAMEPLAY_UNVERIFIED",
        "coin_observed_frames":len(coin),
        "start_observed_frames":len(start),
        "last_frame":max(frames),
        "video_bytes":video_path.stat().st_size,
        "gameplay_verified":False,
        "requires_operator_video_review":True
    }


def main()->None:
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--timeline",type=Path,required=True)
    p.add_argument("--video",type=Path,required=True)
    p.add_argument("--report",type=Path,required=True)
    args=p.parse_args()
    try:
        result=verify(args.timeline,args.video)
    except (ValueError,OSError,json.JSONDecodeError) as exc:
        p.error(str(exc))
    args.report.parent.mkdir(parents=True,exist_ok=True)
    args.report.write_text(json.dumps(result,indent=2,sort_keys=True)+"\n")
    print("GNG_BLACKBOX_INPUTS=OBSERVED"+
          " coin_frames="+str(result["coin_observed_frames"])+
          " start_frames="+str(result["start_observed_frames"]))
    print("GNG_BLACKBOX_VIDEO=RECORDED"+
          " last_frame="+str(result["last_frame"]))
    print("GNG_BLACKBOX_GAMEPLAY=UNVERIFIED_REQUIRES_VISUAL_REVIEW")


if __name__=="__main__":
    main()
