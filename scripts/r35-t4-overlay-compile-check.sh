#!/usr/bin/env bash
# R3.5.B2.T4.2 gate: ROM-free compile of the IRQ/SYNC overlay before any
# isolated build volume is created. Mounts only the protected MAME source RO
# and writes only to tmpfs: no ROM, capture, private log or evidence volume.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
MAME_VOL=gng-a063-mame0289-arm64-v1
IMAGE=sha256:a3bd689f9d867b51cd4a25f01b3dfd8ed0218b53f09347a714271e6cd964c255
fail(){ printf 'R35_T4_OVERLAY_COMPILE=BLOCKED_%s\n' "$1" >&2; exit 2; }
[[ $# -eq 0 ]] || fail INVALID_ARGUMENTS
[[ "$(git -C "$ROOT" branch --show-current 2>/dev/null)" == feature/a063-r1-forensics-contract ]] || fail FEATURE_BRANCH_REQUIRED
command -v docker >/dev/null || fail DOCKER_CLI_MISSING
case "$(printenv DOCKER_HOST 2>/dev/null || true)" in ''|unix://*) ;; *) fail REMOTE_DOCKER_FORBIDDEN ;; esac
endpoint="$(docker --context colima context inspect colima --format '{{(index .Endpoints "docker").Host}}' 2>/dev/null)" || fail COLIMA_CONTEXT_MISSING
[[ "$endpoint" == unix://* ]] || fail REMOTE_DOCKER_FORBIDDEN
[[ "$(docker --context colima image inspect "$IMAGE" --format '{{.Id}} {{.Architecture}} {{.Os}}' 2>/dev/null)" == "$IMAGE arm64 linux" ]] || fail PINNED_IMAGE_MISSING
docker --context colima volume inspect "$MAME_VOL" >/dev/null 2>&1 || fail PROTECTED_SOURCE_MISSING
docker --context colima run --rm --pull never --network none --platform linux/arm64 \
  --read-only --cap-drop ALL --security-opt no-new-privileges \
  --tmpfs /tmp:rw,nosuid,nodev,size=768m \
  --tmpfs /workspace/out:rw,nosuid,nodev,size=16m \
  --mount "type=volume,src=$MAME_VOL,dst=/reference,readonly" \
  --mount "type=bind,src=$ROOT/scripts,dst=/workspace/scripts,readonly" \
  -e GIT_OPTIONAL_LOCKS=0 \
  -e GIT_CONFIG_COUNT=1 -e GIT_CONFIG_KEY_0=safe.directory \
  -e GIT_CONFIG_VALUE_0=/reference/mame0289 \
  -w /workspace "$IMAGE" bash scripts/r35-t4-overlay-compile-check-inner.sh \
  || { rc=$?; [[ $rc -eq 2 ]] || fail CONTAINER_OR_HARNESS_ABORTED; exit 2; }
