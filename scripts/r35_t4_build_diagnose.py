#!/usr/bin/env python3
"""Emit fixed-status summary of T4.2's first private build attempt. No raw logs."""
from __future__ import annotations
import argparse
import re
from pathlib import Path

INNER = re.compile(r"(?m)^R35_T4_INNER=BLOCKED_([A-Z0-9_]+)\s*$")
SUCCEEDED = "R35_T4_BUILD=PASS_COMPILED_SEPARATE_ARM64_BINARY"
# Public GCC option names; anything else is reported as OTHER.
WERROR_FLAGS = (
    "misleading-indentation", "unused-variable", "unused-but-set-variable",
    "unused-function", "unused-label", "parentheses", "implicit-fallthrough",
    "format", "format-security", "overloaded-virtual", "suggest-override",
    "undef", "vla", "write-strings", "shadow", "dangling-else",
)

# No compiler line, symbol, path or disassembly ever leaves the private volume.
# These fixed categories only narrow the next patch to a single component.
def compiler_details(log: str) -> dict[str, str]:
    summary = {
        "R35_T4_DIAG_COMPONENT": "UNKNOWN",
        "R35_T4_DIAG_ERROR_KIND": "UNKNOWN",
        "R35_T4_DIAG_PUBLIC_API": "UNKNOWN",
        "R35_T4_DIAG_WERROR_FLAG": "NONE",
    }
    lines = log.splitlines()
    errors = [
        i for i, line in enumerate(lines)
        if re.search(r"(?:fatal )?error\s*:|(?i:syntaxerror)\s*:", line)
    ]
    if not errors:
        return summary
    i = errors[0]
    context = "\n".join(lines[max(0, i - 6): i + 1])
    diagnostic = lines[i]
    components = (
        ("M6809_GENERATED", r"m6809\.hxx"),
        ("HD6309_GENERATED", r"hd6309\.hxx"),
        ("KONAMI_GENERATED", r"konami\.hxx"),
        ("M6809_CPP", r"(?:/|^)m6809\.cpp\b"),
        ("M6809_HEADER", r"(?:/|^)m6809\.h\b"),
        ("M6809_MICROCODE", r"base6x09\.lst"),
        ("M6809_GENERATOR", r"m6809make\.py"),
    )
    # The failing line wins; with make -j, nearby context may name another TU.
    for text in (diagnostic, context):
        label = next((label for label, pattern in components
                      if re.search(pattern, text)), None)
        if label:
            summary["R35_T4_DIAG_COMPONENT"] = label
            break
    # GCC prints level-taking options with a trailing '=' (-Wformat=).
    flag = re.search(r"\[-Werror=([a-z0-9+-]+)=?\]", diagnostic)
    if flag:
        name = flag.group(1)
        summary["R35_T4_DIAG_WERROR_FLAG"] = (
            name.upper().replace("-", "_") if name in WERROR_FLAGS else "OTHER")
    for label, pattern in (
        ("WARNING_AS_ERROR", r"\[-Werror="),
        ("MISSING_MEMBER", r"no member named|has no member|not a member of"),
        ("UNDECLARED_IDENTIFIER", r"not declared in this scope|undeclared identifier|was not declared"),
        ("TYPE_OR_OVERLOAD", r"no matching function|no viable|invalid conversion|cannot convert|could not convert|invalid use of"),
        ("MISSING_INCLUDE", r"No such file or directory|file not found"),
        ("SYNTAX", r"expected|syntax error|invalid token"),
        ("REDEFINITION", r"redefinition|conflicting declaration"),
        ("LITERAL_OR_FORMAT", r"missing terminating|invalid suffix|format specifies"),
    ):
        if re.search(pattern, diagnostic, re.I):
            summary["R35_T4_DIAG_ERROR_KIND"] = label
            break
    if summary["R35_T4_DIAG_ERROR_KIND"] == "UNKNOWN":
        summary["R35_T4_DIAG_ERROR_KIND"] = "OTHER_COMPILER_ERROR"
    # Only identifiers occurring in existing, public instrumentation are eligible.
    for label, pattern in (
        ("STRING_VIEW", r"\bstring_view\b"),
        ("INPUTNUM_STRING", r"\binputnum_string\b"),
        ("TOTAL_CYCLES", r"\btotal_cycles\b"),
        ("MAME_LOGERROR", r"\blogerror\b"),
        ("MACHINE", r"\bmachine\b"),
        ("IRQ_LINE", r"\bM6809_IRQ_LINE\b"),
        ("FIRQ_LINE", r"\bM6809_FIRQ_LINE\b"),
        ("NMI_LINE", r"\bINPUT_LINE_NMI\b"),
        ("RESET_LINE", r"\bCLEAR_LINE\b"),
        ("CPU_PC", r"\bm_pc\b"),
        ("CPU_CC", r"\bm_cc\b"),
        ("CPU_EA", r"\bm_ea\b"),
    ):
        if re.search(pattern, diagnostic):
            summary["R35_T4_DIAG_PUBLIC_API"] = label
            break
    return summary



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
    if re.search(r"(?:fatal )?error\s*:|(?i:syntaxerror)\s*:", log):
        report.update(compiler_details(log))
    if markers:
        # Closed vocabulary only: do not echo arbitrary error strings.
        known = {
            "MODIFIED_BUILD_SOURCE", "ORIGINAL_PATCH_INVALID",
            "COMPILED_BINARY_MISSING", "COMPILED_BINARY_NOT_ARM64",
            "INSTRUMENTED_MARKER_MISSING", "INSTRUMENTED_EVENT_MISSING",
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
