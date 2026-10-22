#!/usr/bin/env bash
# One entrypoint for ROM-backed static-JS vs genuine MAME prestate comparison.
# Keeps all ROM-derived images, generated code and traces in private out/.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
command -v python3 >/dev/null || { echo "GNG_R3=BLOCKED python3_missing" >&2; exit 2; }
command -v node >/dev/null || { echo "GNG_R3=BLOCKED node_missing" >&2; exit 2; }

# Reuse the EXISTING verified zip reader, not a new hand-built image layout.
python3 scripts/prepare_r3_flat_rom.py \
  --rom roms/gng.zip --out out/gngb-flat.bin
[[ -f out/r2/mame-probe/pre-instruction.jsonl ]] || {
  echo "GNG_R3=BLOCKED missing_private_mame_prestates" >&2
  exit 2
}
node scripts/r3_static_trace_probe.mjs \
  --rom out/gngb-flat.bin \
  --trace out/r2/mame-probe/pre-instruction.jsonl \
  --out out/r3/static-mame-prestate
