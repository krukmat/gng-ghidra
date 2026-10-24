#!/usr/bin/env bash
# A063 ROM-free session-safe launcher for GitHub Codespaces.
# Browser logout/disconnection: worker may continue while Codespace runs.
# Codespace stop / 12h lifetime: kills worker; run 'start' again after login.
# No keepalive, no GitHub Actions, no ROM upload, no main changes.
set -euo pipefail
umask 077

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
BRANCH="feature/a063-r1-forensics-contract"
EVID="${A063_EVIDENCE_ROOT:-$HOME/a063-private-romfree-evidence}"
LOCK="$EVID/r2e-session.lock"
STATE="$EVID/r2e-session.status"
LOG="$EVID/r2e-session.log"
ACTION="${1:-start}"

fail() { printf 'A063_SESSION=BLOCKED reason=%s\n' "$1" >&2; exit 2; }

for bin in git bash flock nohup; do
  command -v "$bin" >/dev/null || fail "missing_$bin"
done
[[ "$(git branch --show-current)" == "$BRANCH" ]] || fail wrong_branch
python3 - "$ROOT" "$EVID" <<'PY' || fail evidence_must_be_external
import sys
from pathlib import Path
root = Path(sys.argv[1]).resolve()
evid = Path(sys.argv[2]).expanduser().resolve()
assert not (evid == root or evid.is_relative_to(root))
PY
mkdir -p "$EVID"
chmod 700 "$EVID"

running() {
  (
    exec 9>>"$LOCK"
    ! flock -n 9
  )
}

status() {
  if running; then
    printf 'A063_SESSION=RUNNING\n'
  elif [[ -f "$STATE" ]]; then
    local state
    state="$(cat "$STATE")"
    case "$state" in
      PASS|FAILED:*|STOPPED:*|RUNNING)
        if [[ "$state" == RUNNING ]]; then
          printf 'A063_SESSION=INTERRUPTED_OR_CODESPACE_STOPPED\n'
        else
          printf 'A063_SESSION=%s\n' "$state"
        fi ;;
      *) printf 'A063_SESSION=UNKNOWN_STATE\n' ;;
    esac
  else
    printf 'A063_SESSION=NOT_STARTED\n'
  fi
  printf 'A063_SESSION_LOG=%s\n' "$LOG"
  printf 'A063_SESSION_NOTE=LOG_PRIVATE_OUTSIDE_REPOSITORY\n'
}

case "$ACTION" in
  status|--status)
    status
    ;;
  start|--start)
    if running; then
      printf 'A063_SESSION=ALREADY_RUNNING_NO_DUPLICATE_BUILD\n'
      exit 0
    fi
    [[ -z "$(git status --porcelain --untracked-files=no)" ]] ||
      fail tracked_tree_dirty
    git pull --ff-only origin "$BRANCH" >/dev/null || fail git_pull_failed
    # Keep the previous log as private evidence of an interruption.
    if [[ -f "$LOG" ]]; then
      mv -f "$LOG" "$EVID/r2e-session.previous.log"
    fi
    printf 'RUNNING\n' > "$STATE"
    nohup bash "$ROOT/scripts/a063-r2e-session.sh" __worker \
      >"$LOG" 2>&1 </dev/null &
    printf 'A063_SESSION=START_REQUESTED background_pid=%s\n' "$!"
    printf 'A063_SESSION_LOG=%s\n' "$LOG"
    printf 'A063_SESSION_NOTE=LOGOUT_OK_IF_CODESPACE_REMAINS_RUNNING\n'
    ;;
  __worker)
    exec 9>>"$LOCK"
    if ! flock -n 9; then
      printf 'A063_SESSION=ALREADY_RUNNING_NO_DUPLICATE_BUILD\n'
      exit 0
    fi
    printf 'RUNNING\n' >"$STATE"
    printf 'A063_SESSION_WORKER=STARTED\n'
    set +e
    bash "$ROOT/scripts/a063-r2e-validate-and-report.sh"
    code=$?
    set -e
    if [[ "$code" -eq 0 ]]; then
      printf 'PASS\n' >"$STATE"
      printf 'A063_SESSION_WORKER=PASS_ROMFREE_NOT_NATIVE\n'
    else
      printf 'FAILED:%s\n' "$code" >"$STATE"
      printf 'A063_SESSION_WORKER=FAILED_CHECK_REDACTED_GITHUB_REPORT exit=%s\n' "$code"
    fi
    exit "$code"
    ;;
  *) fail invalid_action ;;
esac
