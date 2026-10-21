#!/usr/bin/env python3
"""Validate authentic GNG frame evidence captured inside the original Blackbox run.

Blackbox's pinned input plan and MAME Lua own all input injection.
Our observer captures only a native video frame and its associated video memory.
No ROM/VRAM/image evidence is included in git or claimed as JS gameplay.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from capture_real_frame import validate_capture


def validate_blackbox_capture(reference: Path, frame: int, system: str,
                              timeline: Path, baseline: Path) -> dict:
    root = Path(__file__).resolve().parents[1]
    output = (root / "out").resolve()
    reference = reference.resolve()
    if reference != output and output not in reference.parents:
        raise ValueError("GAMEPLAY_CAPTURE_MUST_REMAIN_PRIVATE_IN_OUT")
    gameplay = json.loads(baseline.read_text(encoding="utf-8"))
    if (gameplay.get("schema") != "gng.blackbox-baseline.v1" or
            gameplay.get("gameplay_inputs_observed") is not True or
            gameplay.get("last_frame", 0) < frame):
        raise ValueError("BLACKBOX_GAMEPLAY_BASELINE_NOT_VERIFIED")
    if system != "gngb":
        raise ValueError("BLACKBOX_CAPTURE_REQUIRES_GNGB")
    if not timeline.is_file():
        raise ValueError("BLACKBOX_EFFECTIVE_INPUT_TIMELINE_MISSING")
    native = validate_capture(reference, frame, system)
    if native.get("input_replay") is not None:
        raise ValueError("BLACKBOX_REFERENCE_MUST_NOT_USE_OLD_BOT")
    native["capture_flow"] = "PINNED_BLACKBOX_AUTOPLAY_WITH_GNG_R0_VIDEO_OBSERVER"
    native["blackbox_effective_timeline_sha256"] = hashlib.sha256(
        timeline.read_bytes()).hexdigest()
    native["gameplay_inputs_observed"] = True
    native["actual_gameplay_frame_verified"] = False
    native["js_pixel_equivalence_verified"] = False
    (reference / "manifest.json").write_text(
        json.dumps(native, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return native


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reference", type=Path, required=True)
    parser.add_argument("--frame", type=int, required=True)
    parser.add_argument("--system", choices=("gngb",), required=True)
    parser.add_argument("--timeline", type=Path, required=True)
    parser.add_argument("--baseline", type=Path, required=True)
    args = parser.parse_args()
    try:
        result = validate_blackbox_capture(
            args.reference, args.frame, args.system, args.timeline, args.baseline)
    except (ValueError, OSError, json.JSONDecodeError) as exc:
        parser.error(str(exc))
    print("GNG_BLACKBOX_NATIVE_FRAME=CAPTURED_NOT_JS_EQUIVALENT frame="+str(result["frame"]))
    print("GNG_BLACKBOX_MEMORY=VALIDATED fg,bg,sprite_dma,palette,scroll")
    print("GNG_BLACKBOX_FRAME_GAMEPLAY=OPERATOR_VISUAL_REVIEW_PENDING")


if __name__ == "__main__":
    main()
