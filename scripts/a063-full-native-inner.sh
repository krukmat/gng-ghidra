#!/usr/bin/env bash
# Invoked only by the D6 new-volume Docker launcher. No native offline gates.
set -euo pipefail
umask 077
exec 3>&1
fail(){ printf 'D6_CAPTURE=BLOCKED reason=%s\n' "$1" >&3; exit 2; }
trap 'task_rc=$?; printf "D6_CAPTURE_INNER_EXIT=%d\n" "$task_rc" >&3' EXIT
[[ "$PWD" == /workspace && -d /workspace/.git ]] || fail readonly_checkout_required
[[ "${GNG_A063_EXPECTED_HEAD:-}" =~ ^[0-9a-f]{40}$ ]] || fail expected_head_required
[[ "${GNG_R3_MAME_BIN:-}" == /mame/mame0289/gnga063 ]] || fail exact_mame_path_required
[[ "${SDL_AUDIODRIVER:-}" == dummy ]] || fail dummy_audio_required
[[ -d /workspace/out ]] || fail new_private_out_required
# Preserve even a partial prior attempt. No log truncation or old artifact removal.
for artifact in /workspace/out/* /workspace/out/.[!.]* /workspace/out/..?*; do
  [[ ! -e "$artifact" && ! -L "$artifact" ]] || fail capture_volume_not_empty
done
mkdir /workspace/out/private-runner
exec >/workspace/out/private-runner/capture.log 2>&1
[[ "$(git branch --show-current)" == feature/a063-r1-forensics-contract ]] || fail feature_branch_required
[[ "$(git rev-parse --verify HEAD)" == "$GNG_A063_EXPECTED_HEAD" ]] || fail frozen_head_changed
[[ -z "$(git status --porcelain --untracked-files=no)" ]] || fail frozen_sources_not_clean
python3 - <<'PY'
import subprocess
import sys
sys.path.insert(0, 'scripts')
from a063_trace_contract import SOURCE_FILES
subprocess.run(['git', 'ls-files', '--error-unmatch', *SOURCE_FILES],
               check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
PY
verify_binary(){
  python3 - <<'PY'
import hashlib
from pathlib import Path
binary = Path('/mame/mame0289/gnga063')
expected = '80c447cd81fa91be8bf3159e22dedab157798a4f1a189e6680849179b0ac282d'
with binary.open('rb') as stream:
    if hashlib.file_digest(stream, 'sha256').hexdigest() != expected:
        raise SystemExit('D6_CAPTURE=BLOCKED existing_mame_sha_mismatch')
PY
}
verify_binary || fail existing_mame_sha_mismatch
export GNG_R2_PROBE_FRAMES=30 GNG_R2_PROBE_SOFT_RESET=1
export GNG_R2_PROBE_SPRITE_RAM=1 GNG_A04_VIDEO_WRITE_TAP=1
export GNG_R36_CAPTURE_UNMAP_POLICY=1 GNG_R2_TRACE_MODE=printf
set +e
timeout --signal=TERM --kill-after=10s 180s \
  xvfb-run -a -e /workspace/out/private-runner/xvfb.log \
  bash scripts/r3-bank-provenance-capture.sh --full-oracle --capture-only
CAPTURE_EXIT=$?
set -e
verify_binary || fail existing_mame_sha_changed
[[ "$(git rev-parse --verify HEAD)" == "$GNG_A063_EXPECTED_HEAD" ]] || fail frozen_head_changed
[[ -z "$(git status --porcelain --untracked-files=no)" ]] || fail frozen_sources_not_clean
printf 'D6_CAPTURE_ONLY_EXIT=%d\n' "$CAPTURE_EXIT"
exit "$CAPTURE_EXIT"
