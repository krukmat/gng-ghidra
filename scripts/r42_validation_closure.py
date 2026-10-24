#!/usr/bin/env python3
"""T1/T2/T3 ROM-free validation closure, without MAME or GitHub Actions.

Runs actual local Node/Python processes. An exit-code-only PASS is not enough:
T1 must present the expected nine test cases and a scale manifest for exactly
5,000, 40,001 and 100,000 events; T2 requires the regression PASS marker.
No test output or ROM bytes are copied to the report; only hashes and counts.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path
from typing import Callable

SCHEMA = "gng.r42.validation-closure.v1"
SCALES = [5000, 40001, 100000]
EXPECTED_TESTS = 9
CMD_TESTS = ["node", "--test", "tests/test_r42h_romfree_gate.mjs"]
CMD_SCALE = ["node", "scripts/r42h_romfree_gate.mjs", "--scale"]
CMD_REGRESSION = ["bash", "scripts/r3-local-regression.sh"]
REGRESSION_PASS = "GNG_LOCAL_REGRESSION=PASS_ROM_FREE_R3_R42H"


def digest(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def run_command(cmd: list[str], root: Path, timeout: int, runner: Callable) -> dict:
    begin = time.monotonic()
    try:
        result = runner(cmd, cwd=root, timeout=timeout, capture_output=True, text=True,
                        check=False)
        out, err = result.stdout, result.stderr
        return {
            "command": cmd,
            "outcome": "EXITED",
            "exit_code": result.returncode,
            "elapsed_ms": round((time.monotonic() - begin) * 1000),
            "stdout_sha256": digest(out),
            "stderr_sha256": digest(err),
            "stdout_chars": len(out),
            "stderr_chars": len(err),
            # private to the validator, removed prior to report serialization
            "_stdout": out,
        }
    except (OSError, subprocess.TimeoutExpired) as exc:
        return {
            "command": cmd,
            "outcome": "UNAVAILABLE" if isinstance(exc, OSError) else "TIMEOUT",
            "exit_code": None,
            "elapsed_ms": round((time.monotonic() - begin) * 1000),
            "error_kind": type(exc).__name__,
        }


def check_tests(step: dict) -> bool:
    out = step.get("_stdout", "")
    # TAP from node --test. Require both total and zero fail/skip/cancel.
    values = {}
    for k in ("tests", "pass", "fail", "cancelled", "skipped"):
        hits = re.findall(r"(?m)^# " + k + r" (\d+)\s*$", out)
        if hits:
            values[k] = int(hits[-1])
    return (step["outcome"] == "EXITED" and step["exit_code"] == 0 and
            values.get("tests") == EXPECTED_TESTS and
            values.get("pass") == EXPECTED_TESTS and
            values.get("fail", -1) == 0 and
            values.get("cancelled", -1) == 0 and
            values.get("skipped", -1) == 0)


def check_scale(step: dict, manifest: dict | None) -> bool:
    if step["outcome"] != "EXITED" or step["exit_code"] != 0 or not isinstance(manifest, dict):
        return False
    if (manifest.get("schema") != "gng.r42h.romfree-checkpoint.v1" or
            manifest.get("status") != "ROM_FREE_LAB_GATE_PASS_NATIVE_UNVERIFIED" or
            manifest.get("million_event_stress_required") is not False or
            manifest.get("mame_executed") is not False or
            manifest.get("autonomous_cpu_frame_rendered") is not False):
        return False
    diag = manifest.get("diagnostic")
    if (not isinstance(diag, dict) or
            diag.get("status") != "SYNTHETIC_E2E_DIAGNOSTIC_PASS" or
            diag.get("native_mame_executed") is not False or
            diag.get("repeat_identical") is not True):
        return False
    changed=diag.get("changed",{})
    byte=changed.get("first_byte_divergence",{}) if isinstance(changed,dict) else {}
    pixel=changed.get("first_pixel_divergence",{}) if isinstance(changed,dict) else {}
    frozen=diag.get("post_dma_write",{})
    if (not isinstance(changed,dict) or changed.get("first_event_seq")!=0 or
            not isinstance(byte,dict) or byte.get("region")!="SPRITE_DMA" or
            byte.get("byte_offset")!=3 or
            not isinstance(pixel,dict) or
            (pixel.get("x"),pixel.get("y"),pixel.get("channel"))!=(34,66,"R") or
            not isinstance(frozen,dict) or frozen.get("first_event_seq")!=2 or
            frozen.get("first_pixel_divergence") is not None or
            not isinstance(frozen.get("equal_components"),dict) or
            frozen["equal_components"].get("pixels") is not True):
        return False
    entries = manifest.get("scales")
    return (isinstance(entries, list) and
            [x.get("event_count") for x in entries if isinstance(x, dict)] == SCALES and
            len(entries) == len(SCALES) and
            [x.get("window_count") for x in entries] == [1, 2, 3] and
            all(x.get("state") == "SYNTHETIC_E2E_COMPONENTS_VERIFIED" and
                x.get("native_proof") is False and
                re.fullmatch(r"[a-f0-9]{64}", x.get("state_sha256", ""))
                for x in entries))


def check_regression(step: dict) -> bool:
    return (step["outcome"] == "EXITED" and step["exit_code"] == 0 and
            REGRESSION_PASS in step.get("_stdout", "").splitlines())


def report_step(step: dict, ok: bool) -> dict:
    return {k: v for k, v in step.items() if not k.startswith("_")} | {
        "status": "PASS" if ok else (
            "BLOCKED_ENVIRONMENT" if step["outcome"] in ("TIMEOUT", "UNAVAILABLE")
            else "FAILED_VALIDATION")
    }


def run_closure(root: Path, *, runner=subprocess.run,
                manifest_loader: Callable[[Path], dict] | None = None,
                write: bool = True) -> dict:
    root = root.resolve()
    required = ["src/r42h_romfree_gate.mjs", "tests/test_r42h_romfree_gate.mjs",
                "scripts/r3-local-regression.sh"]
    if runner is subprocess.run and not all((root / name).is_file() for name in required):
        report = {
            "schema": SCHEMA, "status": "BLOCKED_MISSING_CHECKOUT",
            "tasks": {"T1": {"status": "BLOCKED_MISSING_CHECKOUT"},
                      "T2": {"status": "BLOCKED_MISSING_CHECKOUT"},
                      "T3": {"status": "NOT_STARTED"}},
            "missing_paths": [name for name in required if not (root / name).is_file()],
            "external_gates": ["MAME_LUA_TAPS", "PRE_TAP_STATE", "A0_6_3_BANK_IDENTITY",
                               "IRQ_SYNC_VBLANK_AND_AUTONOMOUS_FRAME"],
            "mame_executed_by_closure": False,
            "github_actions_used": False,
            "native_game_frame_verified": False,
            "private_log_or_rom_bytes_in_report": False,
        }
        if write:
            dest=root / "out/r3/r42-validation-closure.json"
            dest.parent.mkdir(parents=True,exist_ok=True)
            dest.write_text(json.dumps(report,indent=2,sort_keys=True)+"\n",encoding="utf-8")
        return report
    if manifest_loader is None:
        manifest_loader = lambda p: json.loads(p.read_text(encoding="utf-8"))
    stage1 = run_command(CMD_TESTS, root, 300, runner)
    stage2 = run_command(CMD_SCALE, root, 900, runner)
    manifest_path = root / "out/r3/r42h-romfree-checkpoint.json"
    try:
        manifest = manifest_loader(manifest_path) if stage2["exit_code"] == 0 else None
    except (OSError, ValueError, json.JSONDecodeError):
        manifest = None
    stage3 = run_command(CMD_REGRESSION, root, 1200, runner)
    checks = [check_tests(stage1), check_scale(stage2, manifest), check_regression(stage3)]
    steps = [report_step(stage, ok) for stage, ok in
             zip([stage1, stage2, stage3], checks)]
    overall = "PASS_ROM_FREE_ONLY" if all(checks) else (
        "BLOCKED_ENVIRONMENT" if any(
            step["status"] == "BLOCKED_ENVIRONMENT" for step in steps)
        else "FAILED_VALIDATION")
    report = {
        "schema": SCHEMA,
        "status": overall,
        "tasks": {
            "T1": {"status": "PASS" if all(checks[:2]) else "NOT_VERIFIED",
                   "tests": steps[0], "scale": steps[1]},
            "T2": {"status": "PASS" if checks[2] else "NOT_VERIFIED",
                   "regression": steps[2]},
            "T3": {"status": "ROM_FREE_CLOSED" if all(checks) else "REQUIRES_REPAIR_OR_LOCAL_RERUN",
                   "errors_detected": sum(not value for value in checks)},
        },
        "scales_checked": SCALES if checks[1] else [],
        "external_gates": ["MAME_LUA_TAPS", "PRE_TAP_STATE", "A0_6_3_BANK_IDENTITY",
                           "IRQ_SYNC_VBLANK_AND_AUTONOMOUS_FRAME"],
        "mame_executed_by_closure": False,
        "github_actions_used": False,
        "native_game_frame_verified": False,
        "private_log_or_rom_bytes_in_report": False,
    }
    if write:
        destination = root / "out/r3/r42-validation-closure.json"
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n",
                               encoding="utf-8")
    return report


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args(argv)
    result = run_closure(args.root)
    print(json.dumps({
        "status": result["status"],
        "T1": result["tasks"]["T1"]["status"],
        "T2": result["tasks"]["T2"]["status"],
        "T3": result["tasks"]["T3"]["status"],
        "report": "out/r3/r42-validation-closure.json",
        "native_certified": False,
    }, indent=2))
    return 0 if result["status"] == "PASS_ROM_FREE_ONLY" else 2


if __name__ == "__main__":
    sys.exit(main())
