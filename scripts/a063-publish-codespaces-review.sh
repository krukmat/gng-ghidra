#!/usr/bin/env bash
# Share only a bounded redacted R2.E summary through the private feature branch.
# This never stages ROMs, emulator binaries, native traces, ZIPs or raw logs.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
BRANCH="feature/a063-r1-forensics-contract"
REPORT="docs/audit/a063-r2e-codespaces-summary.md"

fail() {
  printf 'A063_REVIEW_PUBLISH=BLOCKED reason=%s\n' "$1" >&2
  exit 2
}

command -v git >/dev/null || fail missing_git
command -v python3 >/dev/null || fail missing_python
[[ "$(git branch --show-current)" == "$BRANCH" ]] || fail wrong_branch
[[ "$(git remote get-url origin)" =~ github.com[:/]krukmat/gng-ghidra(\.git)?$ ]] ||
  fail unexpected_remote
[[ -z "$(git diff --cached --name-only)" ]] || fail preexisting_staged_changes
[[ -z "$(git status --porcelain --untracked-files=no)" ]] || fail tracked_tree_dirty
git pull --ff-only origin "$BRANCH" >/dev/null || fail git_pull_failed

python3 scripts/a063-stage-codespaces-review.py || fail report_generation_failed

# Conservative safety gate. Do not echo rejected content to terminal.
python3 - "$REPORT" <<'PY' || fail safety_gate_rejected
from pathlib import Path
import re
import sys

path = Path(sys.argv[1])
if path.is_symlink() or not path.is_file():
    raise SystemExit(2)
content = path.read_text(encoding="utf-8")
if not (content.startswith("# A063 R2.E") and
        "### Run " in content and len(content) < 36000):
    raise SystemExit(2)
for marker in (
    r"(?i)GNG_R2_PRE", r"(?i)GNG_A06_BANKSIG",
    r"(?i)GNG_A063_ENTRY",
    r"(?i)BEGIN .{0,30} PRIVATE KEY",
    r"(?i)Authorization\s*:",
    r"github_pat_[A-Za-z0-9_]+",
    r"\bgh[pousr]_[A-Za-z0-9_]+",
    r"(?i)Bearer\s+\S+",
    r"(?i)\b(?:token|password|secret|api[_-]?key)\s*[:=]\s*\S+",
    r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b",
):
    if re.search(marker, content):
        raise SystemExit(2)
PY

git add -- "$REPORT"
STAGED="$(git diff --cached --name-only)"
if [[ -z "$STAGED" ]]; then
  echo "A063_REVIEW_PUBLISH=UNCHANGED_NO_COMMIT"
  exit 0
fi
[[ "$STAGED" == "$REPORT" ]] || fail unexpected_staged_file
git diff --cached --check || fail invalid_staged_patch

git commit -m "docs(a063): publish redacted Codespaces validation results" -- "$REPORT" >/dev/null ||
  fail commit_failed
git push origin "HEAD:refs/heads/$BRANCH" >/dev/null ||
  fail push_failed

printf 'A063_REVIEW_PUBLISH=PASS_REDACTED_SUMMARY_ONLY\n'
printf 'A063_REVIEW_COMMIT=%s\n' "$(git rev-parse --short HEAD)"
printf 'A063_REVIEW_PATH=%s\n' "$REPORT"
