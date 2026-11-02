#!/usr/bin/env bash
# Record command and stdout/stderr in out/h3/phaseN/commands.log.
# Usage: bash scripts/h3_run_logged.sh <visiblePhase> <command> [args...]
set -uo pipefail
[[ $# -ge 2 && "$1" =~ ^[2-9][0-9]*$ ]] || { echo H3_LOG_USAGE >&2; exit 2; }
phase="$1"; shift
[[ -z "$(printenv H3_POKE 2>/dev/null)" ]] || { echo H3_POKE_FORBIDDEN >&2; exit 2; }
logdir="out/h3/phase$phase"; mkdir -p "$logdir" || exit 2
chmod 700 "$logdir"
log="$logdir/commands.log"
{
  printf '\n[%s] $' "$(date -u +%FT%TZ)"
  printf ' %q' "$@"
  printf '\n'
} >> "$log"
"$@" 2>&1 | tee -a "$log"
rc=$?
printf '[%s] exit=%s\n' "$(date -u +%FT%TZ)" "$rc" >> "$log"
chmod 600 "$log"
exit "$rc"
