#!/usr/bin/env bash
# R0/T1: launch Blackbox's ORIGINAL gngb Lua input runner, without copying it.
# Private ROM, MAME movie and timelines remain under ignored out/.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BLACKBOX_ROOT="$(cd "$ROOT/.." && pwd)/blackbox_mame_game_abstraction"
OVERRIDE="$(printenv BLACKBOX_ROOT_OVERRIDE || true)"
if [[ -n "$OVERRIDE" ]]; then BLACKBOX_ROOT="$OVERRIDE"; fi
if [[ ! -f "$BLACKBOX_ROOT/scripts/mame_autoboot.lua" ||
      ! -f "$BLACKBOX_ROOT/plans/generated/gng_boot_only.yaml" ]]; then
  echo "T1=BLOCKED: Blackbox source not present at $BLACKBOX_ROOT" >&2
  echo "Clone: git clone https://github.com/krukmat/blackbox_mame_game_abstraction.git \"$BLACKBOX_ROOT\"" >&2
  echo "Or set BLACKBOX_ROOT_OVERRIDE to its checkout directory." >&2
  exit 2
fi
if ! command -v mame >/dev/null 2>&1; then
  echo "T1=BLOCKED: MAME is not installed/in PATH" >&2
  exit 2
fi

# The owner's ZIP is never copied into Git. Preflight exposes a full-set
# gngb.zip alias under out/, bypassing confusion between gng.zip and gngb.
ROM="$ROOT/roms/gng.zip"
if [[ -f "$ROOT/roms/gngb.zip" ]]; then ROM="$ROOT/roms/gngb.zip"; fi
if [[ ! -f "$ROM" ]]; then
  echo "T1=BLOCKED: No private ROM found in $ROOT/roms" >&2
  exit 2
fi
python3 "$ROOT/scripts/prepare_mame_rom.py" --rom "$ROM"
ROMPATH="$ROOT/out/reference/mame-roms"
MACHINE="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["machine"])' "$ROMPATH/rom-set.json")"
if [[ "$MACHINE" != "gngb" ]]; then
  echo "T1=BLOCKED: Blackbox boot plan requires gngb, detected $MACHINE" >&2
  exit 2
fi
mame -verifyroms "$MACHINE" -rompath "$ROMPATH"

PYTHON=python3
if [[ -x "$BLACKBOX_ROOT/apps/mame-harness/.venv/bin/python" ]]; then
  PYTHON="$BLACKBOX_ROOT/apps/mame-harness/.venv/bin/python"
fi
if ! "$PYTHON" -c "import yaml" >/dev/null 2>&1; then
  echo "T1=BLOCKED: PyYAML missing from $PYTHON" >&2
  echo "Install into the Blackbox virtualenv, or install PyYAML for python3." >&2
  exit 2
fi

RUN="$ROOT/out/reference/blackbox-t1"
mkdir -p "$RUN"
export BLACKBOX_INPUT_PLAN_PATH="$RUN/input_plan.json"
export BLACKBOX_INPUT_TIMELINE_PATH="$RUN/input_timeline.json"
# Ignore ambient variables from previous gng-ghidra runs.
unset GNG_BOT_EVENTS GNG_BOT_SHA256 GNG_CAPTURE_FRAME GNG_CAPTURE_DIR
"$PYTHON" - "$BLACKBOX_ROOT" "$BLACKBOX_INPUT_PLAN_PATH" <<'PY'
import sys
from pathlib import Path
blackbox=Path(sys.argv[1])
sys.path.insert(0,str(blackbox/"apps/mame-harness"))
from input_planner import load_input_plan
plan=load_input_plan(blackbox/"plans/generated/gng_boot_only.yaml")
plan.export_to_json(Path(sys.argv[2]))
actions=[(f.frame_index,f.action) for f in plan.expand_to_frames()
         if f.action in {"insert_coin","press_start"}]
assert actions and actions[0][1]=="insert_coin"
assert any(action=="press_start" for _,action in actions)
print("T1_BOOT_PLAN=VALID coin_frame="+str(actions[0][0])+
      " start_frame="+str(next(f for f,a in actions if a=="press_start")))
PY

rm -f "$BLACKBOX_INPUT_TIMELINE_PATH" "$RUN/mame.log"
echo "T1=STARTING_BLACKBOX_ORIGINAL (play after intro, then close MAME)"
echo "T1_REFERENCE=Blackbox scripts/mame_autoboot.lua (not gng-ghidra bot)"
# Only the original Blackbox Lua drives inputs. Its output is kept private.
if ! mame "$MACHINE" -rompath "$ROMPATH" \
    -autoboot_script "$BLACKBOX_ROOT/scripts/mame_autoboot.lua" \
    -aviwrite "$RUN/capture.avi" -window -skip_gameinfo \
    > "$RUN/mame.log" 2>&1; then
  echo "T1=MAME_ERROR (last log lines)" >&2
  tail -n 35 "$RUN/mame.log" >&2
  exit 2
fi
"$PYTHON" - "$BLACKBOX_ROOT" "$BLACKBOX_INPUT_PLAN_PATH" "$BLACKBOX_INPUT_TIMELINE_PATH" <<'PY'
import json,sys
from pathlib import Path
blackbox=Path(sys.argv[1])
sys.path.insert(0,str(blackbox/"apps/mame-harness"))
from input_timeline import load_input_timeline, timeline_matches_plan
plan=json.loads(Path(sys.argv[2]).read_text())
timeline=load_input_timeline(Path(sys.argv[3]))
# Only compare scripted boot; human keys after Arthur becomes playable are allowed.
expected=[v for v in plan if v["frame"]<=1024]
actual=[v for v in timeline if v.frame<=1024]
if not timeline_matches_plan(actual,expected):
    raise SystemExit("T1=BLOCKED_INPUTS_DIFFER_FROM_PLAN")
coin=sum("coin" in frame.buttons for frame in actual)
start=sum("start" in frame.buttons for frame in actual)
if not coin or not start:
    raise SystemExit("T1=BLOCKED_COIN_START_NOT_OBSERVED")
print(f"T1_BOOT_INPUTS=MATCH coin_frames={coin} start_frames={start}")
print(f"T1_FRAMES_RECORDED={len(timeline)}")
print("T1_GAMEPLAY=NEEDS_VISUAL_CONFIRMATION_FROM_OPERATOR")
PY
echo "T1_PRIVATE_CAPTURE=$RUN/capture.avi"
echo "T1_PRIVATE_LOG=$RUN/mame.log"
