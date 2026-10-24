#!/usr/bin/env bash
# Local regression subset for A0.2–A0.5. No GitHub Actions and no native ROM.
# Run from any directory: bash scripts/r3-local-regression.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
command -v node >/dev/null || {
  echo "GNG_LOCAL_REGRESSION=BLOCKED node_missing" >&2
  exit 2
}
node --check src/gngb_board_memory.mjs
node --check src/gngb_video_bridge.mjs
node --check src/gngb_banked_rom.mjs
node --check scripts/r3_video_board_integration.mjs
node --check scripts/r3_static_trace_probe.mjs
node --check scripts/r3_indexed_store_gate.mjs
node --check scripts/r3_native_video_write_gate.mjs
node --check scripts/r3_banked_static_gate.mjs
node --check scripts/r3_banked_report_integrity.mjs
node --test \
  tests/test_gngb_board_memory.mjs \
  tests/test_gngb_video_bridge.mjs \
  tests/test_gngb_banked_rom.mjs \
  tests/test_r3_compiler_family_batch.mjs \
  tests/test_r3_dynamic_coverage.mjs \
  tests/test_r3_indexed_store_gate.mjs \
  tests/test_r3_banked_static_gate.mjs \
  tests/test_r3_banked_report_integrity.mjs \
  tests/test_r3_native_video_write_gate.mjs \
  tests/test_video_memory.mjs \
  tests/test_sprite_memory.mjs
python3 -m unittest discover -s tests -p 'test_r3_bank_inventory.py' -v
python3 -m unittest discover -s tests -p 'test_r3_bank_provenance.py' -v
python3 -m unittest discover -s tests -p 'test_a063_trace_contract.py' -v
python3 -m unittest discover -s tests -p 'test_a063_capture_integrity.py' -v
python3 -m unittest discover -s tests -p 'test_a063_smoke_signature_gate.py' -v
python3 -m unittest discover -s tests -p 'test_a063_adversarial.py' -v
python3 -m unittest discover -s tests -p 'test_a063_oracle.py' -v
python3 -m unittest discover -s tests -p 'test_a063_mame_patch.py' -v
python3 -m unittest discover -s tests -p 'test_a063_oracle_replay.py' -v
echo "GNG_LOCAL_REGRESSION=PASS_ROM_FREE_A0_2_TO_A0_6_3"
