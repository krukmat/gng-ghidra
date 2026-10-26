#!/usr/bin/env bash
# Invoked only by scripts/r35-t43-capture.sh inside a new-volume container.
# One cold boot of the T4.2 v2 binary: native IRQ/SYNC events via -oslog and
# a per-frame memory/video reference via Lua, in the same run. No debugger,
# soft reset, input, state load or write to emulated memory.
set -euo pipefail
umask 077
exec 3>&1
fail(){ printf 'R35_T43_CAPTURE=BLOCKED_%s\n' "$1" >&3; exit 2; }
trap 'rc=$?; printf "R35_T43_INNER_EXIT=%d\n" "$rc" >&3' EXIT
[[ $# -eq 0 ]] || fail INVALID_ARGUMENTS
BIN=/mame/mame0289/gnga063
SHAFILE=/t4evidence/private-runner/t4-instrumented-bin.sha256
OUT=/workspace/out
[[ "${GNG_T43_FRAMES:-}" =~ ^[1-9][0-9]{0,3}$ ]] && (( GNG_T43_FRAMES >= 2 && GNG_T43_FRAMES <= 3600 )) || fail FRAMES_INVALID
[[ "${GNG_T43_EXPECTED_HEAD:-}" =~ ^[0-9a-f]{40}$ ]] || fail EXPECTED_HEAD_REQUIRED
[[ "${SDL_AUDIODRIVER:-}" == dummy ]] || fail DUMMY_AUDIO_REQUIRED
[[ "$PWD" == /workspace && -d /workspace/.git ]] || fail READONLY_CHECKOUT_REQUIRED
# Preserve even a partial prior attempt: the capture volume must be empty.
for artifact in "$OUT"/* "$OUT"/.[!.]* "$OUT"/..?*; do
  [[ ! -e "$artifact" && ! -L "$artifact" ]] || fail CAPTURE_VOLUME_NOT_EMPTY
done
mkdir "$OUT/private-runner" "$OUT/capture" || fail CAPTURE_LAYOUT
exec >"$OUT/private-runner/run.log" 2>&1
[[ "$(git branch --show-current)" == feature/a063-r1-forensics-contract ]] || fail FEATURE_BRANCH_REQUIRED
[[ "$(git rev-parse --verify HEAD)" == "$GNG_T43_EXPECTED_HEAD" ]] || fail FROZEN_HEAD_CHANGED
[[ -z "$(git status --porcelain --untracked-files=no)" ]] || fail FROZEN_SOURCES_NOT_CLEAN
# The binary must be exactly the one T4.2 v2 attested in its evidence volume.
[[ -x "$BIN" && -f "$SHAFILE" ]] || fail T42_V2_BINARY_OR_ATTESTATION_MISSING
EXPECTED_SHA="$(tr -d '\n' <"$SHAFILE")"
[[ "$EXPECTED_SHA" =~ ^[0-9a-f]{64}$ ]] || fail T42_V2_ATTESTATION_INVALID
binary_matches(){ [[ "$(sha256sum "$BIN" | cut -d' ' -f1)" == "$EXPECTED_SHA" ]]; }
binary_matches || fail BINARY_NOT_T42_V2
for event in CPU_RESET LINE_DELIVERED SYNC_ENTER SYNC_EXIT IRQ_ENTRY VECTOR_FETCH; do
  grep -aFq "GNG_R35_NATIVE_V1"$'\t'"$event"$'\t' "$BIN" || fail INSTRUMENTED_EVENT_MISSING
done
[[ -r /workspace/roms/gng.zip ]] || fail ROM_MISSING
# MAME writes cfg/nvram/etc. relative to its cwd: keep them in tmpfs, and
# -noreadconfig keeps any ini out of the run.
MAMEHOME=/tmp/r35-t43-mame
mkdir -p "$MAMEHOME"
cd "$MAMEHOME"
"$BIN" -noreadconfig -verifyroms gngb -rompath /workspace/roms || fail ROM_VERIFY_FAILED
# 6 MHz pixel clock, 384x262 per frame: 59.64 Hz. The Lua exits after the
# last frame; -seconds_to_run is only a backstop against a stuck notifier.
SECONDS_TO_RUN=$(( GNG_T43_FRAMES / 59 + 10 ))
set +e
GNG_T43_DIR="$OUT/capture" timeout --signal=TERM --kill-after=10s 900s \
  xvfb-run -a -e "$OUT/private-runner/xvfb.log" \
  "$BIN" gngb -noreadconfig -rompath /workspace/roms -oslog \
  -autoboot_script /workspace/scripts/r35-t43-frames.lua \
  -window -nothrottle -sound none -skip_gameinfo \
  -seconds_to_run "$SECONDS_TO_RUN" >"$OUT/private-runner/mame.log" 2>&1
MAME_EXIT=$?
set -e
cd /workspace
binary_matches || fail BINARY_CHANGED_DURING_CAPTURE
[[ "$(git rev-parse --verify HEAD)" == "$GNG_T43_EXPECTED_HEAD" ]] || fail FROZEN_HEAD_CHANGED
printf 'R35_T43_MAME_EXIT=%d\n' "$MAME_EXIT" >&3
if grep -aFq '[LUA ERROR]' "$OUT/private-runner/mame.log"; then
  printf 'R35_T43_LUA=BLOCKED_LUA_ERROR\n' >&3
elif grep -aFq 'R35_T43_LUA=FRAMES_RECORDED' "$OUT/private-runner/mame.log"; then
  printf 'R35_T43_LUA=FRAMES_RECORDED\n' >&3
else
  printf 'R35_T43_LUA=BLOCKED_NOT_COMPLETED\n' >&3
fi
# Fixed-key summary only; summary.json stays in the private volume.
set +e
node scripts/r35_t43_summary.mjs "$OUT" "$GNG_T43_FRAMES" >&3
SUMMARY_EXIT=$?
set -e
[[ "$MAME_EXIT" == 0 && "$SUMMARY_EXIT" == 0 ]] || exit 2
printf 'R35_T43_CAPTURE=PASS_PRIVATE_COLD_BOOT_REFERENCE_CAPTURED\n' >&3
