#!/usr/bin/env bash
# R2.E M5 Docker guest: only public MAME source and approved patch, never ROM.
set -euo pipefail
umask 077

fail() { printf 'A063_M5=BLOCKED reason=%s\n' "$1" >&2; exit 2; }
ACTION="$1"
REPO=/workspace
MAME=/mame/mame0289
EXPECTED=f34f02505e32c1993c6a782b6814232cbfc74e36

[[ "$(uname -s)" == Linux && "$(uname -m)" == aarch64 ]] ||
  fail native_linux_arm64_required
[[ -r "$REPO/patches/mame0289-a063-bank-oracle.patch" &&
   -f "$REPO/scripts/a063_patch_mame_oracle.py" ]] ||
  fail approved_source_missing
for bin in git python3 node make c++ sha256sum; do
  command -v "$bin" >/dev/null || fail missing_build_dependency
done
[[ "$(node --version)" =~ ^v2[0-9]\. ]] || fail node_20_or_newer_required

case "$ACTION" in
  prepare)
    bash "$REPO/scripts/a063-r2d-linux-preflight.sh" ||
      fail romfree_toolchain_preflight_failed
    if [[ ! -d "$MAME/.git" ]]; then
      [[ ! -e "$MAME" ]] || fail mame_target_exists_not_git
      git clone --depth 1 --single-branch --branch mame0289 \
        https://github.com/mamedev/mame.git "$MAME" ||
        fail public_mame_clone_failed
    fi
    ;;
  status)
    [[ -d "$MAME/.git" ]] || {
      printf 'A063_M5=NOT_PREPARED\n'
      exit 0
    }
    ;;
  *)
    fail expected_prepare_or_status
    ;;
esac

[[ "$(git -C "$MAME" rev-parse HEAD)" == "$EXPECTED" ]] ||
  fail mame_upstream_sha_mismatch
[[ "$(git -C "$MAME" describe --exact-match --tags HEAD)" == mame0289 ]] ||
  fail mame_tag_mismatch

if git -C "$MAME" diff --quiet -- src/mame/capcom/gng.cpp; then
  [[ "$ACTION" == prepare ]] || fail expected_patch_not_applied
  [[ -z "$(git -C "$MAME" status --porcelain --untracked-files=no)" ]] ||
    fail unapproved_mame_tracked_modifications
  python3 "$REPO/scripts/a063_patch_mame_oracle.py" --mame-source "$MAME" --apply ||
    fail patch_apply_failed
fi
python3 "$REPO/scripts/a063_patch_mame_oracle.py" --mame-source "$MAME" --verify-applied ||
  fail source_patch_integrity_failed

if [[ "$ACTION" == prepare ]]; then
  mkdir -p /evidence
  printf '%s\n' 'schema=A063_M5_D0_D2_V1' \
    'status=PREPARED_NOT_COMPILED' 'platform=linux/arm64' \
    'mame_tag=mame0289' "mame_commit=$EXPECTED" \
    'source_patch=VERIFIED_EXACT_APPLIED' \
    'rom_private_access=NONE' > /evidence/d0-d2-status.txt
  chmod 600 /evidence/d0-d2-status.txt
fi
printf 'A063_M5_D0_D2=PASS_ARM64_PATCHED_SOURCE_NOT_COMPILED\n'
