#!/usr/bin/env bash
# Runs exclusively in new Docker volumes. Original /reference is RO.
set -euo pipefail
umask 077
[[ $# -eq 1 ]] || exit 2
ACTION="$1"
case "$ACTION" in --prepare|--build) ;; *) exit 2 ;; esac
SOURCE=/reference/mame0289
TARGET=/mame/mame0289
PRIVATE=/workspace/out/private-runner
OVERLAY=/workspace/out/r3/native-mame-overlay
ORIG_SHA=80c447cd81fa91be8bf3159e22dedab157798a4f1a189e6680849179b0ac282d
UPSTREAM=f34f02505e32c1993c6a782b6814232cbfc74e36
fail(){ echo "R35_T4_INNER=BLOCKED_$1"; exit 2; }
[[ -d "$SOURCE/.git" && -x "$SOURCE/gnga063" ]] || fail ORIGINAL_SOURCE_MISSING
[[ "$(git -C "$SOURCE" rev-parse HEAD)" == "$UPSTREAM" ]] || fail SOURCE_REVISION
[[ "$(sha256sum "$SOURCE/gnga063" | cut -d' ' -f1)" == "$ORIG_SHA" ]] || fail PROTECTED_BINARY_CHANGED
python3 scripts/a063_patch_mame_oracle.py --mame-source "$SOURCE" --verify-applied >/dev/null || fail ORIGINAL_PATCH_INVALID

if [[ "$ACTION" == --prepare ]]; then
  [[ ! -e "$TARGET" && ! -L "$TARGET" ]] || fail TARGET_ALREADY_EXISTS
  [[ ! -e "$PRIVATE" && ! -L "$PRIVATE" ]] || fail EVIDENCE_ALREADY_EXISTS
  [[ -z "$(find /mame -mindepth 1 -maxdepth 1 -print -quit)" ]] || fail WORK_VOLUME_NOT_EMPTY
  [[ -z "$(find /workspace/out -mindepth 1 -maxdepth 1 -print -quit)" ]] || fail EVIDENCE_VOLUME_NOT_EMPTY
  mkdir -m 700 "$PRIVATE"
  exec > "$PRIVATE/t4-prepare.log" 2>&1
  required="$(du -sk "$SOURCE" | awk '{print $1}')"
  available="$(df -Pk /mame | awk 'NR==2 {print $4}')"
  [[ "$available" -gt "$((required + 4 * 1024 * 1024))" ]] || fail NOT_ENOUGH_FREE_DISK_FOR_ISOLATED_COPY
  mkdir -m 700 "$TARGET"
  cp -a "$SOURCE/." "$TARGET/"
  [[ "$(git -C "$TARGET" rev-parse HEAD)" == "$UPSTREAM" ]] || fail COPIED_SOURCE_REVISION
  [[ "$(sha256sum "$TARGET/gnga063" | cut -d' ' -f1)" == "$ORIG_SHA" ]] || fail COPIED_BINARY_CHANGED
  python3 scripts/a063_patch_mame_oracle.py --mame-source "$TARGET" --verify-applied >/dev/null || fail COPIED_PATCH_INVALID
  python3 scripts/r3_prepare_native_mame_hook.py --mame-source "$TARGET" --out "$OVERLAY" > "$PRIVATE/overlay-result.json" || fail OVERLAY_PREPARATION
  for rel in src/devices/cpu/m6809/m6809.cpp src/devices/cpu/m6809/base6x09.lst; do
    [[ -f "$OVERLAY/$rel" ]] || fail MISSING_OVERLAY_FILE
    cp -- "$OVERLAY/$rel" "$TARGET/$rel"
    cmp -s "$OVERLAY/$rel" "$TARGET/$rel" || fail OVERLAY_COPY_MISMATCH
  done
  tracked="$(git -C "$TARGET" diff --name-only | LC_ALL=C sort)"
  expected="$(printf '%s\n' src/mame/capcom/gng.cpp src/devices/cpu/m6809/m6809.cpp src/devices/cpu/m6809/base6x09.lst | LC_ALL=C sort)"
  [[ "$tracked" == "$expected" ]] || fail UNEXPECTED_PATCHED_SOURCES
  git -C "$TARGET" diff --check || fail PATCH_WHITESPACE
  [[ "$(sha256sum "$SOURCE/gnga063" | cut -d' ' -f1)" == "$ORIG_SHA" ]] || fail ORIGINAL_BINARY_CHANGED
  printf 'UPSTREAM=%s\nORIG_SHA=%s\n' "$UPSTREAM" "$ORIG_SHA" > "$PRIVATE/t4-prepare.ok"
  echo R35_T4_PREPARE=PASS_ISOLATED_OVERLAY_READY
  exit 0
fi

# Build mode refuses retries over partial evidence, and does not recopy source.
[[ -f "$PRIVATE/t4-prepare.ok" && ! -L "$PRIVATE/t4-prepare.ok" ]] || fail PREPARE_CHECKPOINT_MISSING
[[ "$(cat "$PRIVATE/t4-prepare.ok")" == "$(printf 'UPSTREAM=%s\nORIG_SHA=%s' "$UPSTREAM" "$ORIG_SHA")" ]] || fail PREPARE_CHECKPOINT_INVALID
[[ -d "$TARGET/.git" ]] || fail PREPARED_SOURCE_MISSING
[[ "$(git -C "$TARGET" rev-parse HEAD)" == "$UPSTREAM" ]] || fail BUILD_REVISION_MISMATCH
[[ "$(sha256sum "$TARGET/gnga063" | cut -d' ' -f1)" == "$ORIG_SHA" ]] || fail BASELINE_BEFORE_BUILD_MISMATCH
[[ ! -e "$PRIVATE/t4-build.log" && ! -L "$PRIVATE/t4-build.log" ]] || fail BUILD_ALREADY_ATTEMPTED
[[ ! -e "$PRIVATE/t4-build.lock" && ! -L "$PRIVATE/t4-build.lock" ]] || fail BUILD_LOCK_EXISTS
mkdir "$PRIVATE/t4-build.lock" || fail BUILD_CONCURRENTLY_STARTED
exec > "$PRIVATE/t4-build.log" 2>&1
tracked="$(git -C "$TARGET" diff --name-only | LC_ALL=C sort)"
expected="$(printf '%s\n' src/mame/capcom/gng.cpp src/devices/cpu/m6809/m6809.cpp src/devices/cpu/m6809/base6x09.lst | LC_ALL=C sort)"
[[ "$tracked" == "$expected" ]] || fail MODIFIED_BUILD_SOURCE
python3 scripts/a063_patch_mame_oracle.py --mame-source "$SOURCE" --verify-applied >/dev/null || fail ORIGINAL_PATCH_INVALID
cd "$TARGET"
make -j4 SUBTARGET=gnga063 SOURCES=src/mame/capcom/gng.cpp REGENIE=1
[[ -x "$TARGET/gnga063" ]] || fail COMPILED_BINARY_MISSING
file "$TARGET/gnga063" | grep -q 'ARM aarch64' || fail COMPILED_BINARY_NOT_ARM64
grep -aFq GNG_R35_NATIVE_V1 "$TARGET/gnga063" || fail INSTRUMENTED_MARKER_MISSING
# The prefix alone could come from m6809.cpp; the microcode events must be linked too.
for event in CPU_RESET LINE_DELIVERED SYNC_ENTER SYNC_EXIT IRQ_ENTRY VECTOR_FETCH; do
  grep -aFq "GNG_R35_NATIVE_V1"$'\t'"$event"$'\t' "$TARGET/gnga063" || fail INSTRUMENTED_EVENT_MISSING
done
NEW_SHA="$(sha256sum "$TARGET/gnga063" | cut -d' ' -f1)"
[[ "$NEW_SHA" != "$ORIG_SHA" ]] || fail INSTRUMENTED_BINARY_IDENTICAL_TO_ORIGINAL
"$TARGET/gnga063" -version
printf '%s\n' "$NEW_SHA" > "$PRIVATE/t4-instrumented-bin.sha256"
echo "R35_T4_BUILD=PASS_COMPILED_SEPARATE_ARM64_BINARY"
