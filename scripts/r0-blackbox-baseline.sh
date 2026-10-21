#!/usr/bin/env bash
# T1: use Blackbox's ORIGINAL autoboot launcher, not our gng-ghidra bot.
# Original ROM/video/timeline remain in private ignored directories.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
fail() { echo "GNG_BLACKBOX_T1=BLOCKED reason=$1" >&2; exit 2; }
command -v git >/dev/null || fail git_missing
command -v mame >/dev/null || fail mame_missing
PYTHON=python3
if [[ -n "$(printenv GNG_BLACKBOX_PYTHON || true)" ]]; then
  PYTHON="$(printenv GNG_BLACKBOX_PYTHON)"
fi
command -v "$PYTHON" >/dev/null || fail python_missing
"$PYTHON" -c 'import sys;sys.exit(0 if sys.version_info >= (3,11) else 1)' ||
  fail python_3_11_required

# Pinned to the upstream Blackbox version used to validate the original flow.
PIN=99722c3900b63e13185c52824c0adec3df7f44c1
BB="$ROOT/out/tools/blackbox_mame_game_abstraction"
if [[ -n "$(printenv GNG_BLACKBOX_DIR || true)" ]]; then
  BB="$(printenv GNG_BLACKBOX_DIR)"
fi
if [[ ! -d "$BB/.git" ]]; then
  [[ ! -e "$BB" ]] || fail blackbox_checkout_path_occupied
  mkdir -p "$(dirname "$BB")"
  echo "GNG_BLACKBOX_T1=CLONING_ORIGINAL_REFERENCE"
  git clone --quiet --depth 1 https://github.com/krukmat/blackbox_mame_game_abstraction.git "$BB" ||
    fail blackbox_clone_failed
fi
BB="$(cd "$BB" && pwd)"
CURRENT="$(git -C "$BB" rev-parse HEAD)"
if [[ "$CURRENT" != "$PIN" ]]; then
  if [[ -n "$(printenv GNG_BLACKBOX_DIR || true)" ]]; then
    fail custom_blackbox_checkout_not_pinned
  fi
  git -C "$BB" fetch --quiet --depth 1 origin "$PIN" ||
    fail blackbox_pin_fetch_failed
  git -C "$BB" checkout --quiet --detach "$PIN" ||
    fail blackbox_pin_checkout_failed
fi
[[ ! -f "$BB/.env" ]] || fail unexpected_blackbox_dotenv
[[ ! -f "$BB/blackbox.local.memory_map.yaml" ]] ||
  fail unexpected_blackbox_memory_map
[[ -f "$BB/scripts/mame_autoboot.lua" ]] || fail original_blackbox_lua_missing
[[ -f "$BB/scripts/launch_manual_capture_autoboot.sh" ]] ||
  fail original_blackbox_launcher_missing
[[ -f "$BB/plans/generated/gng_boot_only.yaml" ]] ||
  fail original_blackbox_plan_missing

# gngb needs a MAME-compatible local alias for the verified private ROM.
ROM="$ROOT/roms/gng.zip"
if [[ -f "$ROOT/roms/gngb.zip" ]]; then ROM="$ROOT/roms/gngb.zip"; fi
[[ -f "$ROM" ]] || fail private_rom_missing
"$PYTHON" scripts/prepare_mame_rom.py --rom "$ROM" ||
  fail rom_preflight_failed
MAME_ROMPATH="$ROOT/out/reference/mame-roms"
MACHINE="$("$PYTHON" -c 'import json;print(json.load(open("out/reference/mame-roms/rom-set.json"))["machine"])')"
[[ "$MACHINE" == "gngb" ]] || fail blackbox_requires_gngb_revision
mame -verifyroms "$MACHINE" -rompath "$MAME_ROMPATH" >/dev/null ||
  fail mame_verifyroms_failed

# For the upstream input-planner, only PyYAML is needed.
VENV="$BB/apps/mame-harness/.venv"
if [[ ! -x "$VENV/bin/python" ]]; then
  "$PYTHON" -m venv "$VENV" || fail blackbox_virtualenv_failed
fi
if ! "$VENV/bin/python" -c 'import yaml' >/dev/null 2>&1; then
  "$VENV/bin/python" -m pip -q install 'PyYAML>=6,<7' ||
    fail blackbox_pyyaml_install_failed
fi

RUN_ID="gng_ghidra_$(date +%Y%m%d_%H%M%S)"
EVIDENCE="$BB/evidence/private/run_$RUN_ID"
mkdir -p "$ROOT/out/blackbox-baseline"
LOG="$ROOT/out/blackbox-baseline/mame.log"
echo "GNG_BLACKBOX_T1=ORIGINAL_LAUNCHER commit=$PIN"
echo "GNG_BLACKBOX_T1=VISUAL_CHECK: observe stage and Arthur; press Esc to close MAME."
echo "GNG_BLACKBOX_T1=NO_GNG_GHIDRA_BOT_LOADED"
# Run the exact upstream launcher and Lua; do not modify the Blackbox checkout.
if ! (cd "$BB" &&
  BLACKBOX_MAME_BINARY=mame \
  BLACKBOX_MAME_DRIVER=gngb \
  BLACKBOX_ROM_PATH="$MAME_ROMPATH" \
  BLACKBOX_BOOT_PLAN=plans/generated/gng_boot_only.yaml \
  BLACKBOX_EVIDENCE_ROOT=evidence/private \
  bash scripts/launch_manual_capture_autoboot.sh "$RUN_ID") >"$LOG" 2>&1; then
  tail -n 35 "$LOG" >&2
  fail original_blackbox_runtime_failed
fi
"$PYTHON" "$ROOT/scripts/r0_blackbox_verify.py" \
  --timeline "$EVIDENCE/logs/input_timeline.json" \
  --video "$EVIDENCE/video/capture.avi" \
  --report "$ROOT/out/blackbox-baseline/result.json" ||
  { tail -n 20 "$LOG" >&2; fail blackbox_evidence_failed; }
echo "GNG_BLACKBOX_PRIVATE_AVI=$EVIDENCE/video/capture.avi"
echo "GNG_BLACKBOX_T1=INPUTS_CONFIRMED_GAMEPLAY_VISUAL_REVIEW_REQUIRED"
