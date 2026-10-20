#!/usr/bin/env bash
# One-command visual proof: actual MAME frame vs ROM-based JS renderer.
# MAME is a TEST REFERENCE ONLY and is never part of product/runtime.
set -euo pipefail
cd "$(dirname "$0")/.."
if ! command -v mame >/dev/null 2>&1; then
  echo "GNG_REAL_FRAME=BLOCKED — MAME no está instalado o no figura en PATH." >&2
  echo "Se necesita solo para capturar un fotograma real como oráculo externo." >&2
  echo "Mac con Homebrew: brew install mame (opcional, bajo tu control)." >&2
  exit 2
fi
if [[ ! -f roms/gng.zip ]]; then
  echo "GNG_REAL_FRAME=BLOCKED — falta roms/gng.zip (chips gráficos originales)." >&2
  echo "No se descarga ningún archivo ROM; usa tu copia local." >&2
  exit 2
fi
# The existing file may be named gng.zip but contain gngb program ROMs.
# Never choose the CPU program revision from the ZIP filename!
source_rom=roms/gng.zip
if [[ -f roms/gngb.zip ]]; then
  source_rom=roms/gngb.zip
fi
python3 scripts/prepare_mame_rom.py --rom "$source_rom"
system="$(python3 -c 'import json; print(json.load(open("out/reference/mame-roms/rom-set.json"))["machine"])')"
echo "GNG_MAME_REFERENCE_DRIVER=$system (verified from chip CRCs)"
# MAME itself must accept the ROM revision before replaying any inputs.
mame -verifyroms "$system" -rompath out/reference/mame-roms
capture_args=(--system "$system" --rompath out/reference/mame-roms
              --frame "${GNG_FRAME:-600}" --repeats "${GNG_REPEATS:-1}")
if [[ -n "${GNG_BOT_SEQUENCE:-}" ]]; then
  capture_args+=(--bot-sequence "$GNG_BOT_SEQUENCE")
fi
python3 scripts/capture_real_frame.py "${capture_args[@]}"
python3 src/reference_frame_view.py --rom roms/gng.zip
if command -v open >/dev/null 2>&1; then
  open out/visual/frame-compare.html
else
  echo "Abre out/visual/frame-compare.html en tu navegador."
fi
echo "GNG_REAL_FRAME=READY_TO_INSPECT"
echo "GNG_JS_PIXEL_EQUIVALENCE=UNVERIFIED — revisa el diff visual, no declares PASS solo por generar HTML."
