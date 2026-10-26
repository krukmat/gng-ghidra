#!/usr/bin/env bash
# V2.B1.T6.3: operator Mac, read-only post-merge evidence revalidation.
set -euo pipefail
[[ $# -eq 0 ]] || { echo V2_B1_T6=BLOCKED_INVALID_ARGS; exit 2; }
[[ "$(git branch --show-current)" == main ]] ||
  { echo V2_B1_T6=BLOCKED_MAIN_REQUIRED; exit 2; }
[[ -z "$(git status --porcelain --untracked-files=no)" ]] ||
  { echo V2_B1_T6=BLOCKED_DIRTY_MAIN; exit 2; }
[[ -f out/v2/b1/certification.json ]] ||
  { echo V2_B1_T6=BLOCKED_PRIVATE_CERT_MISSING; exit 2; }
SOURCE_HEAD="$(node -p "JSON.parse(require('fs').readFileSync('out/v2/b1/certification.json','utf8')).source_git_head")"
[[ "$SOURCE_HEAD" =~ ^[[:xdigit:]]{40}$ ]] ||
  { echo V2_B1_T6=BLOCKED_SOURCE_COMMIT_INVALID; exit 2; }
git merge-base --is-ancestor "$SOURCE_HEAD" HEAD ||
  { echo V2_B1_T6=BLOCKED_SOURCE_COMMIT_NOT_ANCESTOR; exit 2; }
git diff --quiet "$SOURCE_HEAD" HEAD -- \
  src/mc6809_aot.mjs src/mc6809_aot_lib.mjs \
  src/gngb_runtime.mjs src/gngb_block_key.mjs \
  src/v2_b1_frozen.mjs src/v2_b1_observable.mjs \
  scripts/v2_b1_freeze.mjs src/gngb_frame_renderer.mjs \
  src/video_memory.mjs src/sprite_memory.mjs ||
  { echo V2_B1_T6=BLOCKED_FROZEN_CORE_DRIFT; exit 2; }
bash scripts/r3-local-regression.sh
node scripts/v2_b1_run_frozen.mjs --verify
node scripts/v2_b1_native_gate.mjs --verify
echo V2_FEATURE_MERGED_MAIN=PASS_POSTMERGE
