#!/usr/bin/env bash
# One isolated MAME laboratory rerun that captures real sprite-RAM write bytes.
# Preserves existing private R2 evidence before the probe clears its output.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
command -v python3 >/dev/null || { echo "GNG_R3_SPRITE_NATIVE=BLOCKED python_missing" >&2; exit 2; }
command -v node >/dev/null || { echo "GNG_R3_SPRITE_NATIVE=BLOCKED node_missing" >&2; exit 2; }
mkdir -p out/r3
if [[ -d out/r2/mame-probe ]]; then
  BACKUP="$(mktemp -d "$ROOT/out/r3/probe-before-sprite.XXXXXXXX")"
  cp -R out/r2/mame-probe/. "$BACKUP/"
  echo "GNG_R3_PREVIOUS_PROBE_PRESERVED=$BACKUP"
fi
# A separate process with one deliberate soft reset creates two boot epochs.
# Sprite write tap captures raw 8-bit writes; the probe remains a partial
# instrument and is never promoted to exhaustive instruction bus tracing.
GNG_R2_PROBE_SPRITE_RAM=1 GNG_R2_PROBE_SOFT_RESET=1 \
  bash scripts/r2-mame-probe.sh
python3 scripts/prepare_r3_flat_rom.py \
  --rom roms/gng.zip --out out/gngb-flat.bin
node scripts/r3_compare_sprite_writes.mjs \
  --rom out/gngb-flat.bin \
  --trace out/r2/mame-probe/pre-instruction.jsonl \
  --observations out/r2/mame-probe/observations.tsv \
  --capabilities out/r2/mame-probe/capabilities.json \
  --out out/r3/sprite-native
