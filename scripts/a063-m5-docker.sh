#!/usr/bin/env bash
# Local Mac M5-only R2.E D0-D2. Zero cloud compute, no ROM/trace access.
# Usage: bash scripts/a063-m5-docker.sh check|prepare|status
set -euo pipefail
umask 077

ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
BRANCH="feature/a063-r1-forensics-contract"
IMAGE="gng-a063-m5:local"
MAME_VOL="gng-a063-mame0289-arm64-v1"
EVID_VOL="gng-a063-evidence-arm64-v1"
REPORT="docs/audit/a063-m5-d0-d2-status.md"

fail() { printf 'A063_M5_HOST=BLOCKED reason=%s\n' "$1" >&2; exit 2; }

[[ $# -eq 1 ]] || fail expected_single_check_prepare_or_status
ACTION="$1"
case "$ACTION" in check|prepare|status) ;; *) fail unknown_action ;; esac

[[ "$(uname -s)" == Darwin && "$(uname -m)" == arm64 ]] ||
  fail macos_arm64_host_required
command -v git >/dev/null || fail git_missing
command -v docker >/dev/null || {
  echo "A063_M5_NEXT=install_free_docker_cli_and_colima_or_start_existing_docker_desktop" >&2
  fail docker_cli_missing
}
[[ "$(git -C "$ROOT" branch --show-current)" == "$BRANCH" ]] ||
  fail isolated_feature_branch_required
[[ "$(git -C "$ROOT" remote get-url origin)" =~ github.com[:/]krukmat/gng-ghidra(\.git)?$ ]] ||
  fail unexpected_git_remote

case "$(printenv DOCKER_HOST 2>/dev/null || true)" in
  ""|unix://*) ;;
  *) fail remote_docker_host_forbidden ;;
esac
CONTEXT="$(docker context show 2>/dev/null)" ||
  fail docker_context_unavailable
ENDPOINT="$(docker context inspect "$CONTEXT" --format '{{(index .Endpoints "docker").Host}}' 2>/dev/null)" ||
  fail docker_endpoint_unavailable
case "$ENDPOINT" in unix://*) ;; *) fail remote_or_unrecognized_docker_endpoint ;; esac

if ! docker info >/dev/null 2>&1; then
  echo "A063_M5_NEXT=if_colima_installed_run_colima_start_--vm-type_vz_--arch_aarch64_--cpus_6_--memory_16_--disk_80" >&2
  fail local_docker_daemon_not_running
fi
[[ "$(docker info --format '{{.OSType}}')" == linux ]] ||
  fail docker_daemon_must_be_linux
case "$(docker info --format '{{.Architecture}}')" in
  aarch64|arm64) ;;
  *) fail docker_daemon_architecture_must_be_arm64 ;;
esac

printf 'A063_M5_D0=PASS_LOCAL_MAC_DOCKER_ARM64 context=%s\n' "$CONTEXT"

if [[ "$ACTION" == check ]]; then
  printf 'A063_M5_NEXT=bash scripts/a063-m5-docker.sh prepare\n'
  exit 0
fi

run_guest() {
  docker run --rm --platform linux/arm64 \
    --mount "type=volume,src=$MAME_VOL,dst=/mame" \
    --mount "type=volume,src=$EVID_VOL,dst=/evidence" \
    --mount "type=bind,src=$ROOT/scripts,dst=/workspace/scripts,readonly" \
    --mount "type=bind,src=$ROOT/patches,dst=/workspace/patches,readonly" \
    "$IMAGE" bash /workspace/scripts/a063-m5-docker-inner.sh "$1"
}

if [[ "$ACTION" == status ]]; then
  docker image inspect "$IMAGE" >/dev/null 2>&1 ||
    fail image_not_prepared
  docker volume inspect "$MAME_VOL" >/dev/null 2>&1 ||
    fail persistent_mame_volume_missing
  docker volume inspect "$EVID_VOL" >/dev/null 2>&1 ||
    fail persistent_evidence_volume_missing
  run_guest status
  exit 0
fi

# Fail before expensive local Docker setup if git is not safe for one-file push.
[[ -z "$(git -C "$ROOT" status --porcelain --untracked-files=no)" ]] ||
  fail existing_tracked_changes
[[ -z "$(git -C "$ROOT" diff --cached --name-only)" ]] ||
  fail existing_staged_changes
git -C "$ROOT" pull --ff-only origin "$BRANCH" ||
  fail git_pull_failed

# This is intentionally local-only: refuse Buildx cloud/remote drivers.
command -v docker >/dev/null || fail docker_unavailable
docker buildx inspect default >/dev/null 2>&1 || {
  echo "A063_M5_NEXT=install_free_docker_buildx_plugin_for_local_builder" >&2
  fail local_buildx_unavailable
}
docker buildx inspect default | grep -Eq '^Driver:[[:space:]]+docker[[:space:]]*$' ||
  fail nonlocal_buildx_driver_forbidden

docker buildx build --builder default --load --platform linux/arm64 \
  -t "$IMAGE" -f "$ROOT/docker/a063-m5/Dockerfile" \
  "$ROOT/docker/a063-m5" || fail local_image_build_failed

[[ "$(docker image inspect "$IMAGE" --format '{{.Architecture}}')" == arm64 ]] ||
  fail built_image_not_arm64
docker volume create "$MAME_VOL" >/dev/null ||
  fail persistent_mame_volume_create_failed
docker volume create "$EVID_VOL" >/dev/null ||
  fail persistent_evidence_volume_create_failed

run_guest prepare || fail guest_mame_prepare_failed

cd "$ROOT"
mkdir -p docs/audit
cat > "$REPORT" <<'MARKDOWN'
# A063 M5.D0–D2 — Docker ARM64 local

- status=PREPARED_NOT_COMPILED
- host=macOS/arm64
- guest=linux/arm64
- build_image=gng-a063-m5:local
- mame_version=mame0289
- mame_upstream_commit=f34f02505e32c1993c6a782b6814232cbfc74e36
- patch=VERIFIED_EXACT_APPLIED
- cache=LOCAL_PERSISTENT_DOCKER_VOLUME
- private_rom=NOT_ACCESSED
- native_validation=NOT_PERFORMED
- a063_certified=NO

This records only a ROM-free preparation checkpoint, not an emulator build.
MARKDOWN

[[ -z "$(git diff --cached --name-only)" ]] ||
  fail unexpected_preexisting_staged_changes
git add -- "$REPORT" || fail report_stage_failed
[[ "$(git diff --cached --name-only)" == "$REPORT" ]] ||
  fail unexpected_staged_content
git diff --cached --check || fail report_check_failed
if ! git diff --cached --quiet; then
  git commit -m "docs(a063-m5): publish redacted local ARM64 prepare checkpoint" \
    -- "$REPORT" >/dev/null || fail safe_report_commit_failed
fi
git push origin "HEAD:refs/heads/$BRANCH" >/dev/null ||
  fail safe_report_push_failed
printf 'A063_M5_D0_D2=PASS_PREPARED_NOT_COMPILED_REPORT_PUSHED\n'
printf 'A063_M5_NEXT=wait_for_D3_build_gate_before_running_compilation\n'
