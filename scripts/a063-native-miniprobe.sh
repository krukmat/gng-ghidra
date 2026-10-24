#!/usr/bin/env bash
# A0.6.3-R2 preliminary mini-probe; isolated from existing R2/R3 native traces.
# Requires a private authenticated ROM + MAME. NOT a bank identity certificate.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
fail(){ echo "A063_MINIPROBE=BLOCKED reason=$1" >&2; exit 2; }
# Fresh operator environment: prepare the CRC-verified flat ROM without overwriting stale data.
python3 scripts/prepare_r3_flat_rom.py >/dev/null || fail private_flat_rom_invalid
# No dependency on an earlier R2 native trace: CRC-validated images only.
python3 scripts/r3_bank_inventory.py --images-only >/dev/null || fail private_rom_images_invalid
SIGS="$(python3 scripts/r3_bank_provenance.py prepare)" || fail private_fingerprint_not_ready
read -r FIRST SECOND <<< "$SIGS"
[[ -n "$FIRST" && -n "$SECOND" ]] || fail fingerprint_offsets_missing
python3 scripts/a063_trace_contract.py preflight \
  --first "$FIRST" --second "$SECOND" \
  --mame-bin "${GNG_R3_MAME_BIN:-mame}" \
  --output "$ROOT/out/r3/a063-smoke-preflight/private-a063-preflight.json" \
  >/dev/null || fail capture_contract_invalid
# Existing MAME probe remains under out/r2 by default; this isolated mode
# stops after two frames (or two seconds) and refuses to overwrite old smoke.
GNG_A063_PREFLIGHT="$ROOT/out/r3/a063-smoke-preflight/private-a063-preflight.json" \
GNG_A063_SMOKE=1 GNG_R2_TRACE_MODE=printf \
  GNG_A06_BANKSIG_HEX0="$FIRST" GNG_A06_BANKSIG_HEX1="$SECOND" \
  bash scripts/r2-mame-probe.sh || fail native_miniprobe_failed
OUT="$ROOT/out/r3/a063-smoke"
python3 scripts/a063_capture_integrity.py --verify \
  --output "$OUT" \
  --preflight "$ROOT/out/r3/a063-smoke-preflight/private-a063-preflight.json" \
  || fail postflight_integrity_rejected
python3 scripts/r3_bank_provenance.py diagnose \
  --rawtrace "$OUT/cpu.trace" --trace "$OUT/pre-instruction.jsonl" \
  > "$OUT/private-diagnostic.json" || fail native_diagnostic_failed
python3 scripts/a063_trace_contract.py triage \
  --input "$OUT/private-diagnostic.json" > "$OUT/private-triage.json" \
  || fail native_triage_failed
python3 - "$OUT/private-triage.json" <<'PY'
import json,sys
from pathlib import Path
report=json.loads(Path(sys.argv[1]).read_text())
if report["decision"]!="R1_READY_FOR_PRIVATE_STRICT_PARSER_ONLY":
    raise SystemExit("A063_MINIPROBE=BLOCKED native_signature_invalid_or_misaligned")
print("A063_MINIPROBE=BYTE_SHAPE_ONLY_NOT_BANK_PROVENANCE")
PY
