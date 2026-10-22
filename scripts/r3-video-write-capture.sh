#!/usr/bin/env bash
# A0.4: single native MAME run for independently verified video-RAM writes.
# The underlying R3.6 wrapper backs up prior private native evidence and
# validates the original ROM, R3.3 sprite boot, B4 unmap policy and LDA.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
GNG_A04_VIDEO_WRITE_TAP=1 GNG_R36_CAPTURE_UNMAP_POLICY=1 \
  bash scripts/r3-mmio-read-capture.sh
