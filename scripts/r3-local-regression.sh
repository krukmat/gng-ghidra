#!/usr/bin/env bash
# ROM-free local regression for R3/R4.2. No GitHub Actions or private ROM.
# Run from any directory: bash scripts/r3-local-regression.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
command -v node >/dev/null || {
  echo "GNG_LOCAL_REGRESSION=BLOCKED node_missing" >&2
  exit 2
}
node --check src/gngb_sprite_dma.mjs
node --check src/gngb_video_registers.mjs
node --check src/gngb_board_memory.mjs
node --check src/gngb_video_bridge.mjs
node --check src/gngb_frame_renderer.mjs
node --check src/gngb_frame_pipeline.mjs
node --check scripts/r42_visual_fixture.mjs
node --check src/gngb_visual_event_replay.mjs
node --check src/gngb_visual_event_fixture.mjs
node --check scripts/r42d_visual_replay_lab.mjs
node --check src/r42e_snapshot_integrity.mjs
node --check src/r42e_checkpoint_compare.mjs
node --check src/r42g_incremental_timeline.mjs
node --check src/r42h_romfree_gate.mjs
node --check scripts/r42h_romfree_gate.mjs
node --check scripts/r42g_replay_timeline.mjs
node --check scripts/r42e_native_reference_audit.mjs
node --check src/gngb_banked_rom.mjs
node --check scripts/r3_video_board_integration.mjs
node --check scripts/r3_static_trace_probe.mjs
node --check scripts/r3_indexed_store_gate.mjs
node --check scripts/r3_native_video_write_gate.mjs
node --check scripts/r3_banked_static_gate.mjs
node --check scripts/r3_banked_report_integrity.mjs
node --check scripts/r3_banked_effect_profile.mjs
node --check scripts/r3_d6_followup_diagnostic.mjs
node --check scripts/r3_native_irq_report.mjs
node --test \
  tests/test_gngb_video_registers.mjs \
  tests/test_gngb_video_mmio_board.mjs \
  tests/test_gngb_sprite_dma.mjs \
  tests/test_gngb_sprite_dma_board.mjs \
  tests/test_gngb_board_memory.mjs \
  tests/test_gngb_video_bridge.mjs \
  tests/test_gngb_frame_renderer.mjs \
  tests/test_gngb_frame_renderer_r1_parity.mjs \
  tests/test_r42_visual_fixture.mjs \
  tests/test_gngb_visual_event_replay.mjs \
  tests/test_r42d_visual_replay_lab.mjs \
  tests/test_r42e_snapshot_integrity.mjs \
  tests/test_r42e_checkpoint_compare.mjs \
  tests/test_r42e_audit_cli.mjs \
  tests/test_r42g_incremental_timeline.mjs \
  tests/test_r42g_replay_cli.mjs \
  tests/test_r42h_romfree_gate.mjs \
  tests/test_gngb_banked_rom.mjs \
  tests/test_r3_compiler_family_batch.mjs \
  tests/test_r3_lea_indexed.mjs \
  tests/test_r3_dynamic_coverage.mjs \
  tests/test_r3_indexed_store_gate.mjs \
  tests/test_r3_banked_static_gate.mjs \
  tests/test_r3_banked_report_integrity.mjs \
  tests/test_r3_banked_effect_profile.mjs \
  tests/test_r3_d6_followup_diagnostic.mjs \
  tests/test_r3_native_irq_report.mjs \
  tests/test_r3_native_video_write_gate.mjs \
  tests/test_video_memory.mjs \
  tests/test_sprite_memory.mjs
bash -n scripts/r3-native-irq-verify.sh
python3 -m unittest discover -s tests -p 'test_r3_prepare_native_mame_hook.py' -v
python3 -m unittest discover -s tests -p 'test_r3_bank_inventory.py' -v
python3 -m unittest discover -s tests -p 'test_r3_bank_provenance.py' -v
python3 -m unittest discover -s tests -p 'test_mame_visual_oracle.py' -v
python3 -m py_compile scripts/capture_real_frame.py scripts/r42f_validate_timeline.py tests/test_r42f_timeline.py
python3 -m unittest discover -s tests -p 'test_r42f_timeline.py' -v
python3 -m py_compile scripts/r42_validation_closure.py tests/test_r42_validation_closure.py
python3 -m unittest discover -s tests -p 'test_r42_validation_closure.py' -v
python3 -m py_compile scripts/r42_t5_preflight.py tests/test_r42_t5_preflight.py
python3 -m unittest discover -s tests -p 'test_r42_t5_preflight.py' -v
python3 -m unittest discover -s tests -p 'test_a063_trace_contract.py' -v
python3 -m unittest discover -s tests -p 'test_a063_capture_integrity.py' -v
python3 -m unittest discover -s tests -p 'test_a063_smoke_signature_gate.py' -v
python3 -m unittest discover -s tests -p 'test_a063_adversarial.py' -v
python3 -m unittest discover -s tests -p 'test_a063_oracle.py' -v
python3 -m unittest discover -s tests -p 'test_a063_mame_patch.py' -v
python3 -m unittest discover -s tests -p 'test_a063_oracle_replay.py' -v
python3 -m unittest discover -s tests -p 'test_a063_oracle_pipeline.py' -v
echo "GNG_LOCAL_REGRESSION=PASS_ROM_FREE_A0_2_TO_A0_6_3"
echo "GNG_LOCAL_REGRESSION=PASS_ROM_FREE_R3_R42H"
