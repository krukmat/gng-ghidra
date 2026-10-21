#!/usr/bin/env bash
# R0: prove original Blackbox game input recording WITHOUT our addon first.
# Only after that attempt optional video/RAM observation in a separate run.
# Both runs use the same pinned Blackbox plan; no ROM is published.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
R0_FRAME="${GNG_BLACKBOX_CAPTURE_FRAME:-1550}"
echo "GNG_BLACKBOX_R0=PHASE_1_ORIGINAL_BLACKBOX_ONLY"
if ! env -u GNG_BLACKBOX_CAPTURE_FRAME \
       bash "$ROOT/scripts/r0-blackbox-baseline.sh"; then
  echo "GNG_BLACKBOX_R0=BLOCKED_ORIGINAL_GAMEPLAY_RUN — video addon NOT attempted" >&2
  exit 2
fi
echo "GNG_BLACKBOX_R0=PHASE_1_INPUTS_VERIFIED_GAMEPLAY_VISUAL_REVIEW_REQUIRED"
echo "GNG_BLACKBOX_R0=PHASE_2_VIDEO_MEMORY_OBSERVER"
if ! GNG_BLACKBOX_CAPTURE_FRAME="$R0_FRAME" \
       bash "$ROOT/scripts/r0-blackbox-baseline.sh"; then
  echo "GNG_BLACKBOX_R0=PARTIAL_ORIGINAL_BOT_PASS_VIDEO_RAM_CAPTURE_BLOCKED" >&2
  echo "GNG_BLACKBOX_R0=No JS equivalence claim; review private MAME log." >&2
  exit 2
fi
HTML="$ROOT/out/visual/frame-compare.html"
if [[ "$(uname)" == "Darwin" ]] && command -v open >/dev/null 2>&1; then
  open "$HTML"
else
  echo "GNG_BLACKBOX_FRAME_COMPARE=$HTML"
fi
echo "GNG_BLACKBOX_R0=BLACKBOX_AUTOPLAY_PLUS_NATIVE_FRAME_JS_RENDERER_READY_FOR_REVIEW"
