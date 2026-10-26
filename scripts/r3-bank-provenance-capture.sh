#!/usr/bin/env bash
# A0.6.3: one MAME debugger pre-instruction trace with two side-effect-free
# native ROM bank signature reads per instruction; original evidence backed up.
# No GitHub Actions, no instrumented MAME rebuild or JS opcode interpreter.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
fail(){ echo "A063_FULL_CAPTURE=BLOCKED reason=$1" >&2; exit 2; }
[[ "${1:-}" == "--full-oracle" ]] || fail explicit_full_oracle_required
shift
CAPTURE_ONLY=0
if [[ "${1:-}" == "--capture-only" ]]; then CAPTURE_ONLY=1; shift; fi
[[ $# -eq 0 ]] || fail unknown_argument
[[ "${GNG_R3_MAME_BIN:-}" == */* && -x "$GNG_R3_MAME_BIN" ]] ||
  fail explicit_patched_mame_binary_required
# Refuse partial and complete prior evidence before preparing any artifacts.
for path in out/r2/mame-probe out/r3/banked-provenance out/r3/banked-codegen; do
  [[ ! -e "$path" && ! -L "$path" ]] || fail capture_artifact_collision
done
python3 scripts/prepare_r3_flat_rom.py >/dev/null
python3 scripts/r3_bank_inventory.py --images-only >/dev/null
SIGS="$(python3 scripts/r3_bank_provenance.py prepare)"
read -r BANKSIG0 BANKSIG1 <<< "$SIGS"
[[ -n "$BANKSIG0" && -n "$BANKSIG1" ]] || {
  echo "A063_CAPTURE=BLOCKED could_not_prepare_private_bank_signature" >&2
  exit 2
}
# Fail before invoking MAME if the debugger-action contract, MAME version,
# binary fingerprint or source hashes cannot be recorded privately.
# This is PRE-RUN evidence only; it NEVER attests an instruction or bank.
python3 scripts/a063_trace_contract.py preflight --oracle --full-oracle \
  --first "$BANKSIG0" --second "$BANKSIG1" \
  --mame-bin "${GNG_R3_MAME_BIN:-mame}" \
  --output "$ROOT/out/r3/banked-provenance/private-a063-preflight.json" >/dev/null
# The original boot/B4 contract requires exactly two boot sprite sequences.
# D6 native diagnostics found all required taps by four frames; later frames
# include unrelated sprite writes. Capture the complete bounded run, never
# trim an existing trace or weaken the exact boot gate.
GNG_A063_PREFLIGHT="$ROOT/out/r3/banked-provenance/private-a063-preflight.json" \
GNG_A063_FULL_ORACLE=1 GNG_R2_PROBE_FRAMES="${GNG_R2_PROBE_FRAMES:-4}" \
GNG_A06_BANKSIG_HEX0="$BANKSIG0" GNG_A06_BANKSIG_HEX1="$BANKSIG1" \
GNG_R2_TRACE_MODE=printf \
GNG_R36_CAPTURE_UNMAP_POLICY=1 GNG_A04_VIDEO_WRITE_TAP=1 \
  bash scripts/r3-video-write-capture.sh
python3 scripts/a063_capture_integrity.py --verify \
  --output "$ROOT/out/r2/mame-probe" \
  --preflight "$ROOT/out/r3/banked-provenance/private-a063-preflight.json" \
  --mame-bin "$GNG_R3_MAME_BIN"
echo "A063_FULL_CAPTURE=POSTFLIGHT_INTACT_NOT_PROVENANCE"
if [[ "$CAPTURE_ONLY" == "1" ]]; then exit 0; fi
python3 scripts/r3_bank_provenance.py diagnose
python3 scripts/r3_bank_provenance.py report --mame-bin "$GNG_R3_MAME_BIN"
# The same private capture now supplies the bank/PC static recompilation gate.
# This never builds or executes an opcode interpreter or reruns MAME.
node scripts/r3_banked_static_gate.mjs
