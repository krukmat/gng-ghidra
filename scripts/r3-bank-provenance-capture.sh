#!/usr/bin/env bash
# A0.6.3: one MAME debugger pre-instruction trace with two side-effect-free
# native ROM bank signature reads per instruction; original evidence backed up.
# No GitHub Actions, no instrumented MAME rebuild or JS opcode interpreter.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
python3 scripts/r3_bank_inventory.py >/dev/null
SIGS="$(python3 scripts/r3_bank_provenance.py prepare)"
read -r BANKSIG0 BANKSIG1 <<< "$SIGS"
[[ -n "$BANKSIG0" && -n "$BANKSIG1" ]] || {
  echo "A063_CAPTURE=BLOCKED could_not_prepare_private_bank_signature" >&2
  exit 2
}
# Preserve all previous R2 trace/TSV/ROM evidence via existing wrapper.
GNG_A06_BANKSIG_HEX0="$BANKSIG0" GNG_A06_BANKSIG_HEX1="$BANKSIG1" \
GNG_R2_TRACE_MODE=printf \
GNG_R36_CAPTURE_UNMAP_POLICY=1 GNG_A04_VIDEO_WRITE_TAP=1 \
  bash scripts/r3-video-write-capture.sh
python3 scripts/r3_bank_provenance.py report
