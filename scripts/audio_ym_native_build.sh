#!/usr/bin/env bash
# Compile dual-YM2203 native renderer with a pinned ymfm checkout (no ROMs).
set -euo pipefail
cd "$(dirname "$0")/.."
EXPECTED=81aec25ccbb98f4873a255f7551ac4dadac59b4a
YMFM_SRC="$1"
if [[ ! -d "$YMFM_SRC/.git" ]]; then
  echo AUDIO_YMFM_SOURCE_MISSING >&2; exit 2
fi
ACTUAL="$(git -C "$YMFM_SRC" rev-parse HEAD)"
if [[ "$ACTUAL" != "$EXPECTED" ]]; then
  echo "AUDIO_YMFM_PIN_MISMATCH expected=$EXPECTED actual=$ACTUAL" >&2; exit 2
fi
mkdir -p out/audio
c++ -std=c++17 -O2 -Wall -Wextra -I"$YMFM_SRC/src" \
  src/audio_ym2203_lab.cpp \
  "$YMFM_SRC/src/ymfm_opn.cpp" "$YMFM_SRC/src/ymfm_ssg.cpp" \
  "$YMFM_SRC/src/ymfm_adpcm.cpp" "$YMFM_SRC/src/ymfm_misc.cpp" \
  -o out/audio/ym2203_lab
echo GNG_AUDIO_YMFM_NATIVE_BUILD=PASS
