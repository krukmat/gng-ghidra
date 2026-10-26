#!/usr/bin/env bash
# Pure-ROM-free gate for V3.B2A. Does not read MAME, ROM or private out/.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
[[ $# -eq 0 ]] || { echo V3_B2A=BLOCKED_INVALID_ARGUMENTS; exit 2; }
node --check src/mc6809_aot.mjs
node --check src/gngb_runtime.mjs
node --check tests/test_v3_b2a_cpu_ports.mjs
node --check scripts/v3_b2a_build.mjs
node --check scripts/v3_b2a_coin_smoke.mjs
bash scripts/r3-local-regression.sh
echo V3_B2A_WIRING=PASS_ROM_FREE_AOT_CYCLE_ACCURATE
