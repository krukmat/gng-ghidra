#!/usr/bin/env bash
# R2.A4 private diagnostic MAME mini-probe. Never touches legacy R2 evidence.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
fail(){ echo "A063_ORACLE_MINIPROBE=BLOCKED reason=$1" >&2; exit 2; }
MAME_BIN="$(printenv GNG_R3_MAME_BIN || true)"
[[ -n "$MAME_BIN" && "$MAME_BIN" == */* && -x "$MAME_BIN" ]] ||
  fail explicit_patched_mame_binary_required
python3 scripts/prepare_r3_flat_rom.py >/dev/null || fail private_flat_rom_invalid
python3 scripts/r3_bank_inventory.py --images-only >/dev/null || fail private_bank_image_invalid
SIGS="$(python3 scripts/r3_bank_provenance.py prepare)" ||
  fail authentic_fingerprint_unavailable
read -r FIRST SECOND <<< "$SIGS"
[[ -n "$FIRST" && -n "$SECOND" ]] || fail fingerprint_missing
OUT="$ROOT/out/r3/a063-oracle-smoke"
PRE="$ROOT/out/r3/a063-oracle-preflight/private-a063-preflight.json"
python3 scripts/a063_trace_contract.py preflight --oracle \
  --first "$FIRST" --second "$SECOND" --mame-bin "$MAME_BIN" \
  --output "$PRE" >/dev/null || fail oracle_preflight_rejected
GNG_A063_ORACLE_SMOKE=1 GNG_R2_TRACE_MODE=printf GNG_A063_PREFLIGHT="$PRE" \
  GNG_A06_BANKSIG_HEX0="$FIRST" GNG_A06_BANKSIG_HEX1="$SECOND" \
  bash scripts/r2-mame-probe.sh || fail native_oracle_capture_failed
python3 scripts/a063_capture_integrity.py --verify \
  --output "$OUT" --preflight "$PRE" || fail oracle_postflight_rejected
python3 scripts/a063_bank_oracle_gate.py || fail oracle_bank_disagreement_or_inconclusive
echo "A063_ORACLE_MINIPROBE=PASS_SAMPLED_INSTRUCTIONS_ONLY_NOT_FULL_A063"
