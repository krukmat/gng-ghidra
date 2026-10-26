#!/usr/bin/env python3
"""Emit fixed-status summary of T4.2's first private build attempt. No raw logs."""
from __future__ import annotations
import argparse
import re
from pathlib import Path

INNER = re.compile(r"(?m)^R35_T4_INNER=BLOCKED_([A-Z0-9_]+)\s*$")
SUCCEEDED = "R35_T4_BUILD=PASS_COMPILED_SEPARATE_ARM64_BINARY"


def classify(evidence: Path) -> dict[str, str]:
    base = evidence / "private-runner"
    prepare = base / "t4-prepare.ok"
    logfile = base / "t4-build.log"
    lock = base / "t4-build.lock"
    result = base / "t4-instrumented-bin.sha256"
    report = {
        "R35_T4_DIAG_PREPARED": "YES" if prepare.is_file() else "NO",
        "R35_T4_DIAG_LOG_PRESENT": "YES" if logfile.is_file() else "NO",
        "R35_T4_DIAG_BUILD_LOCK_PRESENT": "YES" if lock.is_dir() else "NO",
        "R35_T4_DIAG_BINARY_SHA_PRESENT": "YES" if result.is_file() else "NO",
        "R35_T4_DIAG_CAUSE": "UNKNOWN",
    }
    if not logfile.is_file() or logfile.is_symlink():
        report["R35_T4_DIAG_CAUSE"] = "PREBUILD_CONTRACT_OR_CONTAINER_FAILURE"
        return report
    try:
        # Build output can be large; read only the final 256KiB; no log printed.
        with logfile.open("rb") as source:
            source.seek(0, 2)
            source.seek(max(source.tell() - 262144, 0))
            raw = source.read(262144)
        log = raw.decode("utf-8", errors="replace")
    except OSError:
        report["R35_T4_DIAG_CAUSE"] = "LOG_UNREADABLE"
        return report

    markers = INNER.findall(log)
    if markers:
        # Closed vocabulary only: do not echo arbitrary error strings.
        known = {
            "MODIFIED_BUILD_SOURCE", "ORIGINAL_PATCH_INVALID",
            "COMPILED_BINARY_MISSING", "COMPILED_BINARY_NOT_ARM64",
            "INSTRUMENTED_MARKER_MISSING",
            "INSTRUMENTED_BINARY_IDENTICAL_TO_ORIGINAL",
            "PREPARE_CHECKPOINT_MISSING", "PREPARE_CHECKPOINT_INVALID",
            "PREPARED_SOURCE_MISSING", "BUILD_REVISION_MISMATCH",
            "BASELINE_BEFORE_BUILD_MISMATCH", "BUILD_ALREADY_ATTEMPTED",
            "BUILD_LOCK_EXISTS", "BUILD_CONCURRENTLY_STARTED",
        }
        report["R35_T4_DIAG_CAUSE"] = (
            "INNER_" + markers[-1] if markers[-1] in known
            else "INNER_OTHER_FAIL_CLOSED"
        )
    elif SUCCEEDED in log and result.is_file():
        report["R35_T4_DIAG_CAUSE"] = "SUCCESS_MARKER_PRESENT"
    elif re.search(r"No space left on device|Disk quota exceeded", log, re.I):
        report["R35_T4_DIAG_CAUSE"] = "DISK_EXHAUSTED"
    elif re.search(r"out of memory|cannot allocate memory|Killed signal terminated program cc1|fatal error: Killed", log, re.I):
        report["R35_T4_DIAG_CAUSE"] = "RESOURCE_EXHAUSTION_SUSPECTED"
    elif re.search(r"undefined reference|collect2: error|ld: error|linker command failed", log, re.I):
        report["R35_T4_DIAG_CAUSE"] = "LINK_FAILURE"
    elif re.search(r"error:|fatal error:|error C[0-9]{4}", log, re.I):
        report["R35_T4_DIAG_CAUSE"] = "COMPILER_OR_GENERATOR_ERROR"
    elif re.search(r"(?m)(make(\[[0-9]+\])?: \*\*\*|ninja: build stopped)", log):
        report["R35_T4_DIAG_CAUSE"] = "MAKE_FAILURE_UNCLASSIFIED"
    else:
        report["R35_T4_DIAG_CAUSE"] = "BUILD_LOG_NO_CLASSIFIED_ERROR"
    return report


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--evidence", type=Path, required=True)
    args = p.parse_args()
    for key, value in classify(args.evidence).items():
        print(f"{key}={value}")


if __name__ == "__main__":
    main()
