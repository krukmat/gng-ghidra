#!/usr/bin/env bash
# R2.C: opt-in ROM-free integration + actual MAME 0.289 subset build on Linux.
# Never touches private ROMs, GitHub Actions or gng-ghidra/main.
# Usage: bash scripts/a063-r2c-linux-gate.sh --mame-source /clean/mame0289 [--jobs 2]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MAME_SRC=""
JOBS=2
RESUME_PATCHED=0
while (($#)); do
  case "$1" in
    --mame-source)
      (($# >= 2)) || { echo "R2C=BLOCKED missing_source" >&2; exit 2; }
      MAME_SRC="$2"; shift 2 ;;
    --resume-patched)
      RESUME_PATCHED=1; shift ;;
    --jobs)
      (($# >= 2)) || { echo "R2C=BLOCKED missing_jobs" >&2; exit 2; }
      JOBS="$2"; shift 2 ;;
    *) echo "R2C=BLOCKED unrecognized_argument" >&2; exit 2 ;;
  esac
done
[[ -n "$MAME_SRC" && -d "$MAME_SRC/.git" ]] || {
  echo "R2C=BLOCKED explicit_complete_mame_git_tree_required" >&2; exit 2;
}
[[ "$JOBS" =~ ^[1-9][0-9]*$ ]] || {
  echo "R2C=BLOCKED invalid_jobs" >&2; exit 2;
}
# Bounded progress output during an actual compilation. GitHub treats terminal
# output as activity, but cannot guarantee VM survival after disconnection.
HEARTBEAT_SECONDS="${A063_BUILD_HEARTBEAT_SECONDS:-180}"
BUILD_LIMIT_MINUTES="${A063_BUILD_LIMIT_MINUTES:-180}"
[[ "$HEARTBEAT_SECONDS" =~ ^[0-9]+$ ]] && ((HEARTBEAT_SECONDS >= 120 && HEARTBEAT_SECONDS <= 600)) || {
  echo "R2C=BLOCKED invalid_heartbeat_interval" >&2; exit 2;
}
[[ "$BUILD_LIMIT_MINUTES" =~ ^[0-9]+$ ]] && ((BUILD_LIMIT_MINUTES >= 30 && BUILD_LIMIT_MINUTES <= 360)) || {
  echo "R2C=BLOCKED invalid_build_limit" >&2; exit 2;
}
for app in python3 node git make timeout sha256sum find c++ stat date tee grep head cut mktemp strings; do
  command -v "$app" >/dev/null || {
    echo "R2C=BLOCKED missing_prerequisite" >&2; exit 2;
  }
done
MAME_SRC="$(cd "$MAME_SRC" && pwd -P)"
cd "$ROOT"
[[ -d .git && "$(git branch --show-current)" == "feature/a063-r1-forensics-contract" ]] || {
  echo "R2C=BLOCKED wrong_or_incomplete_gng_checkout" >&2; exit 2;
}
[[ -z "$(git status --porcelain --untracked-files=no)" ]] || {
  echo "R2C=BLOCKED tracked_sources_dirty" >&2; exit 2;
}
[[ "$(git -C "$MAME_SRC" describe --tags --exact-match HEAD)" == "mame0289" ]] || {
  echo "R2C=BLOCKED wrong_mame_tag" >&2; exit 2;
}
[[ "$(git -C "$MAME_SRC" rev-parse HEAD)" == "f34f02505e32c1993c6a782b6814232cbfc74e36" ]] || {
  echo "R2C=BLOCKED mame0289_upstream_commit_mismatch" >&2; exit 2;
}
if [[ "$RESUME_PATCHED" -eq 1 ]]; then
  python3 "$ROOT/scripts/a063_patch_mame_oracle.py" --mame-source "$MAME_SRC" --verify-applied || {
    echo "R2C=BLOCKED patched_mame_does_not_match_exact_expected_source" >&2; exit 2;
  }
else
  [[ -z "$(git -C "$MAME_SRC" status --porcelain --untracked-files=no)" ]] || {
    echo "R2C=BLOCKED mame_driver_must_be_clean" >&2; exit 2;
  }
fi
EVID_ROOT="${A063_EVIDENCE_ROOT:-$HOME/a063-private-romfree-evidence}"
python3 - "$ROOT" "$EVID_ROOT" <<'PY'
import sys
from pathlib import Path
repo=Path(sys.argv[1]).resolve()
target=Path(sys.argv[2]).resolve()
if target==repo or target.is_relative_to(repo):
    raise SystemExit("R2C=BLOCKED evidence_must_stay_outside_repository")
PY
mkdir -p "$EVID_ROOT"
chmod 700 "$EVID_ROOT"
EVID="$(mktemp -d "$EVID_ROOT/r2c-XXXXXXXX")"
chmod 700 "$EVID"
printf '%s\n' "R2C=EXECUTING evidence=$EVID"
printf 'schema=A063_R2C_ROM_FREE_EVIDENCE_V1\nstatus=BLOCKED_UNTIL_ALL_GATES_PASS\n' >"$EVID/checkpoint.txt"
{
  printf 'branch=%s\n' "$(git branch --show-current)"
  printf 'gng_commit=%s\n' "$(git rev-parse HEAD)"
  printf 'mame_commit=%s\n' "$(git -C "$MAME_SRC" rev-parse HEAD)"
  printf 'mame_tag=%s\n' "$(git -C "$MAME_SRC" describe --tags --exact-match HEAD)"
  printf 'python=%s\n' "$(python3 --version)"
  printf 'node=%s\n' "$(node --version)"
  printf 'compiler=%s\n' "$(c++ --version | head -n1)"
} >"$EVID/environment.txt"

set -o pipefail
bash scripts/a063-r2b-romfree.sh 2>&1 | tee "$EVID/romfree.log"
grep -Fxq 'GNG_LOCAL_REGRESSION=PASS_ROM_FREE_A0_2_TO_A0_6_3' "$EVID/romfree.log"
grep -Fxq 'A063_R2B=ROMFREE_CHECKS_PASS_NOT_NATIVE_NOT_A063_CERTIFIED' "$EVID/romfree.log"
python3 scripts/a063_oracle_replay.py | tee "$EVID/replay.json"
python3 - "$EVID/replay.json" <<'PY'
import json,sys
d=json.load(open(sys.argv[1],encoding='utf-8'))
if (d.get("status"),d.get("cases"),d.get("passed"),
    d.get("synthetic_trace_only")) != ("PASS",17,17,True):
    raise SystemExit("R2C=BLOCKED replay_incomplete")
PY
if [[ "$RESUME_PATCHED" -eq 1 ]]; then
  printf 'A063_PATCH=PREVIOUS_INTERRUPTED_BUILD_RESUME\n' >"$EVID/patch-check.log"
  python3 scripts/a063_patch_mame_oracle.py --mame-source "$MAME_SRC" --verify-applied \
    2>&1 | tee "$EVID/patch-apply.log"
else
  python3 scripts/a063_patch_mame_oracle.py --mame-source "$MAME_SRC" \
    2>&1 | tee "$EVID/patch-check.log"
  python3 scripts/a063_patch_mame_oracle.py --mame-source "$MAME_SRC" --apply \
    2>&1 | tee "$EVID/patch-apply.log"
fi
git -C "$MAME_SRC" diff --check

# The patch is now applied in the separate MAME checkout, never in main.
printf 'R2C_BUILD_MODE=%s jobs=%s\n' "$([[ "$RESUME_PATCHED" -eq 1 ]] && echo incremental_resume || echo initial_build)" "$JOBS"
BUILD_START_EPOCH="$(date +%s)"
if [[ -f /sys/fs/cgroup/memory.events ]]; then
  cp /sys/fs/cgroup/memory.events "$EVID/memory-before.txt" || :
fi
# The reporter stops when the compiler stops, even after a failed build.
# It reports activity only while real compilation is in progress. This is
# not a guarantee against Codespaces VM shutdown or lost login sessions.
(
  while sleep "$HEARTBEAT_SECONDS"; do
    now="$(date +%s)"
    printf 'R2C_BUILD_ACTIVE elapsed_minutes=%s jobs=%s max_minutes=%s\n' \
      "$(((now - BUILD_START_EPOCH) / 60))" "$JOBS" "$BUILD_LIMIT_MINUTES"
  done
) &
HEARTBEAT_PID=$!
printf 'R2C_BUILD_POLICY jobs=%s heartbeat_seconds=%s limit_minutes=%s\n' \
  "$JOBS" "$HEARTBEAT_SECONDS" "$BUILD_LIMIT_MINUTES"
set +e
(
  cd "$MAME_SRC"
  timeout --signal=TERM --kill-after=60s "${BUILD_LIMIT_MINUTES}m" \
    make SUBTARGET=gnga063 SOURCES=src/mame/capcom/gng.cpp REGENIE=1 -j"$JOBS"
) 2>&1 | tee "$EVID/mame-build.log"
BUILD_RC=${PIPESTATUS[0]}
set -e
kill "$HEARTBEAT_PID" 2>/dev/null || :
wait "$HEARTBEAT_PID" 2>/dev/null || :
BUILD_ELAPSED_SECONDS="$(($(date +%s) - BUILD_START_EPOCH))"
if [[ -f /sys/fs/cgroup/memory.events ]]; then
  cp /sys/fs/cgroup/memory.events "$EVID/memory-after.txt" || :
fi
if [[ "$BUILD_RC" -ne 0 ]]; then
  printf '%s\n' 'schema=A063_R2C_ROM_FREE_EVIDENCE_V1' \
    'status=R2C_BUILD_FAILED' \
    "build_exit_code=$BUILD_RC" \
    "build_jobs=$JOBS" \
    "build_elapsed_seconds=$BUILD_ELAPSED_SECONDS" \
    'native_validation=NOT_PERFORMED' \
    'a063_certified=NO' >"$EVID/checkpoint.txt"
  printf 'R2C=BLOCKED mame_build_failed exit_code=%s evidence=%s\n' "$BUILD_RC" "$EVID" >&2
  exit "$BUILD_RC"
fi

# Avoid assuming a MAME executable location; verify actual 0.289 binary.
BIN=""
while IFS= read -r path; do
  [[ -x "$path" ]] || continue
  if "$path" -version 2>&1 | grep -E '0\.289([^0-9]|$)' >/dev/null; then
    if [[ -n "$BIN" ]]; then
      echo "R2C=BLOCKED multiple_mame_binaries" >&2; exit 2
    fi
    BIN="$path"
  fi
done < <(find "$MAME_SRC" -maxdepth 3 -type f \( -name '*gnga063*' -o -name 'mame' \) -print)
[[ -n "$BIN" ]] || {
  echo "R2C=BLOCKED compiled_mame_binary_not_found" >&2; exit 2;
}
[[ "$(stat -c %Y "$BIN")" -ge "$BUILD_START_EPOCH" ]] || {
  echo "R2C=BLOCKED stale_mame_binary_not_build_evidence" >&2; exit 2;
}
python3 -c 'from pathlib import Path; import sys; assert Path(sys.argv[1]).open("rb").read(4) == bytes.fromhex("7f454c46")' "$BIN" || {
  echo "R2C=BLOCKED non_elf_binary" >&2; exit 2;
}
"$BIN" -version >"$EVID/mame-version.txt" 2>&1
# Both checks require executable content from the patched driver; the
# binary must advertise the target set and contain the diagnostic symbol.
"$BIN" -listfull gngb >"$EVID/mame-driver-list.txt" 2>&1 || {
  echo "R2C=BLOCKED gngb_driver_missing_in_compiled_binary" >&2; exit 2;
}
grep -q 'gngb' "$EVID/mame-driver-list.txt" || {
  echo "R2C=BLOCKED gngb_driver_not_listed" >&2; exit 2;
}
strings -a "$BIN" | grep -F 'gng_a063_bank' >/dev/null || {
  echo "R2C=BLOCKED diagnostic_symbol_missing_in_compiled_binary" >&2; exit 2;
}
sha256sum "$BIN" >"$EVID/mame-binary.sha256"
sha256sum "$ROOT/patches/mame0289-a063-bank-oracle.patch" >"$EVID/mame-patch.sha256"
git -C "$MAME_SRC" diff -- src/mame/capcom/gng.cpp >"$EVID/mame-patch-applied.diff"
printf '%s\n' 'schema=A063_R2C_ROM_FREE_EVIDENCE_V1' \
  'status=R2C_ROM_FREE_READY' \
  "build_elapsed_seconds=$BUILD_ELAPSED_SECONDS" \
  "build_jobs=$JOBS" \
  'native_validation=NOT_PERFORMED' \
  'a063_certified=NO' \
  "gng_commit=$(git rev-parse HEAD)" \
  "mame_commit=$(git -C "$MAME_SRC" rev-parse HEAD)" \
  "binary_sha256=$(sha256sum "$BIN" | cut -d' ' -f1)" >"$EVID/checkpoint.txt"
sha256sum "$EVID"/* >"$EVID/manifest.sha256"
printf 'R2C=ROM_FREE_READY_NOT_NATIVE_NOT_A063_CERTIFIED evidence=%s\n' "$EVID"
