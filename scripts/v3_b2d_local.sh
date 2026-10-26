#!/usr/bin/env bash
# V3.B2D: build offline from proven 663-block B2B. Never overwrites V2/B2A/B2B.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
[[ $# -eq 0 ]] || { echo V3_B2D_LOCAL=BLOCKED_ARGS; exit 2; }
[[ "$(git branch --show-current)" == main ]] ||
  { echo V3_B2D_LOCAL=BLOCKED_MAIN_REQUIRED; exit 2; }
[[ -z "$(git status --porcelain --untracked-files=no)" ]] ||
  { echo V3_B2D_LOCAL=BLOCKED_DIRTY_TREE; exit 2; }
echo V3_B2D_LOCAL_STAGE=ROM_FREE_GATE
node --check src/v3_b2d_tapes.mjs
node --check src/v3_b2d_selection.mjs
node --check src/v3_b2d_pass_cache.mjs
node --check scripts/v3_b2d_discover.mjs
node --test tests/test_v3_b2d_tapes.mjs tests/test_v3_b2d_selection.mjs tests/test_v3_b2d_pass_cache.mjs
bash scripts/r3-local-regression.sh
echo V3_B2D_LOCAL_STAGE=REAL_OFFLINE_AOT_COVERAGE
if [[ -f out/v3/b2d/discovery-report.json ]]; then
  echo V3_B2D_LOCAL_MODE=RESUME_CHECKPOINT
  node scripts/v3_b2d_discover.mjs --resume
else
  echo V3_B2D_LOCAL_MODE=FRESH
  node scripts/v3_b2d_discover.mjs --discover
fi
echo V3_B2D_LOCAL=PASS
