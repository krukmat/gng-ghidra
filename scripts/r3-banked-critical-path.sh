#!/usr/bin/env bash
# Offline revalidation and static bank/PC compilation. No MAME invocation.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
[[ "${1:-}" == "--full-oracle" && $# -eq 1 ]] || {
  echo "A063_OFFLINE=BLOCKED explicit_full_oracle_required" >&2; exit 2;
}
[[ "${GNG_R3_MAME_BIN:-}" == */* && -x "$GNG_R3_MAME_BIN" ]] || {
  echo "A063_OFFLINE=BLOCKED explicit_patched_mame_binary_required" >&2; exit 2;
}
python3 scripts/a063_capture_integrity.py --verify \
  --output "$ROOT/out/r2/mame-probe" \
  --preflight "$ROOT/out/r3/banked-provenance/private-a063-preflight.json" \
  --mame-bin "$GNG_R3_MAME_BIN"
python3 scripts/r3_bank_inventory.py >/dev/null
python3 scripts/r3_bank_provenance.py diagnose
python3 scripts/r3_bank_provenance.py report --mame-bin "$GNG_R3_MAME_BIN"
node scripts/r3_unmapped_read_policy.mjs
node scripts/r3_native_video_write_gate.mjs
node scripts/r3_banked_static_gate.mjs
