#!/usr/bin/env bash
# V3.B3: first playable route (Coin -> Start -> Arthur) as a new frozen AOT
# child of certified B2-D. Never overwrites B2-D/B2-E; ROM stays local.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
[[ $# -eq 0 ]] || { echo V3_B3_LOCAL=BLOCKED_ARGS; exit 2; }
[[ "$(git branch --show-current)" == main ]] ||
  { echo V3_B3_LOCAL=BLOCKED_MAIN_REQUIRED; exit 2; }
[[ -z "$(git status --porcelain --untracked-files=no)" ]] ||
  { echo V3_B3_LOCAL=BLOCKED_DIRTY_TREE; exit 2; }
echo V3_B3_LOCAL_STAGE=ROM_FREE_GATE
bash scripts/v3_b2c_gate.sh
echo V3_B3_LOCAL_STAGE=REAL_OFFLINE_AOT
if [[ -d out/v3/b3/frozen ]]; then
  echo V3_B3_LOCAL_MODE=ALREADY_FROZEN
else
  node scripts/v3_b3_discover.mjs
fi
echo V3_B3_LOCAL_STAGE=VISUAL_WITNESS
node scripts/v3_b3_witness.mjs arthurControls 580,660,1240,1300,1308,1336,1360,1400,1440,1462,1700,2200
echo V3_B3_LOCAL=PASS
