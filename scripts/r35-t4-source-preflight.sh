#!/usr/bin/env bash
# R3.5.B2.T4.1: inspect cached ARM64 MAME source without creating artifacts.
# Does NOT build, patch, start MAME, or inspect private ROM/traces.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
MAME_VOL=gng-a063-mame0289-arm64-v1
IMAGE=sha256:a3bd689f9d867b51cd4a25f01b3dfd8ed0218b53f09347a714271e6cd964c255
fail(){ printf 'R35_T4_SOURCE=BLOCKED_%s\n' "$1" >&2; exit 2; }
[[ $# -eq 0 ]] || fail INVALID_ARGUMENTS
[[ "$(uname -s)" == Darwin && "$(uname -m)" == arm64 ]] || fail MAC_ARM64_REQUIRED
[[ "$(git -C "$ROOT" branch --show-current 2>/dev/null)" == feature/a063-r1-forensics-contract ]] || fail FEATURE_BRANCH_REQUIRED
command -v docker >/dev/null || fail DOCKER_CLI_MISSING
[[ "${DOCKER_HOST:-}" == "" || "${DOCKER_HOST:-}" == unix://* ]] || fail REMOTE_DOCKER_FORBIDDEN
endpoint="$(docker --context colima context inspect colima --format '{{(index .Endpoints "docker").Host}}' 2>/dev/null)" || fail COLIMA_CONTEXT_MISSING
[[ "$endpoint" == unix://* ]] || fail LOCAL_UNIX_DOCKER_REQUIRED
daemon="$(docker --context colima info --format '{{.OSType}} {{.Architecture}}' 2>/dev/null)" || fail COLIMA_UNAVAILABLE
[[ "$daemon" == "linux arm64" || "$daemon" == "linux aarch64" ]] || fail ARM64_DAEMON_REQUIRED
[[ "$(docker --context colima image inspect "$IMAGE" --format '{{.Id}} {{.Architecture}} {{.Os}}' 2>/dev/null)" == "$IMAGE arm64 linux" ]] || fail PINNED_IMAGE_MISSING
docker --context colima volume inspect "$MAME_VOL" >/dev/null 2>&1 || fail CACHED_SOURCE_VOLUME_MISSING
docker --context colima run --rm --pull never --network none --platform linux/arm64 \
  --read-only --cap-drop ALL --security-opt no-new-privileges \
  --tmpfs /tmp:rw,nosuid,nodev,size=64m \
  --mount "type=volume,src=$MAME_VOL,dst=/mame,readonly" \
  --mount "type=bind,src=$ROOT/scripts,dst=/workspace/scripts,readonly" \
  --mount "type=bind,src=$ROOT/patches,dst=/workspace/patches,readonly" \
  -e GIT_OPTIONAL_LOCKS=0 \
  -e GIT_CONFIG_COUNT=1 -e GIT_CONFIG_KEY_0=safe.directory \
  -e GIT_CONFIG_VALUE_0=/mame/mame0289 \
  -w /workspace "$IMAGE" bash -c '
    set -euo pipefail
    source=/mame/mame0289
    [[ -d "$source/.git" ]] || { echo "R35_T4_SOURCE=BLOCKED_GIT_SOURCE_MISSING"; exit 2; }
    [[ "$(git -C "$source" rev-parse HEAD)" == f34f02505e32c1993c6a782b6814232cbfc74e36 ]] || {
      echo "R35_T4_SOURCE=BLOCKED_SOURCE_REVISION_MISMATCH"; exit 2;
    }
    [[ "$(git -C "$source" describe --exact-match --tags HEAD)" == mame0289 ]] || {
      echo "R35_T4_SOURCE=BLOCKED_SOURCE_TAG_MISMATCH"; exit 2;
    }
    [[ -f "$source/src/devices/cpu/m6809/m6809.cpp" &&
       -f "$source/src/devices/cpu/m6809/base6x09.lst" &&
       -x "$source/gnga063" ]] || {
      echo "R35_T4_SOURCE=BLOCKED_SOURCE_OR_BINARY_INCOMPLETE"; exit 2;
    }
    [[ "$(sha256sum "$source/gnga063" | cut -d" " -f1)" == 80c447cd81fa91be8bf3159e22dedab157798a4f1a189e6680849179b0ac282d ]] || {
      echo "R35_T4_SOURCE=BLOCKED_PROTECTED_MAME_HASH"; exit 2;
    }
    python3 scripts/a063_patch_mame_oracle.py --mame-source "$source" --verify-applied >/dev/null || {
      echo "R35_T4_SOURCE=BLOCKED_SOURCE_PATCH_INVALID"; exit 2;
    }
    echo "R35_T4_SOURCE=PASS_CACHED_MAME0289_PATCHED_RO"
    echo "R35_T4_INSTRUMENTED_BINARY=NOT_BUILT"
    echo "R35_T4_NATIVE_EVIDENCE=NOT_CAPTURED"
  ' || fail GUEST_CHECK_FAILED
