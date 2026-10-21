#!/usr/bin/env python3
"""Classify R2 MAME debugger capability evidence; never emit a forged R2 trace.

Consumes private, observed TSV/trace data in ignored out/r2/, and outputs a
capability matrix. A pass is PREPARATION ONLY, NOT R2 CPU equivalence.
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

SCHEMA = "gng.r2.probe.v1"
SINGLES = frozenset(("PROBE", "DRIVER", "DEBUGGER_AVAILABLE",
    "CPU_DEBUGGER_AVAILABLE", "CPU_PROGRAM_WIDTH", "BANK_ENTRY_AVAILABLE",
    "BANK_INITIAL_OBSERVED", "CONTROLLED_SOFT_RESET_REQUESTED",
    "OBSERVED_RESET_COUNT", "OBSERVED_FRAME_COUNT",
    "OBSERVED_MMIO_READ_COUNT", "OBSERVED_MMIO_WRITE_COUNT", "PROBE_END"))
REGS = ("PC", "A", "B", "X", "Y", "U", "S", "DP", "CC")


def classify(probe: Path, trace: Path) -> dict:
    report = {
        "schema": SCHEMA,
        "status": "INSTRUMENTATION_BLOCKED",
        "real_mame_execution_observed": False,
        "r2_instruction_trace_complete": False,
        "reference_execution_verified": False,
        "provenance": {"probe_file": str(probe), "debug_trace_file": str(trace)},
        "capabilities": {
            "instruction_log": False, "registers_observable": False,
            "frame_clock": False, "reset_notifier": False,
            "controlled_soft_reset_observed": False,
            "mmio_read_taps": False, "mmio_write_taps": False,
            "bank_entry_observable": False,
            "per_instruction_register_before_after": False,
            "exhaustive_ordered_bus": False,
            "observed_bank_switch_edges": False,
            "observed_sync_enter_exit": False,
            "observed_irq_assert_entry": False,
        },
        "blockers": [],
    }
    cap = report["capabilities"]
    blockers = report["blockers"]
    if not probe.is_file():
        blockers.append("MAME Lua probe output absent")
        return report
    observations: dict[str, list[list[str]]] = {}
    for line_num, line in enumerate(probe.read_text(encoding="utf-8").splitlines(), 1):
        parts = line.split("\t")
        if not parts or not parts[0] or any(not cell for cell in parts):
            blockers.append(f"malformed probe line {line_num}")
            return report
        observations.setdefault(parts[0], []).append(parts[1:])
    for key in SINGLES:
        if len(observations.get(key, [])) > 1:
            blockers.append("duplicate observation key " + key)
            return report

    def single(key: str) -> str | None:
        items = observations.get(key, [])
        if len(items) != 1 or len(items[0]) != 1:
            return None
        return items[0][0]

    if single("PROBE") != "r2-mame-capability-v1" or single("DRIVER") != "gngb":
        blockers.append("provenance or driver mismatch")
        return report
    if single("PROBE_END") not in ("frame-limit", "machine-stop"):
        blockers.append("probe did not close cleanly")
        return report
    count = {}
    for key in ("OBSERVED_RESET_COUNT", "OBSERVED_FRAME_COUNT",
                "OBSERVED_MMIO_READ_COUNT", "OBSERVED_MMIO_WRITE_COUNT"):
        value = single(key)
        if value is None or not re.fullmatch(r"[0-9]+", value):
            blockers.append("missing/invalid counter " + key)
            return report
        count[key] = int(value)

    cap["reset_notifier"] = count["OBSERVED_RESET_COUNT"] > 0 and (
        len(observations.get("RESET_NOTIFICATION", [])) ==
        count["OBSERVED_RESET_COUNT"])
    controlled = single("CONTROLLED_SOFT_RESET_REQUESTED")
    requests = observations.get("SOFT_RESET_REQUESTED", [])
    if controlled not in (None, "0", "1"):
        blockers.append("unexpected controlled reset marker")
        return report
    cap["controlled_soft_reset_observed"] = (
        controlled == "1" and len(requests) == 1 and
        cap["reset_notifier"] and count["OBSERVED_RESET_COUNT"] >= 1)
    cap["frame_clock"] = count["OBSERVED_FRAME_COUNT"] > 0 and (
        len(observations.get("FRAME_SAMPLE", [])) ==
        count["OBSERVED_FRAME_COUNT"])
    cap["mmio_read_taps"] = (count["OBSERVED_MMIO_READ_COUNT"] > 0 and
        len(observations.get("MMIO_READ_SAMPLE", [])) ==
        min(count["OBSERVED_MMIO_READ_COUNT"], 20))
    cap["mmio_write_taps"] = (count["OBSERVED_MMIO_WRITE_COUNT"] > 0 and
        len(observations.get("MMIO_WRITE_SAMPLE", [])) ==
        min(count["OBSERVED_MMIO_WRITE_COUNT"], 20))
    bank_initial = single("BANK_INITIAL_OBSERVED")
    cap["bank_entry_observable"] = (single("BANK_ENTRY_AVAILABLE") == "1"
        and bank_initial is not None and bank_initial.isdecimal()
        and 0 <= int(bank_initial) <= 255)
    register_items = observations.get("REGISTER_AVAILABLE", [])
    values = {}
    for item in register_items:
        if len(item) != 2 or item[0] in values or item[0] not in REGS:
            blockers.append("invalid/duplicate CPU register availability")
            return report
        values[item[0]] = item[1]
    cap["registers_observable"] = (
        set(values) == set(REGS) and all(values[k] == "1" for k in REGS))
    trace_size = trace.stat().st_size if trace.is_file() else 0
    cap["instruction_log"] = (single("DEBUGGER_AVAILABLE") == "1"
        and single("CPU_DEBUGGER_AVAILABLE") == "1" and trace_size >= 64)

    report["observed_counts"] = count
    report["debug_trace_bytes"] = trace_size
    report["real_mame_execution_observed"] = bool(
        cap["instruction_log"] and cap["frame_clock"] and
        cap["registers_observable"] and cap["bank_entry_observable"])
    if not cap["instruction_log"]:
        blockers.append("MAME debugger noloop instruction trace not authenticated")
    if not cap["registers_observable"]:
        blockers.append("not all nine MC6809 registers exposed")
    if not cap["frame_clock"]:
        blockers.append("no continuous frame samples")
    if not cap["reset_notifier"]:
        blockers.append("reset notifier not observed (late Lua attachment)")
    if controlled == "1" and not cap["controlled_soft_reset_observed"]:
        blockers.append("controlled soft reset requested but notification not observed")
    if controlled == "1" and cap["controlled_soft_reset_observed"]:
        blockers.append("observed soft reset is NOT proof of initial cold-boot reset")
    if not cap["bank_entry_observable"]:
        blockers.append("MAME mainbank entry not observed")
    if not cap["mmio_read_taps"] or not cap["mmio_write_taps"]:
        blockers.append("no genuine read+write MMIO samples")
    blockers.extend((
        "no proof of a per-instruction before/after register boundary",
        "taps do not prove complete ordered fetch/RAM/stack bus operations",
        "bank samples do not establish all bank switch edges",
        "SYNC and IRQ entry/acknowledgement are not independently instrumented",
    ))
    # No observed probe can claim that the full R2.1 contract is met.
    report["status"] = ("PARTIAL_NATIVE_INSTRUMENTATION"
                        if report["real_mame_execution_observed"]
                        else "INSTRUMENTATION_BLOCKED")
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dir", type=Path, default=Path("out/r2/mame-probe"))
    args = parser.parse_args()
    directory = args.dir.resolve()
    # Never allow accidental artifacts in tracked repo code/docs/tests.
    root = Path(__file__).resolve().parents[1]
    allowed = (root / "out" / "r2").resolve()
    if not directory.is_relative_to(allowed):
        parser.error("private probe output must be within out/r2")
    report = classify(directory / "observations.tsv", directory / "cpu.trace")
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "capabilities.json").write_text(
        json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print("GNG_R2_PROBE_STATUS=" + report["status"])
    print("GNG_R2_TRACE_CONTRACT=BLOCKED_FULL_INSTRUCTION_CPU_MMIO_IRQ")
    print("GNG_R2_PROBE_REPORT=" + str(directory / "capabilities.json"))
    for reason in report["blockers"]:
        print("  BLOCKER: " + reason)


if __name__ == "__main__":
    main()
