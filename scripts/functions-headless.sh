#!/usr/bin/env bash
# Bounded Ghidra function discovery, diagnostics, and conservative P-code -> JS.
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ $# -lt 1 ]]; then
  echo 'Usage: GHIDRA_HOME=/path/to/ghidra bash scripts/functions-headless.sh roms/gng.zip [0xSEED ...]' >&2
  exit 2
fi
rom="$1"; shift
python3 src/poc.py --rom "$rom" --out out
if [[ -n "${GHIDRA_HEADLESS:-}" ]]; then
  headless="$GHIDRA_HEADLESS"
elif [[ -n "${GHIDRA_HOME:-}" ]]; then
  headless="$GHIDRA_HOME/support/analyzeHeadless"
else
  echo 'ERROR: configure GHIDRA_HOME or GHIDRA_HEADLESS' >&2
  exit 2
fi
[[ -x "$headless" ]] || { echo "ERROR: cannot execute $headless" >&2; exit 2; }
mkdir -p out/ghidra-project
# Never let output from a previous successful run mask a failed Ghidra invocation.
rm -f out/functions.raw.json out/functions.ir.json out/functions.report.json \
  out/functions-inventory.json out/functions-shortlist.json
log="$PWD/out/functions-ghidra.log"
status=0
"$headless" "$PWD/out/ghidra-project" GngFunctions \
  -import "$PWD/out/gngb-flat.bin" \
  -processor '6809:BE:16:default' \
  -loader BinaryLoader -loader-baseAddr 0x0000 \
  -noanalysis \
  -scriptPath "$PWD/ghidra_scripts" \
  -postScript ExportFunctionGraph.java "$PWD/out/functions.raw.json" "$@" \
  -deleteProject 2>&1 | tee "$log" || status=$?
if (( status != 0 )) || [[ ! -s out/functions.raw.json ]] || \
   ! grep -Eq 'GNG_FUNCTION_EXPORT=(PASS|EMPTY)' "$log"; then
  echo "GNG_FUNCTION_EXPORT=FAIL (headless_exit=$status, json_present=$([[ -s out/functions.raw.json ]] && echo yes || echo no))" >&2
  echo "Ghidra diagnostic log: $log" >&2
  grep -iE 'error|exception|script|compile|cannot|fail' "$log" | tail -35 >&2 || true
  exit 1
fi
python3 - <<'PY'
import json
from pathlib import Path
p=Path('out/functions.raw.json')
try:
    raw=json.loads(p.read_text())
except (OSError, ValueError) as exc:
    raise SystemExit(f'GNG_FUNCTION_EXPORT=FAIL invalid JSON: {exc}')
if raw.get('schema') != 'gng.ghidra-functions.v1':
    raise SystemExit('GNG_FUNCTION_EXPORT=FAIL unexpected JSON schema')
print(f'GNG_FUNCTION_EXPORT=PASS functions={len(raw.get("functions", []))} skipped={len(raw.get("skipped", []))}')
if not raw.get('functions'):
    for skip in raw.get('skipped', [])[:12]:
        print(f'FUNCTION_SKIPPED {skip}')
    raise SystemExit('GNG_FUNCTION_EXPORT=BLOCKED no functions discovered; check out/functions-ghidra.log')
PY
python3 src/function_inventory.py --input out/functions.raw.json \
  --rom-image out/gngb-flat.bin --out out/functions-inventory.json \
  --shortlist out/functions-shortlist.json
python3 src/function_ir.py --input out/functions.raw.json --out out/functions.ir.json --report out/functions.report.json

# T2.B.6/7: ROM-authenticated provenance and conservative deterministic triage.
