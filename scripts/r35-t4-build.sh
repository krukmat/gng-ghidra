#!/usr/bin/env bash
# R3.5.B2.T4.2: isolated ARM64 MAME overlay + build. No native capture.
set -euo pipefail
umask 077
ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
ACTION=--check
fail(){ printf 'R35_T4_BUILD=BLOCKED_%s\n' "$1" >&2; exit 2; }
[[ $# -le 1 ]] || fail INVALID_ARGUMENTS
if [[ $# -eq 1 ]]; then ACTION="$1"; fi
case "$ACTION" in --check|--prepare|--build) ;; *) fail INVALID_ACTION ;; esac
ORIGINAL=gng-a063-mame0289-arm64-v1
# Attempt 2. The attempt-1 volumes (-v1) keep the preserved first build
# failure (-Werror=misleading-indentation) and are never mounted here.
WORK=gng-r35-t4-mame-arm64-v2
EVIDENCE=gng-r35-t4-evidence-arm64-v2
IMAGE=sha256:a3bd689f9d867b51cd4a25f01b3dfd8ed0218b53f09347a714271e6cd964c255
[[ "$(git -C "$ROOT" branch --show-current 2>/dev/null)" == feature/a063-r1-forensics-contract ]] || fail FEATURE_BRANCH_REQUIRED
[[ "$(git -C "$ROOT" rev-parse --show-toplevel 2>/dev/null)" == "$ROOT" ]] || fail CHECKOUT_ROOT_REQUIRED
command -v docker >/dev/null || fail DOCKER_MISSING
case "$(printenv DOCKER_HOST 2>/dev/null || true)" in ''|unix://*) ;; *) fail REMOTE_DOCKER_FORBIDDEN ;; esac
endpoint="$(docker --context colima context inspect colima --format '{{(index .Endpoints "docker").Host}}' 2>/dev/null)" || fail COLIMA_CONTEXT_MISSING
[[ "$endpoint" == unix://* ]] || fail REMOTE_DOCKER_FORBIDDEN
daemon="$(docker --context colima info --format '{{.OSType}} {{.Architecture}}' 2>/dev/null)" || fail COLIMA_UNAVAILABLE
case "$daemon" in 'linux arm64'|'linux aarch64') ;; *) fail ARM64_DAEMON_REQUIRED ;; esac
[[ "$(docker --context colima image inspect "$IMAGE" --format '{{.Id}} {{.Architecture}} {{.Os}}' 2>/dev/null)" == "$IMAGE arm64 linux" ]] || fail PINNED_IMAGE_MISSING
docker --context colima volume inspect "$ORIGINAL" >/dev/null 2>&1 || fail PROTECTED_SOURCE_MISSING

# Reuse the previously validated immutable source; never use it as build RW.
bash "$ROOT/scripts/r35-t4-source-preflight.sh" >/dev/null || fail PROTECTED_SOURCE_INVALID

if [[ "$ACTION" == --check || "$ACTION" == --prepare ]]; then
  # A fresh attempt is only spent once the overlay compiles ROM-free.
  bash "$ROOT/scripts/r35-t4-overlay-compile-check.sh" >/dev/null 2>&1 || fail OVERLAY_COMPILE_CHECK_FAILED
  for name in "$WORK" "$EVIDENCE"; do
    if docker --context colima volume inspect "$name" >/dev/null 2>&1; then
      fail FRESH_ISOLATED_VOLUME_REQUIRED
    fi
  done
  if [[ "$ACTION" == --check ]]; then
    echo R35_T4_BUILD=CHECK_PASS_ISOLATED_VOLUMES_NOT_CREATED
    exit 0
  fi
  # A UUID ownership label detects races; never overwrite an existing volume.
  nonce="$(python3 -c 'import uuid; print(uuid.uuid4().hex)')"
  for name in "$WORK" "$EVIDENCE"; do
    docker --context colima volume create --label "gng.r35.t4.owner=$nonce" "$name" >/dev/null || fail VOLUME_CREATE_FAILED
    owner="$(docker --context colima volume inspect "$name" --format '{{index .Labels "gng.r35.t4.owner"}}' 2>/dev/null)" || fail VOLUME_VERIFY_FAILED
    [[ "$owner" == "$nonce" ]] || fail CONCURRENT_VOLUME_CREATION
  done
else
  docker --context colima volume inspect "$WORK" >/dev/null 2>&1 || fail BUILD_VOLUME_MISSING
  docker --context colima volume inspect "$EVIDENCE" >/dev/null 2>&1 || fail EVIDENCE_VOLUME_MISSING
  owner1="$(docker --context colima volume inspect "$WORK" --format '{{index .Labels "gng.r35.t4.owner"}}' 2>/dev/null)" || fail INVALID_BUILD_LABEL
  owner2="$(docker --context colima volume inspect "$EVIDENCE" --format '{{index .Labels "gng.r35.t4.owner"}}' 2>/dev/null)" || fail INVALID_EVIDENCE_LABEL
  [[ -n "$owner1" && "$owner1" != "<no value>" && "$owner1" == "$owner2" ]] || fail VOLUME_OWNERSHIP_MISMATCH
fi
set +e
docker --context colima run --rm --pull never --network none --platform linux/arm64 \
  --read-only --cap-drop ALL --security-opt no-new-privileges \
  --tmpfs /tmp:rw,nosuid,nodev,size=1024m \
  --tmpfs /root:rw,nosuid,nodev,size=256m \
  --mount "type=volume,src=$ORIGINAL,dst=/reference,readonly" \
  --mount "type=volume,src=$WORK,dst=/mame,volume-nocopy" \
  --mount "type=volume,src=$EVIDENCE,dst=/workspace/out,volume-nocopy" \
  --mount "type=bind,src=$ROOT/scripts,dst=/workspace/scripts,readonly" \
  --mount "type=bind,src=$ROOT/patches,dst=/workspace/patches,readonly" \
  -e GIT_OPTIONAL_LOCKS=0 \
  -e GIT_CONFIG_COUNT=1 -e GIT_CONFIG_KEY_0=safe.directory \
  -e GIT_CONFIG_VALUE_0=/mame/mame0289 \
  -w /workspace "$IMAGE" bash scripts/r35-t4-build-inner.sh "$ACTION" >/dev/null 2>&1
status=$?
set -e
if [[ "$status" -ne 0 ]]; then
  printf 'R35_T4_BUILD=BLOCKED_PRIVATE_LOG_PRESERVED exit=%s\n' "$status" >&2
  exit "$status"
fi
if [[ "$ACTION" == --prepare ]]; then
  echo R35_T4_BUILD=PREPARED_SEPARATE_SOURCE_NOT_COMPILED
else
  echo R35_T4_BUILD=PASS_INSTRUMENTED_BINARY_BUILT_NOT_CAPTURED
fi
