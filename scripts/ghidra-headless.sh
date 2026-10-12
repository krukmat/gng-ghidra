#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
command -v python3 >/dev/null || { echo 'ERROR: python3 not found' >&2; exit 2; }
if [[ $# -lt 1 ]]; then
  echo 'Usage: GHIDRA_HOME=/path/to/ghidra ./scripts/ghidra-headless.sh /path/to/gng.zip' >&2
  exit 2
fi
python3 src/poc.py --rom "$1" --out out
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
"$headless" "$PWD/out/ghidra-project" GngPoc \
  -import "$PWD/out/gngb-flat.bin" \
  -processor '6809:BE:16:default' \
  -loader BinaryLoader -loader-baseAddr 0x0000 \
  -noanalysis \
  -scriptPath "$PWD/ghidra_scripts" \
  -postScript ExportResetPcode.java "$PWD/out/reset-pcode.json" \
  -deleteProject
python3 src/verify_ghidra.py --lir out/reset-loop.lir.json --pcode out/reset-pcode.json
