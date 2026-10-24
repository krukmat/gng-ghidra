#!/usr/bin/env python3
"""Stage a small, redacted ROM-free Codespaces report for review via private GitHub.

Does not commit/push automatically. Never stages raw logs, ZIPs, native CPU
traces, ROMs, or binaries. Operator must inspect the generated text before push.
"""
from __future__ import annotations

import json
from collections import deque
import os
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import importlib.util

_SPEC = importlib.util.spec_from_file_location(
    "a063_export_review", ROOT / "scripts" / "a063-export-review.py"
)
assert _SPEC and _SPEC.loader
mod = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(mod)

DEST = ROOT / "docs" / "audit" / "a063-r2e-codespaces-summary.md"
EVID_ROOT = Path(os.environ.get(
    "A063_EVIDENCE_ROOT", str(Path.home() / "a063-private-romfree-evidence")))
ERROR = re.compile(
    r"(?i)(?:\berror\b|\bfailed\b|\bblocked\b|\bfatal\b|"
    r"\bexception\b|\btraceback\b|\bassertionerror\b|"
    r"\bnot ok\b|\bFAIL\b|\bwarning\b|"
    r"\btest_[a-z0-9_]+\b|\bRan \d+ tests\b|"
    r"\bR2C=|\bA063_[A-Z0-9_]+=|\bGNG_[A-Z0-9_]+=)"
)
FORBIDDEN = re.compile(
    r"(?i)(?:GNG_R2_PRE|GNG_A06_BANKSIG|GNG_A063_ENTRY|"
    r"BEGIN .*?PRIVATE KEY|Authorization\s*:|"
    r"github_pat_[A-Za-z0-9_]+|\bgh[pousr]_[A-Za-z0-9_]+|"
    r"cpu\.trace|pre-instruction\.jsonl|"
    r"\b(?:roms/)?gngb?\.zip\b)"
)
# Strip user-specific absolute paths and addresses, just keep the
# actionable compiler/test diagnostics. Keep this conservative.
PATH = re.compile(r"(?<!\w)/(?:home|workspaces|tmp|root|Users)/[^\s:()\[\]{}]+")
EMAIL = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")
KV = re.compile(r"(?i)\b(?:token|password|secret|api[_-]?key|passwd)\b\s*[:=]\s*\S+")
MAX_ERRORS = 42


def scrub(s: str) -> str:
    s = mod.redact(s)
    s = EMAIL.sub("<EMAIL>", s)
    s = PATH.sub("<LOCAL_PATH>", s)
    s = KV.sub("<SECRET_VALUE>", s)
    if FORBIDDEN.search(s):
        return "[line omitted: sensitive or trace-like content]"
    return s[:250]


def read_small(run: Path, filename: str) -> str:
    p = run / filename
    if p.is_symlink() or not p.is_file() or p.stat().st_size > 32_000:
        return "[missing or oversized]"
    return p.read_text(encoding="utf-8", errors="replace")


def summarize(run: Path, number: int) -> str:
    result = [f"### Run {number}", ""]
    ck = read_small(run, "checkpoint.txt")
    for s in ck.splitlines():
        if re.match(r"^(?:schema|status|native_validation|a063_certified)=", s):
            result.append("- " + scrub(s))
    if ck == "[missing or oversized]":
        result.append("- checkpoint=NOT_AVAILABLE")
    try:
        replay = json.loads(read_small(run, "replay.json"))
    except (json.JSONDecodeError, ValueError):
        replay = {}
    if isinstance(replay, dict):
        allow = ("status", "cases", "passed", "failed_case_names",
                 "synthetic_banks", "synthetic_trace_only",
                 "native_bank_provenance_proven")
        for key in allow:
            v = replay.get(key)
            if type(v) in (str, bool, int) or (isinstance(v, list)
                and len(v) <= 30 and all(type(item) is str and len(item) < 90 for item in v)):
                result.append(f"- replay.{key}={scrub(json.dumps(v, ensure_ascii=False))}")
    for log in ("romfree.log", "mame-build.log", "patch-check.log", "patch-apply.log"):
        p = run / log
        if not p.is_file() or p.is_symlink():
            continue
        findings = deque(maxlen=42)
        # Streaming, bounded total findings; no export of entire logs.
        with p.open("r", encoding="utf-8", errors="replace") as stream:
            for line in stream:
                if ERROR.search(line) and len(line) <= 4000:
                    sanitized = scrub(line.rstrip("\r\n"))
                    if sanitized.startswith("[line omitted"):
                        continue
                    findings.append(sanitized)
        result.extend(("", f"**{log}** — last {MAX_ERRORS} diagnostic lines:", "", "```text"))
        result.extend(findings or ["[no error/status markers in selected lines]"])
        result.append("```")
    result.extend(("", ""))
    return "\n".join(result)


def stage() -> Path:
    base = EVID_ROOT.expanduser().resolve()
    runs = sorted(
        (p for p in base.glob("r2c-*") if p.is_dir() and not p.is_symlink()),
        key=lambda p: p.stat().st_mtime, reverse=True,
    )[:2]
    if not runs:
        raise ValueError("A063_GITHUB_REVIEW=NO_R2C_RUNS_FOUND")
    head = (
        "# A063 R2.E — Codespaces redacted diagnostic summary\n\n"
        "Generated from local ROM-free evidence only. This report does not "
        "certify native MAME bank provenance. No ROMs, binaries, raw logs, "
        "CPU traces, full paths or credentials should be included. "
        "Operator must inspect before committing to the private feature branch.\n\n"
    )
    body = head + "\n".join(summarize(r, i + 1) for i, r in enumerate(runs))
    # Prevent accidental raw trace or token sharing even after formatting.
    if FORBIDDEN.search(body):
        raise ValueError("A063_GITHUB_REVIEW=UNREDACTED_PATTERN_REJECTED")
    if len(body) > 36_000:
        raise ValueError("A063_GITHUB_REVIEW=OVERSIZED_OUTPUT")
    DEST.parent.mkdir(parents=True, exist_ok=True)
    DEST.write_text(body, encoding="utf-8")
    return DEST


if __name__ == "__main__":
    try:
        destination = stage()
    except (ValueError, OSError) as exc:
        raise SystemExit(str(exc)) from exc
    print("A063_GITHUB_REVIEW=STAGED_LOCAL_NOT_PUBLISHED")
    print(f"A063_GITHUB_REVIEW_FILE={destination.relative_to(ROOT)}")
    print("A063_GITHUB_REVIEW=INSPECT_BEFORE_GIT_ADD_COMMIT_PUSH")
