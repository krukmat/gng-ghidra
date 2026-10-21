#!/usr/bin/env bash
# R0: run the actual upstream Blackbox game bot, not its boot-only plan.
# Lua and authored gameplay YAML are original pinned Blackbox files.
# Original ROM, AVI, effective input timeline and logs stay private.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
fail() { echo "GNG_BLACKBOX_R0=BLOCKED reason=$1" >&2; exit 2; }
command -v git >/dev/null || fail git_missing
command -v mame >/dev/null || fail mame_missing
PYTHON="$(printenv GNG_BLACKBOX_PYTHON || printf python3)"
command -v "$PYTHON" >/dev/null || fail python_missing
"$PYTHON" -c 'import sys;sys.exit(0 if sys.version_info >= (3,11) else 1)' ||
  fail python_3_11_required

# Exactly the version Blackbox used to define/calibrate GNG 950/1020/1505.
PIN=99722c3900b63e13185c52824c0adec3df7f44c1
BB="$ROOT/out/tools/blackbox_mame_game_abstraction"
if [[ -n "$(printenv GNG_BLACKBOX_DIR || true)" ]]; then
  BB="$(printenv GNG_BLACKBOX_DIR)"
fi
if [[ ! -d "$BB/.git" ]]; then
  [[ ! -e "$BB" ]] || fail blackbox_checkout_path_occupied
  mkdir -p "$(dirname "$BB")"
  echo "GNG_BLACKBOX_R0=CLONING_PINNED_BLACKBOX"
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
[[ ! -f "$BB/blackbox.local.memory_map.yaml" ]] || fail unexpected_blackbox_memory_map
[[ -f "$BB/scripts/mame_autoboot.lua" ]] || fail original_blackbox_lua_missing
[[ -f "$BB/plans/generated/gng_gameplay.yaml" ]] || fail original_blackbox_gameplay_plan_missing

ROM="$ROOT/roms/gng.zip"
if [[ -f "$ROOT/roms/gngb.zip" ]]; then ROM="$ROOT/roms/gngb.zip"; fi
[[ -f "$ROM" ]] || fail private_rom_missing
"$PYTHON" scripts/prepare_mame_rom.py --rom "$ROM" || fail rom_preflight_failed
MAME_ROMPATH="$ROOT/out/reference/mame-roms"
MACHINE="$("$PYTHON" -c 'import json;print(json.load(open("out/reference/mame-roms/rom-set.json"))["machine"])')"
[[ "$MACHINE" == "gngb" ]] || fail blackbox_requires_gngb_revision
mame -verifyroms "$MACHINE" -rompath "$MAME_ROMPATH" >/dev/null ||
  fail mame_verifyroms_failed

VENV="$BB/apps/mame-harness/.venv"
if [[ ! -x "$VENV/bin/python" ]]; then
  "$PYTHON" -m venv "$VENV" || fail blackbox_virtualenv_failed
fi
if ! "$VENV/bin/python" -c 'import yaml' >/dev/null 2>&1; then
  "$VENV/bin/python" -m pip -q install 'PyYAML>=6,<7' ||
    fail blackbox_pyyaml_install_failed
fi

RUN_ID="gng_ghidra_gameplay_$(date +%Y%m%d_%H%M%S)"
EVIDENCE="$BB/evidence/private/run_$RUN_ID"
mkdir -p "$EVIDENCE/logs" "$EVIDENCE/video" "$ROOT/out/blackbox-baseline"
PLAN="$EVIDENCE/logs/input_plan.json"
TIMELINE="$EVIDENCE/logs/input_timeline.json"
AVI="$EVIDENCE/video/capture.avi"
LOG="$ROOT/out/blackbox-baseline/mame.log"
MP4="$ROOT/out/blackbox-baseline/gameplay.mp4"

# Opt-in only: compose original Blackbox Lua with the existing R0 video observer.
# No changes to the known-working Blackbox bot or its generated input plan.
MAME_SCRIPT="$BB/scripts/mame_autoboot.lua"
R0_FRAME="${GNG_BLACKBOX_CAPTURE_FRAME:-}"
if [[ -n "$R0_FRAME" ]]; then
  [[ "$R0_FRAME" =~ ^[0-9]+$ ]] || fail invalid_capture_frame
  (( R0_FRAME > 1505 && R0_FRAME < 2200 )) || fail capture_frame_outside_gameplay_window
  REF="$ROOT/out/reference/mame"
  mkdir -p "$REF"
  # Stale screenshots/VRAM must never count as evidence for a fresh run.
  rm -f "$REF/foreground.bin" "$REF/background.bin" "$REF/sprites-buffered.bin"
  rm -f "$REF/palette-rgba.bin" "$REF/reference.png" "$REF/state.json" "$REF/manifest.json"
  export GNG_CAPTURE_DIR="$REF"
  export GNG_CAPTURE_FRAME="$R0_FRAME"
  export GNG_CAPTURE_KEEP_RUNNING=1
  unset GNG_BOT_EVENTS GNG_BOT_SHA256
  echo "GNG_BLACKBOX_R0=CAPTURE_ADDON_ENABLED frame=$R0_FRAME"
fi

# Keep the upstream bot and plan UNCHANGED, in one Lua lexical chunk.
# Its shutdown notifier did not emit input_timeline.json in the operator run
# (MAME reached frame 2334 and exited). Force a checkpoint at frame 2100,
# AFTER all 2045 planned game inputs and BEFORE the timed MAME exit.
# The private addon calls the *original* local write_timeline(), then exits.
MAME_SCRIPT="$ROOT/out/blackbox-baseline/combined-autoboot.lua"
{
  cat "$BB/scripts/mame_autoboot.lua"
  if [[ -n "$R0_FRAME" ]]; then
    printf '\n-- R0 video/VRAM observer (does not drive inputs)\n'
    cat "$ROOT/scripts/capture-mame-frame.lua"
  fi
  printf '\n-- GNG: early-flush original Blackbox timeline before timed exit\n'
  cat "$ROOT/scripts/blackbox-early-flush.lua"
} > "$MAME_SCRIPT"

# Generate the actual original Blackbox gameplay schedule, not boot_only.
# Remap the two MAME action buttons without modifying the pinned checkout.
BB_ROOT="$BB" PLAN_PATH="$PLAN" GNG_ROOT="$ROOT" "$VENV/bin/python" - <<'PY'
import json,os,sys
from pathlib import Path
bb=Path(os.environ["BB_ROOT"])
sys.path.insert(0,str(bb/"apps/mame-harness"))
sys.path.insert(0,str(Path(os.environ["GNG_ROOT"])/"scripts"))
from input_planner import load_input_plan
from r0_blackbox_gameplay import convert_file
plan=load_input_plan(bb/"plans/generated/gng_gameplay.yaml")
path=Path(os.environ["PLAN_PATH"])
plan.export_to_json(path)
report=convert_file(path)
(path.parent/"plan-validation.json").write_text(json.dumps(report,indent=2)+"\n")
print("GNG_BLACKBOX_BOT_PLAN=GAMEPLAY frames="+str(report["frames"]))
print("GNG_BLACKBOX_BOT_MAPPING=button1_attack_button2_jump")
PY

# MAME 0.287 uses -seconds_to_run, which ensures unattended termination.
# 40 seconds gives the ~2045-frame gameplay sequence time to finish.
echo "GNG_BLACKBOX_R0=AUTOPLAYING_GNGB (Coin, Start, Right, Jump, Attack)"
echo "GNG_BLACKBOX_R0=Recording private gameplay AVI, not using gng-ghidra's old bot"
if ! (
  cd "$BB"
  env -u BLACKBOX_MEMORY_MAP_PATH -u BLACKBOX_STATE_TIMELINE_PATH \
    BLACKBOX_INPUT_PLAN_PATH="$PLAN" \
    BLACKBOX_INPUT_TIMELINE_PATH="$TIMELINE" \
    mame "$MACHINE" -rompath "$MAME_ROMPATH" \
    -aviwrite "$AVI" -seconds_to_run 40 \
    -autoboot_script "$MAME_SCRIPT"
) >"$LOG" 2>&1; then
  tail -n 35 "$LOG" >&2
  fail original_blackbox_gameplay_runtime_failed
fi

# The upstream Lua writes the effective input timeline on machine stop.
# An AVI alone does NOT prove it was written. Diagnose without hiding Lua errors.
if [[ ! -s "$TIMELINE" ]]; then
  if grep -q '\[LUA ERROR\]' "$LOG"; then
    echo "GNG_BLACKBOX_DIAG=LUA_CALLBACK_ERROR_PREVENTED_CLEAN_CAPTURE" >&2
  elif ! grep -q 'GNG_BLACKBOX_DIAG=INPUT_TIMELINE_EARLY_FLUSH' "$LOG" &&
       ! grep -q 'blackbox_harness:input_timeline:written:' "$LOG"; then
    echo "GNG_BLACKBOX_DIAG=INPUT_TIMELINE_FLUSH_NOT_OBSERVED" >&2
  else
    echo "GNG_BLACKBOX_DIAG=INPUT_TIMELINE_FILE_NOT_WRITTEN" >&2
  fi
  tail -n 15 "$LOG" >&2
  fail blackbox_effective_input_timeline_missing
fi
"$PYTHON" "$ROOT/scripts/r0_blackbox_verify.py" \
  --timeline "$TIMELINE" --video "$AVI" --plan "$PLAN" \
  --expect-gameplay \
  --report "$ROOT/out/blackbox-baseline/result.json" ||
  { tail -n 20 "$LOG" >&2; fail gameplay_inputs_not_observed; }
echo "GNG_BLACKBOX_R0=EFFECTIVE_INPUT_TIMELINE_VERIFIED"
# Always allow a genuine gameplay still from the ORIGINAL Blackbox AVI.
# This provides visual evidence even when the optional buffered-sprite RAM
# observer fails; never label it as JS pixel equivalence or memory capture.
if [[ -z "$R0_FRAME" ]] && command -v ffmpeg >/dev/null 2>&1; then
  mkdir -p "$ROOT/out/reference/blackbox-video"
  STILL="$ROOT/out/reference/blackbox-video/gameplay-frame.png"
  if ffmpeg -y -hide_banner -loglevel error -i "$AVI" \
       -vf 'select=eq(n\,1550)' -fps_mode vfr -frames:v 1 "$STILL" &&
       [[ -s "$STILL" ]]; then
    echo "GNG_BLACKBOX_REAL_VIDEO_FRAME=$STILL (AVI frame index; NO VRAM evidence)"
  else
    echo "GNG_BLACKBOX_REAL_VIDEO_FRAME=UNAVAILABLE; original AVI remains valid" >&2
  fi
fi
if [[ -n "$R0_FRAME" ]]; then
  "$PYTHON" "$ROOT/scripts/r0_blackbox_capture_validate.py" \
    --reference "$REF" --frame "$R0_FRAME" --system "$MACHINE" \
    --timeline "$TIMELINE" --baseline "$ROOT/out/blackbox-baseline/result.json" ||
    { tail -n 20 "$LOG" >&2; fail native_gameplay_snapshot_invalid; }
  "$PYTHON" "$ROOT/src/reference_frame_view.py" --rom "$ROM" \
    --reference "$REF" || fail js_renderer_replay_build_failed
  echo "GNG_BLACKBOX_R0=VIDEO_FRAME_AND_VRAM_CAPTURED_RENDERER_NOT_YET_VERIFIED"
  echo "GNG_BLACKBOX_R0_HTML=$ROOT/out/visual/frame-compare.html"
fi
echo "GNG_BLACKBOX_PRIVATE_AVI=$AVI"
if command -v ffmpeg >/dev/null 2>&1; then
  if ffmpeg -y -hide_banner -loglevel error -i "$AVI" \
      -an -c:v mpeg4 -q:v 3 "$MP4"; then
    echo "GNG_BLACKBOX_GAMEPLAY_VIDEO=$MP4"
    if [[ "$(uname)" == "Darwin" ]] && command -v open >/dev/null 2>&1; then
      open "$MP4"
    fi
  else
    echo "GNG_BLACKBOX_MP4=UNAVAILABLE; inspect private AVI" >&2
  fi
else
  echo "GNG_BLACKBOX_MP4=UNAVAILABLE_FFMPEG_MISSING; inspect private AVI"
fi
echo "GNG_BLACKBOX_R0=AUTOPLAY_INPUTS_VERIFIED_GAMEPLAY_VISUAL_REVIEW_REQUIRED"
