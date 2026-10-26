#!/usr/bin/env bash
# D6 launcher: metadata-only by default. --run alone authorizes one NEW volume.
# Never mounts D5 evidence or host out; never removes any capture volume.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
MODE=--check
CAPTURE_VOLUME=gng-a063-private-capture-arm64-full-d6-v1
# Four complete frames retain boot/VRAM/selector evidence before later sprite
# activity; every offline gate still validates the complete resulting capture.
CAPTURE_FRAMES=4
IMAGE_ID=sha256:a3bd689f9d867b51cd4a25f01b3dfd8ed0218b53f09347a714271e6cd964c255
MAME_VOLUME=gng-a063-mame0289-arm64-v1
fail(){ printf 'D6_CAPTURE_LAUNCHER=BLOCKED reason=%s\n' "$1" >&2; exit 2; }
MODE_SEEN=0
VOLUME_SEEN=0
FRAMES_SEEN=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --check|--run)
      [[ "$MODE_SEEN" == 0 ]] || fail duplicate_mode_argument
      MODE="$1"; MODE_SEEN=1; shift ;;
    --volume)
      [[ "$VOLUME_SEEN" == 0 ]] || fail duplicate_volume_argument
      [[ $# -ge 2 ]] || fail volume_argument_missing
      CAPTURE_VOLUME="$2"; VOLUME_SEEN=1; shift 2 ;;
    --frames)
      [[ "$FRAMES_SEEN" == 0 ]] || fail duplicate_frames_argument
      [[ $# -ge 2 ]] || fail frames_argument_missing
      CAPTURE_FRAMES="$2"; FRAMES_SEEN=1; shift 2 ;;
    *) fail invalid_arguments ;;
  esac
done
[[ "$CAPTURE_FRAMES" =~ ^([2-9]|[12][0-9]|30)$ ]] || fail frames_must_be_2_to_30
[[ "$CAPTURE_VOLUME" =~ ^gng-a063-private-capture-arm64-full-d6-v[1-9][0-9]*$ ]] ||
  fail full_d6_new_volume_name_required
for binary in docker git python3; do
  command -v "$binary" >/dev/null || fail required_host_tool_missing
done
task_docker(){ docker --context colima "$@"; }
[[ "$(git -C "$ROOT" rev-parse --show-toplevel)" == "$ROOT" ]] || fail checkout_root_mismatch
[[ -d "$ROOT/.git" ]] || fail normal_checkout_git_directory_required
[[ "$(git -C "$ROOT" branch --show-current)" == feature/a063-r1-forensics-contract ]] ||
  fail feature_branch_required
[[ -z "$(git -C "$ROOT" status --porcelain --untracked-files=no)" ]] ||
  fail commit_tracked_changes_before_capture
PYTHONDONTWRITEBYTECODE=1 python3 - "$ROOT" >/dev/null 2>&1 <<'PY' || fail commit_frozen_sources_before_capture
import subprocess
import sys
from pathlib import Path
root = Path(sys.argv[1])
sys.path.insert(0, str(root / 'scripts'))
from a063_trace_contract import SOURCE_FILES
subprocess.run(['git', '-C', str(root), 'ls-files', '--error-unmatch', *SOURCE_FILES],
               check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
PY
EXPECTED_HEAD="$(git -C "$ROOT" rev-parse --verify HEAD)"
[[ "$EXPECTED_HEAD" =~ ^[0-9a-f]{40}$ ]] || fail git_head_invalid
[[ -r "$ROOT/roms/gng.zip" ]] || fail local_private_rom_missing
case "${DOCKER_HOST:-}" in ''|unix://*) ;; *) fail remote_docker_host_forbidden ;; esac
ENDPOINT="$(task_docker context inspect colima --format '{{(index .Endpoints "docker").Host}}' 2>/dev/null)" ||
  fail colima_context_unavailable
case "$ENDPOINT" in unix://*) ;; *) fail local_colima_endpoint_required ;; esac
DAEMON="$(task_docker info --format '{{.OSType}} {{.Architecture}}' 2>/dev/null)" ||
  fail local_colima_daemon_unavailable
case "$DAEMON" in 'linux arm64'|'linux aarch64') ;; *) fail linux_arm64_daemon_required ;; esac
[[ "$(task_docker image inspect "$IMAGE_ID" --format '{{.Id}} {{.Architecture}} {{.Os}}' 2>/dev/null)" == "$IMAGE_ID arm64 linux" ]] ||
  fail existing_pinned_arm64_image_required
task_docker volume inspect "$MAME_VOLUME" >/dev/null 2>&1 || fail existing_mame_volume_required
if task_docker volume inspect "$CAPTURE_VOLUME" >/dev/null 2>&1; then
  fail new_volume_already_exists_preserve_evidence
fi
if [[ "$MODE" == --check ]]; then
  printf 'D6_CAPTURE_LAUNCHER=CHECK_PASS_CONFIGURATION_ONLY_NOT_CAPTURED\n'
  exit 0
fi
# An ownership nonce prevents a concurrent create of this name being reused.
# Docker leaves existing volume labels unchanged; a losing creator stops here.
NONCE="$(python3 -c 'import uuid; print(uuid.uuid4().hex)')"
task_docker volume create --label "gng.a063.d6.launch=$NONCE" "$CAPTURE_VOLUME" >/dev/null ||
  fail new_volume_create_failed
[[ "$(task_docker volume inspect "$CAPTURE_VOLUME" --format '{{index .Labels "gng.a063.d6.launch"}}' 2>/dev/null)" == "$NONCE" ]] ||
  fail concurrent_volume_creation_preserve_evidence
set +e
task_docker run --rm -i --pull never --network none \
  --platform linux/arm64 --read-only --cap-drop ALL \
  --security-opt no-new-privileges \
  --tmpfs /tmp:rw,nosuid,nodev,size=512m \
  --tmpfs /root:rw,nosuid,nodev,size=64m \
  --mount "type=bind,src=$ROOT,dst=/workspace,readonly" \
  --mount "type=bind,src=$ROOT/.git,dst=/workspace/.git,readonly" \
  --mount "type=bind,src=$ROOT/roms,dst=/workspace/roms,readonly" \
  --mount "type=volume,src=$CAPTURE_VOLUME,dst=/workspace/out,volume-nocopy" \
  --mount "type=volume,src=$MAME_VOLUME,dst=/mame,readonly" \
  --env "GNG_A063_EXPECTED_HEAD=$EXPECTED_HEAD" \
  --env "GNG_A063_FULL_FRAMES=$CAPTURE_FRAMES" \
  --env GNG_R3_MAME_BIN=/mame/mame0289/gnga063 \
  --env SDL_AUDIODRIVER=dummy \
  --env GIT_CONFIG_COUNT=1 --env GIT_CONFIG_KEY_0=safe.directory \
  --env GIT_CONFIG_VALUE_0=/workspace --env GIT_OPTIONAL_LOCKS=0 \
  --env PYTHONDONTWRITEBYTECODE=1 \
  --workdir /workspace "$IMAGE_ID" \
  bash scripts/a063-full-native-inner.sh >/dev/null 2>&1
CAPTURE_EXIT=$?
set -e
# Raw Docker/MAME/Lua output belongs only in the new volume's private log.
printf 'D6_CAPTURE_EXIT=%d\n' "$CAPTURE_EXIT"
exit "$CAPTURE_EXIT"
