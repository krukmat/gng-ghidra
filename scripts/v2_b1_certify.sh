#!/usr/bin/env bash
# V2.B1.T5: all gates before any merge; never runs MAME.
set -euo pipefail
[[ $# -eq 0 ]] || { echo V2_B1_T5=BLOCKED_INVALID_ARGUMENTS; exit 2; }
[[ "$(git branch --show-current)" == feature/a063-r1-forensics-contract ]] ||
  { echo V2_B1_T5=BLOCKED_FEATURE_BRANCH_REQUIRED; exit 2; }
bash scripts/r3-local-regression.sh
node --test tests/test_r35_t5_aot_runtime.mjs tests/test_r35_t5_render_check.mjs \
  tests/test_v2_b1_block_identity.mjs tests/test_v2_b1_frozen.mjs \
  tests/test_v2_b1_observable.mjs tests/test_v2_b1_irq_negative.mjs \
  tests/test_v2_b1_gate_lib.mjs tests/test_v2_b1_event_compare.mjs
node scripts/v2_b1_run_frozen.mjs --verify
node scripts/v2_b1_native_gate.mjs --gate
