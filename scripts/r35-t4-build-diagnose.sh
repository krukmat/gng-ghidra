#!/usr/bin/env bash
# R3.5.B2.T4.2: classify first build failure without exposing private logs.
# Only mounts existing evidence RO. Never patches, builds, or captures MAME.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
EVIDENCE=gng-r35-t4-evidence-arm64-v1
IMAGE=sha256:a3bd689f9d867b51cd4a25f01b3dfd8ed0218b53f09347a714271e6cd964c255
fail(){ printf 'R35_T4_DIAG=BLOCKED_%s\n' "$1" >&2; exit 2; }
[[ $# -eq 0 ]] || fail INVALID_ARGUMENTS
[[ "$(git -C "$ROOT" branch --show-current 2>/dev/null)" == feature/a063-r1-forensics-contract ]] || fail FEATURE_BRANCH_REQUIRED
command -v docker >/dev/null || fail DOCKER_CLI_MISSING
case "$(printenv DOCKER_HOST 2>/dev/null || true)" in ''|unix://*) ;; *) fail REMOTE_DOCKER_FORBIDDEN ;; esac
endpoint="$(docker --context colima context inspect colima --format '{{(index .Endpoints "docker").Host}}' 2>/dev/null)" || fail COLIMA_UNAVAILABLE
[[ "$endpoint" == unix://* ]] || fail REMOTE_DOCKER_FORBIDDEN
[[ "$(docker --context colima image inspect "$IMAGE" --format '{{.Id}} {{.Architecture}} {{.Os}}' 2>/dev/null)" == "$IMAGE arm64 linux" ]] || fail IMAGE_MISSING
docker --context colima volume inspect "$EVIDENCE" >/dev/null 2>&1 || fail EVIDENCE_VOLUME_MISSING
docker --context colima run --rm --pull never --network none \
  --platform linux/arm64 --read-only --cap-drop ALL \
  --security-opt no-new-privileges \
  --tmpfs /tmp:rw,nosuid,nodev,size=32m \
  --mount "type=volume,src=$EVIDENCE,dst=/evidence,readonly" \
  --mount "type=bind,src=$ROOT/scripts,dst=/workspace/scripts,readonly" \
  -w /workspace "$IMAGE" \
  python3 scripts/r35_t4_build_diagnose.py --evidence /evidence \
  || fail REPORT_UNAVAILABLE
