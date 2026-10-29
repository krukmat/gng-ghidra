#!/usr/bin/env bash
# AO-5: compile the incremental dual-YM2203 to a standalone .wasm (no JS glue,
# threads, SharedArrayBuffer or Node). src/ao_ym2203_wasm.mjs loads it.
# Usage: scripts/ao_build_audio_wasm.sh [ymfm checkout] (default out/audio/ymfm)
set -euo pipefail
cd "$(dirname "$0")/.."
EXPECTED_YMFM=81aec25ccbb98f4873a255f7551ac4dadac59b4a
EXPECTED_EMCC=4.0.15
EMSDK="${EMSDK:-$HOME/emsdk}"
YMFM_SRC="${1:-out/audio/ymfm}"
ACTUAL="$(git -C "$YMFM_SRC" rev-parse HEAD 2>/dev/null || true)"
if [[ "$ACTUAL" != "$EXPECTED_YMFM" ]]; then
  echo "AO_AUDIO_YMFM_PIN_MISMATCH expected=$EXPECTED_YMFM actual=$ACTUAL" >&2; exit 2
fi
# shellcheck disable=SC1091
source "$EMSDK/emsdk_env.sh" >/dev/null 2>&1
EMCC_VERSION="$(emcc --version | sed -n '1s/.* \([0-9][0-9.]*\) (.*/\1/p')"
if [[ "$EMCC_VERSION" != "$EXPECTED_EMCC" ]]; then
  echo "AO_AUDIO_EMCC_VERSION_MISMATCH expected=$EXPECTED_EMCC actual=$EMCC_VERSION" >&2; exit 2
fi
OUT=out/android/audio
mkdir -p "$OUT"
EXPORTS=_ao_ym_create,_ao_ym_destroy,_ao_ym_error,_ao_ym_write,_ao_ym_reset
EXPORTS=$EXPORTS,_ao_ym_render,_ao_ym_pcm,_ao_ym_block_first
EXPORTS=$EXPORTS,_ao_ym_checkpoint,_ao_ym_save,_ao_ym_load
emcc -std=c++17 -O2 -Wall -Wextra -Wno-unused-parameter -fno-exceptions -I"$YMFM_SRC/src" -Isrc \
  src/ao_ym2203_wasm.cpp \
  "$YMFM_SRC/src/ymfm_opn.cpp" "$YMFM_SRC/src/ymfm_ssg.cpp" \
  "$YMFM_SRC/src/ymfm_adpcm.cpp" "$YMFM_SRC/src/ymfm_misc.cpp" \
  --no-entry -sSTANDALONE_WASM -sEXPORTED_FUNCTIONS="$EXPORTS" \
  -sINITIAL_MEMORY=2MB -sSTACK_SIZE=64KB -sALLOW_MEMORY_GROWTH=0 \
  -sFILESYSTEM=0 -sASSERTIONS=0 \
  -o "$OUT/ym2203.wasm"
WASM_SHA="$(shasum -a 256 "$OUT/ym2203.wasm" | cut -d' ' -f1)"
SRC_SHA="$(cat src/ao_ym2203_wasm.cpp src/ym2203_checkpoint.h | shasum -a 256 | cut -d' ' -f1)"
cat > "$OUT/build.json" <<EOF
{"wasm":"ym2203.wasm","sha256":"$WASM_SHA","bytes":$(wc -c < "$OUT/ym2203.wasm" | tr -d ' '),
 "source_sha256":"$SRC_SHA","emcc":"$EMCC_VERSION","ymfm":"$EXPECTED_YMFM"}
EOF
echo "AO_AUDIO_WASM_BUILD=PASS sha256=$WASM_SHA"
