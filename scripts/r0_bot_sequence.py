#!/usr/bin/env python3
"""Frame-indexed MAME input schedule (Pyjamada QA-bot pattern, not its code)."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

SCHEMA = "gng.mame-input-replay.v1"
ACTIONS = frozenset(("coin", "start", "left", "right", "up",
                     "down", "jump", "attack"))


def prepare_sequence(source: Path, capture_frame: int) -> dict:
    """Validate JSON; return canonical, strict ASCII events for the MAME Lua hook."""
    payload = json.loads(source.read_text(encoding="utf-8"))
    if not isinstance(payload, dict) or set(payload) != {"schema", "events"}:
        raise ValueError("Bot sequence must contain only schema and events")
    if payload["schema"] != SCHEMA:
        raise ValueError("Unknown bot sequence schema")
    events = payload["events"]
    if not isinstance(events, list) or not 1 <= len(events) <= 100:
        raise ValueError("Bot events must contain 1..100 intervals")
    ordered = []
    for index, item in enumerate(events):
        if not isinstance(item, dict) or set(item) != {"from", "to", "action"}:
            raise ValueError(f"Bot event {index}: expected from/to/action")
        start, stop, action = item["from"], item["to"], item["action"]
        if (type(start) is not int or type(stop) is not int or
                not 0 <= start < stop <= capture_frame):
            raise ValueError(f"Bot event {index}: invalid frame interval")
        if type(action) is not str or action not in ACTIONS:
            raise ValueError(f"Bot event {index}: unknown input action")
        ordered.append((start, stop, action))
    ordered.sort()
    for i, (start, stop, action) in enumerate(ordered):
        for previous_start, previous_stop, previous_action in ordered[:i]:
            if start < previous_stop and stop > previous_start:
                if action == previous_action:
                    raise ValueError("Overlapping windows for input: " + action)
                if {action, previous_action} in ({"left", "right"}, {"up", "down"}):
                    raise ValueError("Conflicting joystick directions")
    wire = ";".join(f"{start}:{stop}:{action}" for start, stop, action in ordered)
    digest = hashlib.sha256(wire.encode("ascii")).hexdigest()
    return {"wire": wire, "sha256": digest, "event_count": len(ordered)}


def check_replay(state: dict, expected: dict | None) -> dict | None:
    replay = state.get("input_replay")
    if expected is None:
        if replay is not None:
            raise ValueError("Unexpected bot replay in unassisted capture")
        return None
    if not isinstance(replay, dict):
        raise ValueError("MAME bot replay evidence missing")
    if (type(replay.get("effective_coin_frames")) is not int or
            replay["effective_coin_frames"] <= 0 or
            type(replay.get("effective_start_frames")) is not int or
            replay["effective_start_frames"] <= 0 or
            replay.get("schema") != SCHEMA or
            replay.get("sha256") != expected["sha256"] or
            replay.get("events") != expected["event_count"] or
            type(replay.get("active_frame_actions")) is not int or
            replay["active_frame_actions"] <= 0):
        raise ValueError("Bot replay evidence mismatch/incomplete")
    return replay
