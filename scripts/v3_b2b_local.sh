#!/usr/bin/env bash
# B2-B: one Mac operation. Private build/replay may expand ROM-derived AOT
# ONLY under ignored out/v3/b2b; frozen V2/B2A inputs remain immutable.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
[[ $# -eq 0 ]] || { echo V3_B2B_LOCAL=BLOCKED_INVALID_ARGS; exit 2; }
[[ "$(git branch --show-current)" == main ]] ||
  { echo V3_B2B_LOCAL=BLOCKED_MAIN_REQUIRED; exit 2; }
[[ -z "$(git status --porcelain --untracked-files=no)" ]] ||
  { echo V3_B2B_LOCAL=BLOCKED_DIRTY_TREE; exit 2; }
echo V3_B2B_LOCAL_STAGE=ROM_FREE_REGRESSION
bash scripts/r3-local-regression.sh
echo V3_B2B_LOCAL_STAGE=PRIVATE_AOT_DISCOVERY
node scripts/v3_b2b_discover.mjs --discover
echo V3_B2B_LOCAL=PASS
