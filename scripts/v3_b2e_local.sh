#!/usr/bin/env bash
# B2E expands only real idle AOT path. Existing V2/B2B/B2D frozen bundles
# remain read-only. A failed checkpoint stays in the private ignored out dir.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
[[ $# -eq 0 ]] || { echo V3_B2E_LOCAL=BLOCKED_ARGS; exit 2; }
[[ "$(git branch --show-current)" == main ]] ||
  { echo V3_B2E_LOCAL=BLOCKED_MAIN_REQUIRED; exit 2; }
[[ -z "$(git status --porcelain --untracked-files=no)" ]] ||
  { echo V3_B2E_LOCAL=BLOCKED_DIRTY_TREE; exit 2; }
echo V3_B2E_LOCAL_STAGE=ROM_FREE_GATE
node --check scripts/v3_b2e_discover.mjs
node --check src/v3_b2e_selection.mjs
node --test tests/test_v3_b2e_selection.mjs
bash scripts/r3-local-regression.sh
echo V3_B2E_LOCAL_STAGE=PRIVATE_IDLE_AOT_EXPANSION
if [[ -d out/v3/b2e/frozen ]]; then
  echo V3_B2E_LOCAL_MODE=VERIFY_ALREADY_FROZEN
  node --input-type=module -e '
    import {readFileSync} from "node:fs";
    import {loadFrozen} from "./src/v2_b1_frozen.mjs";
    import {b2eCertified} from "./src/v3_b2e_selection.mjs";
    const parent=loadFrozen("out/v3/b2d/frozen").manifest;
    const manifest=loadFrozen("out/v3/b2e/frozen").manifest;
    const report=JSON.parse(readFileSync("out/v3/b2e/discovery-report.json","utf8"));
    if(!b2eCertified(report,manifest,parent))throw Error("B2E_CERT_INVALID");
    console.log("V3_B2E_DISCOVERY=PASS_PREVIOUS_PRIVATE_AOT_CERTIFICATE");
  '
elif [[ -f out/v3/b2e/discovery-report.json ]]; then
  echo V3_B2E_LOCAL_MODE=RESUME_EXACT_CHECKPOINT
  node scripts/v3_b2e_discover.mjs --resume
else
  echo V3_B2E_LOCAL_MODE=FRESH_EXACT_B2D_PARENT
  node scripts/v3_b2e_discover.mjs --discover
fi
echo V3_B2E_LOCAL=PASS
