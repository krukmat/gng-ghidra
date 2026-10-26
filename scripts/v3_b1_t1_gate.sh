#!/usr/bin/env bash
# V3.B1.T1: ROM-free contract + inherited V2 regression; no MAME or ROM.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
[[ $# -eq 0 ]] || { echo V3_B1_T1=BLOCKED_INVALID_ARGS; exit 2; }
node --check src/gngb_input_contract.mjs
node --check tests/test_v3_b1_input_contract.mjs
bash scripts/r3-local-regression.sh
echo V3_B1_T1_INPUT_CONTRACT_PASS
