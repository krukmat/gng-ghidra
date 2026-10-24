#!/usr/bin/env bash
# Explicit Codespaces R2.E run; publish only bounded, sanitized failure/pass diagnostics.
# No ROM, no GitHub Actions, no automated changes to main.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
BRANCH="feature/a063-r1-forensics-contract"
[[ "$(git branch --show-current)" == "$BRANCH" ]] || {
  echo "A063_R2E=BLOCKED wrong_branch" >&2
  exit 2
}
[[ -z "$(git status --porcelain --untracked-files=no)" ]] || {
  echo "A063_R2E=BLOCKED tracked_tree_dirty" >&2
  exit 2
}
git pull --ff-only origin "$BRANCH" || {
  echo "A063_R2E=BLOCKED git_pull_failed" >&2
  exit 2
}

set +e
bash scripts/a063-codespaces-bootstrap.sh --validate
validation_rc=$?
set -e

# Always report a failed validation if its evidence exists.
set +e
bash scripts/a063-publish-codespaces-review.sh
publish_rc=$?
set -e

printf 'A063_R2E_VALIDATION_EXIT=%s\n' "$validation_rc"
printf 'A063_R2E_REPORT_PUBLISH_EXIT=%s\n' "$publish_rc"
if [[ "$publish_rc" -ne 0 ]]; then
  echo "A063_R2E=BLOCKED diagnostic_publish_failed" >&2
  exit 2
fi
if [[ "$validation_rc" -ne 0 ]]; then
  echo "A063_R2E=BLOCKED validation_failed_report_published"
  exit "$validation_rc"
fi
echo "A063_R2E=ROMFREE_READY_REPORT_PUBLISHED_NOT_NATIVE"
