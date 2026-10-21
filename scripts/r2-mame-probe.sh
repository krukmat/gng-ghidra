#!/usr/bin/env bash
# R2.2.A: independent gngb MAME debugger capability probe. NOT a CPU trace.
# Never modifies original Blackbox bot or any generated JS routine.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
fail() { echo "GNG_R2_PROBE=BLOCKED reason=$1" >&2; exit 2; }
command -v python3 >/dev/null || fail python_missing
command -v mame >/dev/null || fail mame_missing
ROM="$ROOT/roms/gng.zip"
if [[ -f "$ROOT/roms/gngb.zip" ]]; then ROM="$ROOT/roms/gngb.zip"; fi
[[ -f "$ROM" ]] || fail local_private_rom_missing
python3 scripts/prepare_mame_rom.py --rom "$ROM" || fail rom_preflight_failed
ROMPATH="$ROOT/out/reference/mame-roms"
MACHINE="$(python3 -c 'import json;print(json.load(open("out/reference/mame-roms/rom-set.json"))["machine"])')"
[[ "$MACHINE" == "gngb" ]] || fail requires_gngb
mame -verifyroms gngb -rompath "$ROMPATH" >/dev/null || fail rom_verify_failed

OUTPUT="$ROOT/out/r2/mame-probe"
mkdir -p "$OUTPUT"
# Fresh evidence required; never accept an old trace on a failed debug run.
rm -f "$OUTPUT/observations.tsv" "$OUTPUT/cpu.trace" "$OUTPUT/capabilities.json" \
  "$OUTPUT/pretrace-report.json" "$OUTPUT/pre-instruction.jsonl"
DEBUGSCRIPT="$OUTPUT/start-debugger.txt"
# MAME's debugger starts stopped. 'g' continues execution after enabling
# its native instruction trace (with loop suppression disabled).
# MAME executes tracelog before writing each instruction. Capture all nine
# architectural MC6809 registers, independent of generated/P-code JS.
# The raw trace and extracted snapshots remain private in out/r2/.
TRACE_ACTION='{tracelog "GNG_R2_PRE PC=%04X A=%02X B=%02X X=%04X Y=%04X U=%04X S=%04X DP=%02X CC=%02X",pc,a,b,x,y,u,s,dp,cc}'
printf 'trace %s,:maincpu,noloop,%s\ng\n' "$OUTPUT/cpu.trace" "$TRACE_ACTION" > "$DEBUGSCRIPT"
export GNG_R2_PROBE_DIR="$OUTPUT" GNG_R2_PROBE_FRAMES=4
export GNG_R2_PROBE_SOFT_RESET="${GNG_R2_PROBE_SOFT_RESET:-0}"
[[ "$GNG_R2_PROBE_SOFT_RESET" == "0" || "$GNG_R2_PROBE_SOFT_RESET" == "1" ]] ||
  fail invalid_soft_reset_option
echo "GNG_R2_PROBE=START_MAME_DEBUGGER_NOT_GAMEPLAY"
# Run in its own MAME process: startup/reset and instruction timing here
# intentionally differs from the Blackbox autoplay sessions.
set +e
mame gngb -rompath "$ROMPATH" -debug -debugscript "$DEBUGSCRIPT" \
  -autoboot_script "$ROOT/scripts/r2-mame-probe.lua" \
  -seconds_to_run 8 -skip_gameinfo \
  >"$OUTPUT/mame.log" 2>&1
EXIT_CODE=$?
set -e
echo "GNG_R2_PROBE_MAME_EXIT=$EXIT_CODE"
LUA_FAULT=0
if grep -q '\[LUA ERROR\]' "$OUTPUT/mame.log"; then
  LUA_FAULT=1
  echo "GNG_R2_PROBE=LUA_ERROR" >&2
  grep '\[LUA ERROR\]' "$OUTPUT/mame.log" | tail -n 8 >&2
fi
# Independently analyze real per-instruction pre-state markers: fail-closed,
# never calculate synthetic post-state/IRQ or replace missing instructions.
python3 scripts/r2_pretrace_report.py --dir "$OUTPUT"
python3 scripts/r2_probe_report.py --dir "$OUTPUT"
# Return nonzero unless we can authenticate the minimal probe fields,
# but a valid probe is NEVER an R2 equivalence PASS.
if [[ $EXIT_CODE -ne 0 ]]; then fail mame_debugger_runtime_failed; fi
if [[ $LUA_FAULT -ne 0 ]]; then fail lua_callback_error_despite_zero_mame_exit; fi
python3 - "$OUTPUT/capabilities.json" "$OUTPUT/pretrace-report.json" <<'PY'
import json,sys
with open(sys.argv[1],encoding="utf-8") as stream:
    report=json.load(stream)
with open(sys.argv[2],encoding="utf-8") as stream:
    pretrace=json.load(stream)
if report["status"] != "PARTIAL_NATIVE_INSTRUMENTATION":
    raise SystemExit("GNG_R2_PROBE=INSTRUMENTATION_BLOCKED see capabilities.json")
if pretrace["status"] != "PRE_INSTRUCTION_FORMAT_PARSED" or pretrace["snapshots"] < 2:
    raise SystemExit("GNG_R2_PRETRACE=INSTRUMENTATION_BLOCKED see redacted malformed_shapes_redacted")
print("GNG_R2_PROBE=OBSERVED_NATIVE_PRESTATE_ONLY R2.3_NOT_STARTED")
PY
