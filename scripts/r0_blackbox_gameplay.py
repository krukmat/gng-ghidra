#!/usr/bin/env python3
"""Adapt a pinned Blackbox GNG gameplay plan to the verified MAME button order.

Upstream Blackbox planner currently serializes jump->button1 and fire->button2.
GnG MAME uses P1 Button 1 for attack, P1 Button 2 for jump. Swap only these
two serialized input identities; keep the upstream plan, timing and Lua.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

VALID = frozenset(("coin", "start", "left", "right", "up", "down",
                   "button1", "button2"))
SWAP = {"button1": "button2", "button2": "button1"}


def remap_gameplay_plan(data: object) -> tuple[list[dict], dict]:
    if not isinstance(data, list) or len(data) < 1800:
        raise ValueError("BLACKBOX_GAMEPLAY_PLAN_TOO_SHORT")
    fixed = []
    counts = {key: 0 for key in VALID}
    seen = set()
    for index, row in enumerate(data):
        if not isinstance(row, dict) or set(row) != {"frame", "buttons"}:
            raise ValueError(f"BLACKBOX_GAMEPLAY_BAD_FRAME_{index}")
        frame, buttons = row["frame"], row["buttons"]
        if type(frame) is not int or frame != index or not isinstance(buttons, list):
            raise ValueError(f"BLACKBOX_GAMEPLAY_INVALID_FRAME_{index}")
        if any(type(b) is not str or b not in VALID for b in buttons):
            raise ValueError(f"BLACKBOX_GAMEPLAY_INVALID_BUTTON_{index}")
        translated = [SWAP.get(b,b) for b in buttons]
        if len(set(translated)) != len(translated):
            raise ValueError(f"BLACKBOX_GAMEPLAY_DUPLICATE_BUTTON_{index}")
        fixed.append({"frame": frame, "buttons": translated})
        for b in translated:
            counts[b] += 1
        seen.update(translated)
    if not any("coin" in row["buttons"] for row in fixed[950:960]):
        raise ValueError("BLACKBOX_GAMEPLAY_COIN_TIMING_CHANGED")
    if not any("start" in row["buttons"] for row in fixed[1020:1025]):
        raise ValueError("BLACKBOX_GAMEPLAY_START_TIMING_CHANGED")
    if not any("right" in row["buttons"] for row in fixed[1505:1565]):
        raise ValueError("BLACKBOX_GAMEPLAY_MOVEMENT_MISSING")
    if not any("button2" in row["buttons"] for row in fixed[1565:1600]):
        raise ValueError("BLACKBOX_GAMEPLAY_JUMP_MISSING")
    if not any("button1" in row["buttons"] for row in fixed[1635:1740]):
        raise ValueError("BLACKBOX_GAMEPLAY_ATTACK_MISSING")
    wire = json.dumps(fixed, separators=(",", ":"), ensure_ascii=True)
    return fixed, {"schema": "gng.blackbox-gameplay-plan.v1",
                   "frames": len(fixed), "actions": counts,
                   "sha256": hashlib.sha256(wire.encode("ascii")).hexdigest(),
                   "button_mapping": "gngb: button1=attack; button2=jump"}


def convert_file(path: Path) -> dict:
    payload = json.loads(path.read_text(encoding="utf-8"))
    fixed, report = remap_gameplay_plan(payload)
    path.write_text(json.dumps(fixed, separators=(",", ":")), encoding="utf-8")
    return report
