#!/usr/bin/env python3
"""Extract observed pre-instruction MC6809 registers from native MAME tracelog.

Diagnostic-only format: gng.r2.pre-instruction.v1, never an R2 CPU trace.
Does not infer opcode bytes, post-execution registers, bus, bank, SYNC or IRQ.
All contents stay in ignored out/r2; no game ROM/source data enters Git.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path

SCHEMA = "gng.r2.pre-instruction.v1"
FIELDS = {"PC": 4, "A": 2, "B": 2, "X": 4, "Y": 4,
          "U": 4, "S": 4, "DP": 2, "CC": 2}
MARKER = "GNG_R2_PRE"
# tracelog may write the marker on the same physical line as MAME disassembly,
# or on a separate line. Never rely on reformatting the disassembly.
PATTERN = re.compile(
    r"(?<!\w)GNG_R2_PRE\s+" +
    r"\s+".join(rf"{key}=([0-9A-Fa-f]{{{digits}}})" for key, digits in FIELDS.items()) +
    r"(?=\s|$|[^0-9A-Za-z_])"
)


def safe_marker_shape(line: str) -> dict:
    """Describe field delimiters/widths without exposing ROM or CPU values.

    This intentionally redacts every numeric value, opcode and disassembly
    text. It is safe to share the resulting JSON shape in a bug report.
    """
    tail = line.split(MARKER, 1)[1][:350]
    fields = {}
    for name in FIELDS:
        match = re.search(r"(?<![A-Za-z0-9_])" + name +
                          r"\\s*=\\s*([^\\s,;]+)", tail, re.I)
        if not match:
            fields[name] = {"present": False}
            continue
        token = match.group(1)
        raw = token[2:] if token.lower().startswith("0x") else token
        fields[name] = {
            "present": True,
            "characters": len(token),
            "hex_characters": len(raw) if re.fullmatch(r"[0-9a-fA-F]+", raw) else None,
            "prefix_0x": token.lower().startswith("0x"),
            "literal_percent_format": token.startswith("%"),
        }
    return {
        "marker_count_on_line": line.count(MARKER),
        "field_shapes": fields,
        "fields_present": sum(v["present"] for v in fields.values()),
    }


def extract(trace: Path, snapshots: Path) -> dict:
    report = {
        "schema": "gng.r2.pretrace-report.v1",
        "status": "INSTRUMENTATION_BLOCKED",
        "origin": "MAME native debugger tracelog (no generated code)",
        "genuine_cpu_execution_verified": False,
        "provenance_authenticated": False,
        "full_r2_trace_verified": False,
        "after_state_available": False,
        "ordered_instruction_bus_available": False,
        "irq_or_sync_entry_verified": False,
        "snapshots": 0,
        "blockers": [],
    }
    if not trace.is_file() or trace.stat().st_size < 1:
        report["blockers"].append("native MAME trace missing/empty")
        return report
    with trace.open("rb") as binary:
        report["trace_sha256"] = hashlib.file_digest(binary, "sha256").hexdigest()
    records = []
    seen = 0
    malformed = []
    diagnostic_shapes = []
    lines = 0
    with trace.open("r", encoding="utf-8", errors="replace") as fh:
        for line_no, line in enumerate(fh, 1):
            lines += 1
            if MARKER not in line:
                continue
            seen += line.count(MARKER)
            m = PATTERN.search(line)
            if not m or line.count(MARKER) != 1:
                malformed.append(line_no)
                if len(diagnostic_shapes) < 3:
                    diagnostic_shapes.append(safe_marker_shape(line))
                continue
            state = {key: int(raw, 16) for key, raw in zip(FIELDS, m.groups())}
            records.append({
                "schema": SCHEMA, "kind": "pre_instruction",
                "seq": len(records), "trace_line": line_no,
                "pc": state["PC"], "before": state,
                "origin": "mame-native-tracelog",
            })
            if len(records) > 250000:
                report["blockers"].append("preinstruction sample limit exceeded")
                return report
    report.update({"trace_lines": lines, "markers_seen": seen,
                   "snapshots": len(records),
                   "first_pc": records[0]["pc"] if records else None,
                   "last_pc": records[-1]["pc"] if records else None,
                   "distinct_pc_count": len({r["pc"] for r in records}),
                   "malformed_markers": len(malformed),
                   "malformed_shapes_redacted": diagnostic_shapes})
    if malformed:
        report["blockers"].append(
            "malformed/ambiguous native tracelog records at line(s): " +
            ",".join(str(v) for v in malformed[:6]))
    if len(records) != seen:
        report["blockers"].append("native preinstruction markers not all parsed")
    if len(records) < 2:
        report["blockers"].append("insufficient authentic preinstruction samples")
    if report["blockers"]:
        return report
    # No false COMPLETE status; these are ONLY before-register snapshots.
    snapshots.write_text(
        "".join(json.dumps(v, separators=(",", ":")) + "\n" for v in records),
        encoding="utf-8")
    report["status"] = "PRE_INSTRUCTION_FORMAT_PARSED"
    # Parsing is not provenance: even a synthetically created text file can
    # contain valid markers. The invoking native MAME process must be checked
    # separately before treating this as genuine CPU observation.
    report["snapshots_file"] = str(snapshots)
    report["blockers"].extend((
        "opcode bytes and post-instruction registers not observed here",
        "no ordered per-instruction bus/fetch/stack/MMIO correlation",
        "reset, bank edges, SYNC and IRQ still need direct instrumentation",
    ))
    return report


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dir", type=Path, default=Path("out/r2/mame-probe"))
    args = ap.parse_args()
    root = Path(__file__).resolve().parents[1]
    allowed = (root / "out" / "r2").resolve()
    folder = args.dir.resolve()
    if not folder.is_relative_to(allowed):
        ap.error("outputs must remain under private out/r2")
    folder.mkdir(parents=True, exist_ok=True)
    out = folder / "pre-instruction.jsonl"
    out.unlink(missing_ok=True)
    report = extract(folder / "cpu.trace", out)
    report_path = folder / "pretrace-report.json"
    report_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n",
                           encoding="utf-8")
    print("GNG_R2_PRETRACE=" + report["status"])
    print("GNG_R2_PRETRACE_SNAPSHOTS=" + str(report["snapshots"]))
    print("GNG_R2_PRETRACE_REPORT=" + str(report_path))
    print("GNG_R2_PRETRACE_PROVENANCE=PARSER_ONLY_NOT_AUTHENTICATED")
    print("GNG_R2_FULL_CPU_TRACE=NOT_VERIFIED")
    for msg in report["blockers"]:
        print("  BLOCKER: " + msg)


if __name__ == "__main__":
    main()
