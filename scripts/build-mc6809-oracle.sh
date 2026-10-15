#!/usr/bin/env bash
# Test-only, independently implemented MC6809 CPU reference. No game ROM is fetched.
set -euo pipefail
cd "$(dirname "$0")/.."
PIN=5bad24375961418d6591491929aea1f4dc8cb90f
SOURCE=out/native-oracle/vendor/mc6809
DEST=out/native-oracle/mc6809-reference
mkdir -p out/native-oracle/vendor
if [[ ! -d "$SOURCE/.git" ]]; then
  git clone --quiet https://github.com/elmerucr/mc6809.git "$SOURCE"
fi
git -C "$SOURCE" fetch --quiet origin "$PIN"
git -C "$SOURCE" checkout --quiet --detach "$PIN"
ACTUAL=$(git -C "$SOURCE" rev-parse HEAD)
if [[ "$ACTUAL" != "$PIN" ]]; then
  echo "GNG_NATIVE_BUILD=BLOCKED unexpected upstream commit $ACTUAL" >&2
  exit 1
fi
CXX="$(command -v c++ || true)"
if [[ -z "$CXX" ]]; then
  echo "GNG_NATIVE_BUILD=BLOCKED C++ compiler unavailable" >&2
  exit 1
fi
"$CXX" -std=c++17 -O2 -Wall -Wextra -Wno-unused-parameter -I"$SOURCE/src" \
  scripts/mc6809-native-oracle.cpp \
  "$SOURCE/src/mc6809.cpp" \
  "$SOURCE/src/mc6809_addressing_modes.cpp" \
  "$SOURCE/src/mc6809_disassembler.cpp" \
  "$SOURCE/src/mc6809_instructions.cpp" \
  -o "$DEST"
echo "GNG_NATIVE_BUILD=PASS oracle=$DEST provider=elmerucr/mc6809 commit=$PIN"
