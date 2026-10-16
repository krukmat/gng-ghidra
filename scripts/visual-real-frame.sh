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
if [[ -f roms/gngb.zip ]]; then
  system=gngb
else
  system=gng
fi
echo "GNG_MAME_REFERENCE_DRIVER=$system"
if [[ "$system" == "gng" ]]; then
  echo "Aviso: usando revisión gng original porque falta gngb.zip; no afirmar equivalencia de CPU gngb."
fi
python3 scripts/capture_real_frame.py --system "$system" --rompath roms --frame "${GNG_FRAME:-600}"
python3 src/reference_frame_view.py --rom roms/gng.zip
if command -v open >/dev/null 2>&1; then
  open out/visual/frame-compare.html
else
  echo "Abre out/visual/frame-compare.html en tu navegador."
fi
echo "GNG_REAL_FRAME=READY_TO_INSPECT"
echo "GNG_JS_PIXEL_EQUIVALENCE=UNVERIFIED — revisa el diff visual, no declares PASS solo por generar HTML."
