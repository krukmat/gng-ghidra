#!/usr/bin/env bash
# R3.6.B4: native MAME map.unmap_value + complete target-read tap capture.
# Uses the existing guarded R3.6 wrapper, backs up previous native evidence.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
GNG_R36_CAPTURE_UNMAP_POLICY=1 bash scripts/r3-mmio-read-capture.sh
