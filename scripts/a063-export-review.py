#!/usr/bin/env python3
"""Export a small, redacted R2.E review ZIP from Codespaces ROM-free runs.

Reads only an allowlisted set of diagnostic files from the latest R2C run.
Never includes ROMs, CPU traces, preinstruction records, or MAME binaries.
Review the ZIP contents before sharing: redaction is best-effort.
"""
from __future__ import annotations

import argparse
from collections import deque
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_EVIDENCE_ROOT = Path.home() / "a063-private-romfree-evidence"
EXPORT = ROOT / "out" / "a063-r2e-review.zip"
SMALL_FILES = (
    "checkpoint.txt", "environment.txt", "replay.json",
    "patch-check.log", "patch-apply.log", "mame-version.txt",
    "mame-binary.sha256", "mame-patch.sha256",
)
LARGE_FILES = ("romfree.log", "mame-build.log")
MARKERS = re.compile(
    r"(?i)(?:\berror\b|\bfatal\b|\bfailed\b|\bblocked\b|"
    r"\bexception\b|\btraceback\b|\bassertionerror\b|"
    r"\bPASS\b|\bFAIL\b|\bnot ok\b|\bwarning\b|"
    r"\bRan \d+ tests\b|\btest_[A-Za-z0-9_]+\b|"
    r"^\s*[#>]\s*(?:tests|pass|fail|duration)|"
    r"\bGNG_[A-Z0-9_]+=|\bA063_[A-Z0-9_]+=|\bR2C=)"
)
SECRETS = (
    re.compile(r"\b(?:github_pat_|gh[pousr]_)[a-zA-Z0-9_]+"),
    re.compile(r"(?i)\bBearer\s+[^\s\"']+"),
    re.compile(r"(?i)(\b(?:token|password|passwd|secret|api[_-]?key)\b\s*[:=]\s*)[^\s,;]+"),
    re.compile(r"(https?://)[^\s/@:]+:[^\s/@]+@"),
)
MAX_SMALL = 120_000
MAX_LINE = 420


def redact(value: str) -> str:
    value = value.replace(str(Path.home()), "$HOME")
    value = value.replace(str(ROOT), "$REPO")
    value = re.sub(r"(?i)\b(?:roms/)?gngb?\.zip\b", "<PRIVATE_ROM>", value)
    for n, rx in enumerate(SECRETS):
        value = rx.sub(r"\1<REDACTED>" if n == 2 else
                       r"\1<REDACTED>@" if n == 3 else
                       "<REDACTED>", value)
    return value[:MAX_LINE] + (" ... [truncated]" if len(value) > MAX_LINE else "")


def safe_text(path: Path, *, large: bool) -> str:
    if path.is_symlink() or not path.is_file():
        return "[not present or symbolic link; skipped]\n"
    if not large and path.stat().st_size > MAX_SMALL:
        return "[file too large; skipped]\n"
    if not large:
        return "\n".join(redact(x) for x in path.read_text(
            encoding="utf-8", errors="replace").splitlines()) + "\n"
    # Bounded memory; keep the end of the log and diagnostic lines.
    tail = deque(maxlen=100)
    findings = deque(maxlen=160)
    line_count = 0
    with path.open("r", encoding="utf-8", errors="replace") as stream:
        for line in stream:
            line_count += 1
            if len(line) > 10000:
                continue
            cleaned = redact(line.rstrip("\n"))
            tail.append(cleaned)
            if MARKERS.search(line):
                findings.append(f"L{line_count}: {cleaned}")
    return (
        f"[original lines: {line_count}; selected diagnostic lines + last 100]\n"
        + "\n".join(findings)
        + "\n\n--- LOG TAIL ---\n"
        + "\n".join(tail) + "\n"
    )


def export(evidence_root: Path, destination: Path) -> tuple[Path, int]:
    evidence_root = evidence_root.expanduser().resolve()
    candidates = [p for p in evidence_root.glob("r2c-*")
                  if p.is_dir() and not p.is_symlink()]
    if not candidates:
        raise ValueError("A063_REVIEW=NO_R2C_RUNS_FOUND")
    candidates.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    chosen = candidates[:2]
    destination = destination.resolve()
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.is_relative_to(evidence_root):
        raise ValueError("A063_REVIEW=EXPORT_MUST_BE_OUTSIDE_EVIDENCE")
    summary = {
        "schema": "gng.a063.redacted-codespaces-review.v1",
        "created_at_utc": datetime.now(timezone.utc).isoformat(),
        "mode": "ROM_FREE_ONLY_NOT_NATIVE_CERTIFICATION",
        "runs": [],
        "excluded": ["ROM", "cpu.trace", "pre-instruction.jsonl",
                     "MAME binary", "all unlisted private artifacts"],
        "warning": "Best-effort redaction. Inspect ZIP before sharing.",
    }
    with ZipFile(destination, "w", compression=ZIP_DEFLATED) as archive:
        for i, run in enumerate(chosen, 1):
            rel = f"run-{i}"
            info = {"rank": i, "files": {}}
            for filename in (*SMALL_FILES, *LARGE_FILES):
                candidate = run / filename
                if not candidate.is_file() or candidate.is_symlink():
                    continue
                content = safe_text(candidate, large=filename in LARGE_FILES)
                archive.writestr(f"{rel}/{filename}.redacted.txt", content)
                info["files"][filename] = {
                    "original_size_bytes": candidate.stat().st_size,
                    "original_sha256": hashlib.file_digest(
                        candidate.open("rb"), "sha256").hexdigest(),
                    "excerpt_included": True,
                }
            summary["runs"].append(info)
        archive.writestr("review-summary.json", json.dumps(
            summary, indent=2, ensure_ascii=False) + "\n")
        archive.writestr("READ_ME_FIRST.txt",
                         "This ZIP contains only allowlisted, redacted "
                         "ROM-free logs. Review contents before uploading. "
                         "Do not upload raw ROMs, traces or credentials.\n")
    os.chmod(destination, 0o600)
    return destination, len(chosen)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--evidence-root", type=Path,
                        default=Path(os.environ.get(
                            "A063_EVIDENCE_ROOT", str(DEFAULT_EVIDENCE_ROOT))))
    parser.add_argument("--output", type=Path, default=EXPORT)
    args = parser.parse_args()
    try:
        path, n = export(args.evidence_root, args.output)
    except (ValueError, OSError) as exc:
        parser.error(str(exc))
    print(f"A063_REVIEW=EXPORTED_REDACTED_ROMFREE_ONLY runs={n}")
    print(f"A063_REVIEW_FILE={path}")
    print("A063_REVIEW=INSPECT_ZIP_BEFORE_SHARING")


if __name__ == "__main__":
    main()
