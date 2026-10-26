#!/usr/bin/env bash
# R3.5.B2.T4.3 launcher: ONE cold-boot capture with the T4.2 v2 binary,
# native IRQ/SYNC events plus a per-frame memory/video reference in the same
# run. --check (default) creates nothing. --run additionally requires
# GNG_R35_NATIVE_T4_APPROVED=EXPLICIT_OPERATOR_B2_T4 and creates exactly one
# NEW private volume; it never mounts host out/ or removes any volume.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
MODE=--check
FRAMES=600
CAPTURE_VOLUME=gng-r35-t43-capture-arm64-v1
WORK=gng-r35-t4-mame-arm64-v2
EVIDENCE=gng-r35-t4-evidence-arm64-v2
IMAGE=sha256:a3bd689f9d867b51cd4a25f01b3dfd8ed0218b53f09347a714271e6cd964c255
fail(){ printf 'R35_T43_CAPTURE=BLOCKED_%s\n' "$1" >&2; exit 2; }
MODE_SEEN=0
FRAMES_SEEN=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --check|--run)
      [[ "$MODE_SEEN" == 0 ]] || fail DUPLICATE_MODE
      MODE="$1"; MODE_SEEN=1; shift ;;
    --frames)
      [[ "$FRAMES_SEEN" == 0 && $# -ge 2 ]] || fail INVALID_FRAMES_ARGUMENT
      FRAMES="$2"; FRAMES_SEEN=1; shift 2 ;;
    *) fail INVALID_ARGUMENTS ;;
  esac
done
[[ "$FRAMES" =~ ^[1-9][0-9]{0,3}$ ]] && (( FRAMES >= 2 && FRAMES <= 3600 )) || fail FRAMES_MUST_BE_2_TO_3600
task_docker(){ docker --context colima "$@"; }
for binary in docker git python3; do
  command -v "$binary" >/dev/null || fail REQUIRED_HOST_TOOL_MISSING
done
[[ "$(git -C "$ROOT" rev-parse --show-toplevel)" == "$ROOT" && -d "$ROOT/.git" ]] || fail NORMAL_CHECKOUT_REQUIRED
[[ "$(git -C "$ROOT" branch --show-current)" == feature/a063-r1-forensics-contract ]] || fail FEATURE_BRANCH_REQUIRED
# The scripts that run are the committed ones: HEAD is frozen into the run.
[[ -z "$(git -C "$ROOT" status --porcelain --untracked-files=no)" ]] || fail COMMIT_TRACKED_CHANGES_BEFORE_CAPTURE
for script in scripts/r35-t43-capture-inner.sh scripts/r35-t43-frames.lua \
    scripts/r35_t43_summary.mjs scripts/r3_native_irq_report.mjs; do
  git -C "$ROOT" ls-files --error-unmatch "$script" >/dev/null 2>&1 || fail COMMIT_CAPTURE_SCRIPTS_BEFORE_CAPTURE
done
EXPECTED_HEAD="$(git -C "$ROOT" rev-parse --verify HEAD)"
[[ -r "$ROOT/roms/gng.zip" ]] || fail LOCAL_PRIVATE_ROM_MISSING
case "$(printenv DOCKER_HOST 2>/dev/null || true)" in ''|unix://*) ;; *) fail REMOTE_DOCKER_FORBIDDEN ;; esac
endpoint="$(task_docker context inspect colima --format '{{(index .Endpoints "docker").Host}}' 2>/dev/null)" || fail COLIMA_CONTEXT_MISSING
[[ "$endpoint" == unix://* ]] || fail REMOTE_DOCKER_FORBIDDEN
[[ "$(task_docker image inspect "$IMAGE" --format '{{.Id}} {{.Architecture}} {{.Os}}' 2>/dev/null)" == "$IMAGE arm64 linux" ]] || fail PINNED_IMAGE_MISSING
task_docker volume inspect "$WORK" >/dev/null 2>&1 || fail T42_V2_WORK_VOLUME_MISSING
task_docker volume inspect "$EVIDENCE" >/dev/null 2>&1 || fail T42_V2_EVIDENCE_VOLUME_MISSING
if task_docker volume inspect "$CAPTURE_VOLUME" >/dev/null 2>&1; then
  fail CAPTURE_VOLUME_EXISTS_PRESERVE_EVIDENCE
fi
if [[ "$MODE" == --check ]]; then
  printf 'R35_T43_CAPTURE=CHECK_PASS_NOT_CAPTURED frames=%d\n' "$FRAMES"
  exit 0
fi
[[ "${GNG_R35_NATIVE_T4_APPROVED:-}" == EXPLICIT_OPERATOR_B2_T4 ]] || fail T4_OPERATOR_AUTHORIZATION_REQUIRED
# An ownership nonce stops a concurrent creator of the same name reusing it.
NONCE="$(python3 -c 'import uuid; print(uuid.uuid4().hex)')"
task_docker volume create --label "gng.r35.t43.launch=$NONCE" "$CAPTURE_VOLUME" >/dev/null || fail CAPTURE_VOLUME_CREATE_FAILED
[[ "$(task_docker volume inspect "$CAPTURE_VOLUME" --format '{{index .Labels "gng.r35.t43.launch"}}' 2>/dev/null)" == "$NONCE" ]] ||
  fail CONCURRENT_VOLUME_CREATION
set +e
# Only fixed R35_T43_* lines from the inner script reach the terminal.
task_docker run --rm --pull never --network none --platform linux/arm64 \
  --read-only --cap-drop ALL --security-opt no-new-privileges \
  --tmpfs /tmp:rw,nosuid,nodev,size=512m \
  --tmpfs /root:rw,nosuid,nodev,size=64m \
  --mount "type=bind,src=$ROOT,dst=/workspace,readonly" \
  --mount "type=bind,src=$ROOT/.git,dst=/workspace/.git,readonly" \
  --mount "type=bind,src=$ROOT/roms,dst=/workspace/roms,readonly" \
  --mount "type=volume,src=$CAPTURE_VOLUME,dst=/workspace/out,volume-nocopy" \
  --mount "type=volume,src=$WORK,dst=/mame,readonly" \
  --mount "type=volume,src=$EVIDENCE,dst=/t4evidence,readonly" \
  --env "GNG_T43_EXPECTED_HEAD=$EXPECTED_HEAD" \
  --env "GNG_T43_FRAMES=$FRAMES" \
  --env SDL_AUDIODRIVER=dummy \
  --env GIT_CONFIG_COUNT=1 --env GIT_CONFIG_KEY_0=safe.directory \
  --env GIT_CONFIG_VALUE_0=/workspace --env GIT_OPTIONAL_LOCKS=0 \
  --env PYTHONDONTWRITEBYTECODE=1 \
  --workdir /workspace "$IMAGE" \
  bash scripts/r35-t43-capture-inner.sh 2>/dev/null |
  grep -E '^R35_T43_[A-Z0-9_]+=[A-Za-z0-9_]+$'
CAPTURE_EXIT=${PIPESTATUS[0]}
set -e
printf 'R35_T43_CAPTURE_EXIT=%d\n' "$CAPTURE_EXIT"
exit "$CAPTURE_EXIT"
