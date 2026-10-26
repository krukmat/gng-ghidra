#!/usr/bin/env bash
# One-shot private Mac gate: ROM-free regression, separate V3 AOT freeze,
# strict 600-frame parity with immutable V2, and Coin1 on real GnG AOT.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
[[ $# -eq 0 ]] || { echo V3_B2A_LOCAL=BLOCKED_INVALID_ARGUMENTS; exit 2; }
[[ "$(git branch --show-current)" == main ]] ||
  { echo V3_B2A_LOCAL=BLOCKED_MAIN_REQUIRED; exit 2; }
[[ -z "$(git status --porcelain --untracked-files=no)" ]] ||
  { echo V3_B2A_LOCAL=BLOCKED_DIRTY_TREE; exit 2; }
echo 'V3_B2A_LOCAL_STAGE=ROM_FREE_REGRESSION'
bash scripts/v3_b2a_gate.sh
echo 'V3_B2A_LOCAL_STAGE=BUILD_V3_PRIVATE_AOT'
node scripts/v3_b2a_build.mjs --build
echo 'V3_B2A_LOCAL_STAGE=COIN1_REAL_INPUT'
node scripts/v3_b2a_coin_smoke.mjs --coin
echo 'V3_B2A_LOCAL=PASS'
