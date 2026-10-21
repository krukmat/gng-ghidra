#!/usr/bin/env python3
"""Validate an independent MC6809 R2 JSONL trace contract (no ROM needed).

This is structure/coverage validation, NOT evidence of genuine game execution.
Real traces, screenshots and ROM-derived bytes must remain in gitignored out/.
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

SCHEMA = "gng.r2.cpu-trace.v1"
REG8 = ("A", "B", "DP", "CC")
REG16 = ("PC", "X", "Y", "U", "S")
SIGNALS = frozenset((
    "RESET", "FRAME_BOUNDARY", "SYNC_ENTER", "SYNC_EXIT", "IRQ_ASSERT",
    "IRQ_ENTRY", "IRQ_CLEAR", "FIRQ_ASSERT", "FIRQ_ENTRY", "FIRQ_CLEAR",
    "BANK_SWITCH",
))
PROGRESS = {"RESET": "reset_observed",
            "SYNC_ENTER": "sync_observed",
            "IRQ_ENTRY": "first_irq_entry_observed"}


def reject(message: str) -> None:
    raise ValueError("R2_TRACE_INVALID: " + message)


def uint(value: object, bits: int, field: str) -> None:
    if type(value) is not int or not 0 <= value < (1 << bits):
        reject(field + " must be an unsigned " + str(bits) + "-bit integer")


def exact_keys(obj: object, fields: set[str], location: str) -> None:
    if not isinstance(obj, dict) or set(obj) != fields:
        reject(location + " fields mismatch")


def register_snapshot(obj: object, location: str) -> None:
    exact_keys(obj, set(REG8 + REG16), location)
    for key in REG8:
        uint(obj[key], 8, location + "." + key)
    for key in REG16:
        uint(obj[key], 16, location + "." + key)


def digest(value: object, location: str) -> None:
    if not isinstance(value, str) or not re.fullmatch("[0-9a-f]{64}", value):
        reject(location + " must be a SHA-256 hex digest")


def validate_records(records: list[dict]) -> dict:
    if len(records) < 3:
        reject("header, events and footer required")
    head = records[0]
    exact_keys(head, {
        "schema", "kind", "driver", "cpu", "origin", "origin_revision",
        "rom_sha256", "input_plan_sha256", "initial_reset_vector",
        "frame_clock", "instruction_phase", "bank_initial", "capture_policy",
    }, "header")
    if head["kind"] != "header" or head["schema"] != SCHEMA:
        reject("wrong header schema")
    if head["driver"] != "gngb" or head["cpu"] != "maincpu":
        reject("unsupported game or CPU")
    if (not isinstance(head["origin"], str) or
            not head["origin"].strip() or
            "generated" in head["origin"].lower()):
        reject("oracle origin must be independent of generated JS")
    if not isinstance(head["origin_revision"], str) or not head["origin_revision"].strip():
        reject("origin_revision missing")
    for key in ("rom_sha256", "input_plan_sha256"):
        digest(head[key], key)
    uint(head["initial_reset_vector"], 16, "initial_reset_vector")
    uint(head["bank_initial"], 8, "bank_initial")
    if (head["frame_clock"] != "screen.frame_number" or
            head["instruction_phase"] != "pre-fetch" or
            head["capture_policy"] != "full-instruction-and-ordered-bus-effects"):
        reject("unsupported observation phase or bus policy")

    coverage = {key: False for key in PROGRESS.values()}
    seq = 0
    frame = -1
    steps = 0
    for line, record in enumerate(records[1:-1], start=2):
        if not isinstance(record, dict):
            reject(f"line {line} not an object")
        kind = record.get("kind")
        if kind not in ("step", "event"):
            reject(f"line {line} unexpected record kind")
        if record.get("seq") != seq or type(record.get("seq")) is not int:
            reject(f"line {line} missing, duplicate or noncontiguous seq {seq}")
        seq += 1
        uint(record.get("frame"), 32, f"line {line}.frame")
        if record["frame"] < frame:
            reject(f"line {line} frame regressed")
        frame = record["frame"]
        uint(record.get("pc"), 16, f"line {line}.pc")
        if kind == "step":
            exact_keys(record, {
                "kind", "seq", "frame", "pc", "opcode_bytes",
                "bank", "before", "after", "bus",
            }, f"line {line} step")
            uint(record["bank"], 8, f"line {line}.bank")
            op = record["opcode_bytes"]
            if not isinstance(op, str) or not re.fullmatch(r"(?:[0-9a-fA-F]{2}){1,8}", op):
                reject(f"line {line} malformed opcode bytes")
            register_snapshot(record["before"], f"line {line}.before")
            register_snapshot(record["after"], f"line {line}.after")
            if record["pc"] != record["before"]["PC"]:
                reject(f"line {line} before-PC mismatch")
            if not isinstance(record["bus"], list):
                reject(f"line {line} bus must be ordered array")
            for n, effect in enumerate(record["bus"]):
                loc = f"line {line}.bus[{n}]"
                exact_keys(effect, {"kind", "space", "addr", "width", "value"}, loc)
                if effect["kind"] not in ("read", "write") or effect["space"] not in (
                        "ram", "rom", "mmio"):
                    reject(loc + " unsupported effect")
                uint(effect["addr"], 16, loc + ".addr")
                if type(effect["width"]) is not int or effect["width"] not in (1, 2):
                    reject(loc + " unsupported width")
                uint(effect["value"], effect["width"] * 8, loc + ".value")
            steps += 1
        else:
            exact_keys(record, {"kind", "seq", "frame", "pc", "name", "details"},
                       f"line {line} event")
            if record["name"] not in SIGNALS or not isinstance(record["details"], dict):
                reject(f"line {line} unsupported signal")
            if record["name"] == "BANK_SWITCH":
                exact_keys(record["details"],
                           {"old_bank", "new_bank", "mmio_addr", "value"},
                           f"line {line}.bank_details")
                for key, bits in (("old_bank", 8), ("new_bank", 8),
                                  ("mmio_addr", 16), ("value", 8)):
                    uint(record["details"][key], bits, "BANK_SWITCH." + key)
            if record["name"] in ("IRQ_ENTRY", "FIRQ_ENTRY"):
                exact_keys(record["details"], {"vector_addr", "handler_pc"},
                           f"line {line}.interrupt_details")
                for key in ("vector_addr", "handler_pc"):
                    uint(record["details"][key], 16, "interrupt." + key)
            if record["name"] in PROGRESS:
                coverage[PROGRESS[record["name"]]] = True

    footer = records[-1]
    exact_keys(footer, {"kind", "seq", "frame", "status", "steps",
                        "coverage", "stop_reason"}, "footer")
    if footer["kind"] != "footer" or type(footer["seq"]) is not int or footer["seq"] != seq:
        reject("invalid footer or noncontiguous final seq")
    uint(footer["frame"], 32, "footer.frame")
    if footer["frame"] < frame or footer["steps"] != steps or type(footer["steps"]) is not int:
        reject("footer steps or final frame mismatch")
    if footer["status"] not in ("COMPLETE", "INCOMPLETE"):
        reject("unsupported footer status")
    exact_keys(footer["coverage"], set(coverage), "footer.coverage")
    if any(type(x) is not bool for x in footer["coverage"].values()):
        reject("coverage flags must be booleans")
    if footer["coverage"] != coverage:
        reject("coverage falsely claims unobserved event")
    if not isinstance(footer["stop_reason"], str) or not footer["stop_reason"]:
        reject("footer stop_reason required")
    if footer["status"] == "COMPLETE" and (not steps or not all(coverage.values())):
        reject("COMPLETE requires instructions, reset, SYNC and IRQ entry")
    return {"schema": SCHEMA, "status": "STRUCTURE_VALID",
            "reference_execution_verified": False,
            "record_count": seq, "steps": steps,
            "coverage": coverage, "capture_status": footer["status"]}


def validate_file(path: Path) -> dict:
    if path.suffix != ".jsonl":
        reject("only .jsonl traces supported")
    parsed = []
    with path.open("r", encoding="utf-8") as stream:
        for n, line in enumerate(stream, 1):
            if not line.strip():
                reject(f"blank line {n}")
            try:
                parsed.append(json.loads(line))
            except json.JSONDecodeError as exc:
                reject(f"malformed JSON line {n}: {exc.msg}")
    return validate_records(parsed)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("trace", type=Path)
    args = parser.parse_args()
    try:
        report = validate_file(args.trace)
    except (ValueError, OSError) as exc:
        parser.error(str(exc))
    print(json.dumps(report, indent=2, sort_keys=True))
