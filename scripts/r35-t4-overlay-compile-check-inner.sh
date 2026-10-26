#!/usr/bin/env bash
# Runs only in an ephemeral container: /reference is the protected MAME
# source (RO) and every write goes to tmpfs. Compiles the M6809 family
# (m6809, hd6309, konami: all include base6x09.lst) with the protected
# build's own optional.make flags, upstream first as harness control.
set -euo pipefail
umask 077
[[ $# -eq 0 ]] || exit 2
SOURCE=/reference/mame0289
PROJECT=$SOURCE/build/projects/sdl/mamegnga063/gmake-linux
WORK=/tmp/r35-t4-overlay-check
OVERLAY=/workspace/out/r3/native-mame-overlay
UPSTREAM=f34f02505e32c1993c6a782b6814232cbfc74e36
CORES=(m6809 hd6309 konami)
fail(){ echo "R35_T4_OVERLAY_COMPILE=BLOCKED_$1"; exit 2; }
# A bare set -e abort (tmpfs full, cp, mkdir) still ends in a marker.
trap 'rc=$?; if [[ $rc -ne 0 && $rc -ne 2 ]]; then echo R35_T4_OVERLAY_COMPILE=BLOCKED_INNER_ABORTED; exit 2; fi' EXIT
[[ -d "$SOURCE/.git" && -f "$PROJECT/optional.make" ]] || fail PROTECTED_BUILD_TREE_MISSING
[[ "$(git -C "$SOURCE" rev-parse HEAD)" == "$UPSTREAM" ]] || fail SOURCE_REVISION
[[ -z "$(git -C "$SOURCE" diff --name-only -- src/devices/cpu/m6809)" ]] || fail PROTECTED_M6809_SOURCE_MODIFIED

compile_family() {
  local label="$1" tree="$WORK/$1" core
  mkdir -p "$tree/src/devices/cpu" "$tree/gen/emu/cpu/m6809" "$tree/obj"
  cp -a "$SOURCE/src/devices/cpu/m6809" "$tree/src/devices/cpu/"
  if [[ "$label" == overlay ]]; then
    python3 scripts/r3_prepare_native_mame_hook.py --mame-source "$SOURCE" \
      --out "$OVERLAY" >/dev/null 2>&1 || fail OVERLAY_GENERATION
    for core in m6809.cpp base6x09.lst; do
      cp -- "$OVERLAY/src/devices/cpu/m6809/$core" "$tree/src/devices/cpu/m6809/$core"
    done
  fi
  for core in "${CORES[@]}"; do
    python3 "$tree/src/devices/cpu/m6809/m6809make.py" \
      "$tree/src/devices/cpu/m6809/$core.lst" > "$tree/gen/emu/cpu/m6809/$core.hxx" 2>/dev/null \
      || fail "MICROCODE_GENERATOR_${label^^}"
  done
  # optional.make's own compile command, with these generated headers first.
  {
    printf '.PHONY:'; printf ' r35check-%s' "${CORES[@]}"; printf '\n'
    for core in "${CORES[@]}"; do
      printf 'r35check-%s:\n\t@$(CXX) -I%s/gen/emu $(ALL_CXXFLAGS) $(FORCE_INCLUDE) -o %s/obj/%s.o -c %s/src/devices/cpu/m6809/%s.cpp > %s/%s.diag 2>&1; echo $$? > %s/%s.rc\n' \
        "$core" "$tree" "$tree" "$core" "$tree" "$core" "$tree" "$core" "$tree" "$core"
    done
  } > "$tree/check.mk"
  (cd "$PROJECT" && make --no-print-directory -j3 -f optional.make -f "$tree/check.mk" \
    config=release "${CORES[@]/#/r35check-}") >/dev/null 2>&1 || fail "MAKE_HARNESS_${label^^}"
}

# Only public-source diagnostics are summarised: file basename, line, flag.
first_error() {
  local diag="$1" line file flag
  line="$(grep -m1 -E ':[0-9]+:[0-9]+: (fatal )?error:' "$diag" || true)"
  [[ -n "$line" ]] || { echo NONE; return; }
  file="$(basename "$(cut -d: -f1 <<<"$line")")"
  flag="$(grep -oE '\[-Werror=[a-z0-9+-]+=?\]' <<<"$line" | head -n1 | sed -e 's/^\[-Werror=//' -e 's/=\{0,1\}\]$//')"
  printf '%s:%s:%s\n' "$file" "$(cut -d: -f2 <<<"$line")" "${flag:-COMPILER_ERROR}"
}

compile_family baseline
for core in "${CORES[@]}"; do
  [[ "$(cat "$WORK/baseline/$core.rc")" == 0 ]] || fail BASELINE_HARNESS_DOES_NOT_REPRODUCE_PROTECTED_BUILD
done
compile_family overlay
status=PASS_M6809_FAMILY_UPSTREAM_AND_OVERLAY_WERROR
for core in "${CORES[@]}"; do
  rc="$(cat "$WORK/overlay/$core.rc" 2>/dev/null)" || fail MAKE_HARNESS_OVERLAY_RESULT_MISSING
  errors="$(grep -cE ': (fatal )?error:' "$WORK/overlay/$core.diag" || true)"
  marker=ABSENT
  if [[ "$rc" == 0 ]] && grep -aFq GNG_R35_NATIVE_V1 "$WORK/overlay/obj/$core.o"; then marker=PRESENT; fi
  printf 'R35_T4_OVERLAY_TU=%s BASELINE=PASS OVERLAY=%s ERRORS=%s MARKER=%s FIRST_ERROR=%s\n' \
    "$core" "$([[ "$rc" == 0 ]] && echo PASS || echo FAIL)" "$errors" "$marker" \
    "$(first_error "$WORK/overlay/$core.diag")"
  [[ "$rc" == 0 ]] || status=BLOCKED_OVERLAY_COMPILE_ERRORS
  [[ "$rc" != 0 || "$marker" == PRESENT ]] || status=BLOCKED_OVERLAY_MARKER_MISSING
done
echo "R35_T4_OVERLAY_COMPILE=$status"
[[ "$status" == PASS_* ]] || exit 2
