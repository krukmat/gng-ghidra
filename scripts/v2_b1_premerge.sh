#!/usr/bin/env bash
# V2.B1.T6.1: read-only premerge safety check; NEVER moves main.
set -euo pipefail
[[ $# -eq 0 ]] || { echo V2_B1_T6=BLOCKED_INVALID_ARGS; exit 2; }
[[ "$(git branch --show-current)" == feature/a063-r1-forensics-contract ]] ||
 { echo V2_B1_T6=BLOCKED_WRONG_BRANCH; exit 2; }
[[ -z "$(git status --porcelain --untracked-files=no)" ]] ||
 { echo V2_B1_T6=BLOCKED_DIRTY_TREE; exit 2; }
[[ -f out/v2/b1/certification.json ]] ||
 { echo V2_B1_T6=BLOCKED_V2_CERT_MISSING; exit 2; }
node - <<'NODE' || { echo V2_B1_T6=BLOCKED_V2_CERT_INVALID; exit 2; }
const {readFileSync}=require('node:fs');
const r=JSON.parse(readFileSync('out/v2/b1/certification.json','utf8'));
if(r.schema!=='gng.v2.b1-certification.v1'||
   r.status!=='V2_AUTONOMOUS_FRAME_CERTIFIED'||
   r.frames!==600||r.state_exact_frames<594||r.pixel_exact_frames<594||
   typeof r.source_git_head!=='string'||!/^[0-9a-f]{40}$/.test(r.source_git_head))
  process.exit(2);
NODE
SOURCE_HEAD="$(node -p "JSON.parse(require('fs').readFileSync('out/v2/b1/certification.json','utf8')).source_git_head")"
git cat-file -e "${SOURCE_HEAD}^{commit}" 2>/dev/null ||
 { echo V2_B1_T6=BLOCKED_SOURCE_COMMIT_NOT_FOUND; exit 2; }
git merge-base --is-ancestor "$SOURCE_HEAD" HEAD ||
 { echo V2_B1_T6=BLOCKED_FROZEN_SOURCE_NOT_ANCESTOR; exit 2; }
# Diagnostics and gate scripts may evolve without changing the already-frozen
# runtime; forbid any executable-core drift since the recorded source commit.
git diff --quiet "$SOURCE_HEAD" HEAD -- \
  src/mc6809_aot.mjs src/mc6809_aot_lib.mjs \
  src/gngb_runtime.mjs src/gngb_block_key.mjs \
  src/v2_b1_frozen.mjs src/v2_b1_observable.mjs \
  scripts/v2_b1_freeze.mjs src/gngb_frame_renderer.mjs \
  src/video_memory.mjs src/sprite_memory.mjs ||
 { echo V2_B1_T6=BLOCKED_FROZEN_CORE_DRIFT; exit 2; }
git show-ref --verify --quiet refs/heads/main ||
 { echo V2_B1_T6=BLOCKED_LOCAL_MAIN_MISSING; exit 2; }
git merge-base --is-ancestor main HEAD ||
 { echo V2_B1_T6=BLOCKED_MAIN_NOT_ANCESTOR; exit 2; }
# Never trust the local main revision until freshly fetched by the operator.
python3 - <<'PY' || { echo V2_B1_T6=BLOCKED_PRIVATE_FILE_IN_MERGE; exit 2; }
import subprocess,re
changed=subprocess.check_output(
    ['git','diff','--name-only','-z','main...HEAD']).decode().split('\0')
for p in changed:
    if not p:
        continue
    if p.startswith(('out/','roms/','out-synthetic/')) or re.search(
        r'(?i)(?:\.zip|\.bin|\.rom|\.png|\.jpg|\.log|\.trace|\.gpr)$',p):
        raise SystemExit(2)
PY
echo V2_B1_T6=PREFLIGHT_PASS_NOT_MERGED_MAIN_UNTOUCHED
