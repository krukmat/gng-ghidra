#!/usr/bin/env bash
# The live viewer must never start as a mock, movie or substituted engine.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
[[ $# -eq 0 ]] || { echo V3_B2C_WIRING=BLOCKED_ARGS; exit 2; }
node --check scripts/v3_b2c_engine_worker.mjs
node --check scripts/v3_b2c_live.mjs
node --check src/v3_b2c_live_controls.mjs
node --check src/v3_b2c_session_policy.mjs
node --check src/v3_b2c_port_witness.mjs
node --check tests/test_v3_b2c_port_witness.mjs
node --test tests/test_v3_b2c_port_witness.mjs
node --check tests/test_v3_b2c_session_policy.mjs
node --test tests/test_v3_b2c_session_policy.mjs
node --check tests/test_v3_b2c_live_controls.mjs
node --check src/v3_b2c_pixel_probe.mjs
node --check tests/test_v3_b2c_pixel_probe.mjs
node --check scripts/v3_b2c_probe.mjs
node --check tests/test_v3_b2c_browser_html.mjs
node --check src/v3_b2d_selection.mjs
node --check tests/test_v3_b2d_selection.mjs
node --check src/v3_b2e_selection.mjs
node --check tests/test_v3_b2e_selection.mjs
node --check src/v3_b2c_visible_gate.mjs
node --check tests/test_v3_b2c_visible_gate.mjs
node --test tests/test_v3_b2c_visible_gate.mjs
node --test tests/test_v3_b2e_selection.mjs
node --test tests/test_v3_b2d_selection.mjs
node --test tests/test_v3_b2c_browser_html.mjs
node --test tests/test_v3_b2c_pixel_probe.mjs
node --test tests/test_v3_b2c_live_controls.mjs
node --check src/v3_b3_selection.mjs
node --check src/v3_b3_tapes.mjs
node --check src/v3_b3_ondemand.mjs
node --check src/v3_b3_bundle.mjs
node --test tests/test_v3_b3_selection.mjs tests/test_v3_b3_tapes.mjs
bash scripts/r3-local-regression.sh
echo V3_B2C_WIRING=PASS_ROM_FREE
