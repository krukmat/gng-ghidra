#!/usr/bin/env bash
# R2.B reproducible ROM-free checks, NEVER native evidence.
# Requires a complete checkout and locally installed Python, Node and git.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
for binary in python3 node git; do
  command -v "$binary" >/dev/null || {
    echo "A063_R2B=BLOCKED tool_missing" >&2
    exit 2
  }
done
bash -n scripts/r2-mame-probe.sh scripts/a063-native-miniprobe.sh \
  scripts/a063-native-oracle-miniprobe.sh scripts/r3-bank-provenance-capture.sh \
  scripts/a063-r2b-romfree.sh scripts/a063-r2c-linux-gate.sh scripts/a063-r2d-linux-preflight.sh \
  scripts/a063-codespaces-bootstrap.sh
python3 -m json.tool .devcontainer/devcontainer.json >/dev/null
python3 -m py_compile \
  scripts/a063_trace_contract.py scripts/a063_capture_integrity.py \
  scripts/a063_bank_oracle_gate.py scripts/a063_oracle_replay.py \
  scripts/a063_patch_mame_oracle.py
python3 -m unittest discover -s tests -p 'test_a063_oracle_replay.py' -v
python3 scripts/a063_oracle_replay.py
python3 -m unittest discover -s tests -p 'test_a063_mame_patch.py' -v
bash scripts/r3-local-regression.sh
echo "A063_R2B=ROMFREE_CHECKS_PASS_NOT_NATIVE_NOT_A063_CERTIFIED"
