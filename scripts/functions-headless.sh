#!/usr/bin/env bash
# Run Ghidra function discovery and type-preserving, conservative IR normalization.
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
"$headless" "$PWD/out/ghidra-project" GngFunctions \
  -import "$PWD/out/gngb-flat.bin" \
  -processor '6809:BE:16:default' \
  -loader BinaryLoader -loader-baseAddr 0x0000 \
  -noanalysis \
  -scriptPath "$PWD/ghidra_scripts" \
  -postScript ExportFunctionGraph.java "$PWD/out/functions.raw.json" "$@" \
  -deleteProject
python3 src/function_ir.py --input out/functions.raw.json --out out/functions.ir.json --report out/functions.report.json