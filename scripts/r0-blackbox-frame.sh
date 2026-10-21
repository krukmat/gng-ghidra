#!/usr/bin/env bash
# R0: preserve the proven Blackbox gameplay runner and capture an actual frame plus VRAM.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export GNG_BLACKBOX_CAPTURE_FRAME="${GNG_BLACKBOX_CAPTURE_FRAME:-1550}"
bash "$ROOT/scripts/r0-blackbox-baseline.sh"
HTML="$ROOT/out/visual/frame-compare.html"
if [[ "$(uname)" == "Darwin" ]] && command -v open >/dev/null 2>&1; then
  open "$HTML"
else
  echo "GNG_BLACKBOX_FRAME_COMPARE=$HTML"
fi
echo "GNG_BLACKBOX_R0=BLACKBOX_AUTOPLAY_PLUS_NATIVE_FRAME_JS_RENDERER_READY_FOR_REVIEW"
