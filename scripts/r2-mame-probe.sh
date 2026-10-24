#!/usr/bin/env bash
# R2.2.A: independent gngb MAME debugger capability probe. NOT a CPU trace.
# Never modifies original Blackbox bot or any generated JS routine.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
fail() { echo "GNG_R2_PROBE=BLOCKED reason=$1" >&2; exit 2; }
command -v python3 >/dev/null || fail python_missing
MAME_BIN="${GNG_R3_MAME_BIN:-mame}"
command -v "$MAME_BIN" >/dev/null || fail mame_missing
# Bash 3.2 on macOS treats an expanded empty array as unbound under
# `set -u`. Use scalar mode plus positional arguments instead.
NATIVE_LOG_EVENTS="${GNG_R3_MAME_NATIVE_EVENTS:-0}"
[[ "$NATIVE_LOG_EVENTS" == "0" || "$NATIVE_LOG_EVENTS" == "1" ]] ||
  fail invalid_native_log_events_option
if [[ "$NATIVE_LOG_EVENTS" == "1" ]]; then
  [[ "$MAME_BIN" != "mame" ]] ||
    fail native_hook_requires_explicit_custom_mame_binary
fi
ROM="$ROOT/roms/gng.zip"
if [[ -f "$ROOT/roms/gngb.zip" ]]; then ROM="$ROOT/roms/gngb.zip"; fi
[[ -f "$ROM" ]] || fail local_private_rom_missing
python3 scripts/prepare_mame_rom.py --rom "$ROM" || fail rom_preflight_failed
ROMPATH="$ROOT/out/reference/mame-roms"
MACHINE="$(python3 -c 'import json;print(json.load(open("out/reference/mame-roms/rom-set.json"))["machine"])')"
[[ "$MACHINE" == "gngb" ]] || fail requires_gngb
"$MAME_BIN" -verifyroms gngb -rompath "$ROMPATH" >/dev/null || fail rom_verify_failed

# R2 default remains unchanged. The A0.6.3 native smoke uses a private
# independent directory and never overwrites prior R2/R3 trace evidence.
OUTPUT="$ROOT/out/r2/mame-probe"
SECONDS_TO_RUN=8
if [[ "${GNG_A063_SMOKE:-0}" == "1" ]]; then
  OUTPUT="$ROOT/out/r3/a063-smoke"
  SECONDS_TO_RUN=2
  export GNG_R2_PROBE_FRAMES=2
  python3 - "$ROOT" "$OUTPUT" <<'PY'
import sys
from pathlib import Path
root=Path(sys.argv[1]).resolve()
private=(root/"out/r3").resolve()
out=Path(sys.argv[2]).resolve()
if not private.is_relative_to(root) or not out.is_relative_to(private):
    raise SystemExit("A063_SMOKE_PRIVATE_OUTPUT_REQUIRED")
PY
  # Refuse to replace ANY previous smoke artifact, including partial/crashed
  # runs where the raw CPU trace was not successfully written.
  if [[ -d "$OUTPUT" ]]; then
    for artifact in "$OUTPUT"/* "$OUTPUT"/.[!.]* "$OUTPUT"/..?*; do
      [[ ! -e "$artifact" && ! -L "$artifact" ]] ||
        fail a063_smoke_capture_exists_preserve_old_evidence
    done
  fi
elif [[ "${GNG_A063_SMOKE:-0}" != "0" ]]; then
  fail a063_invalid_smoke_mode
fi
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
# Prefer MAME's own symbol formatting. This avoids nine printf arguments
# and preserves the debugger's native widths. The parser validates every
# register's architectural range; unknown formats fail closed.
# Keep legacy tracelog available for controlled diagnosis, never auto-fallback
# after a failed trace (which would mix incompatible evidence).
GNG_R2_TRACE_MODE="${GNG_R2_TRACE_MODE:-tracesym}"
case "$GNG_R2_TRACE_MODE" in
  tracesym)
    TRACE_ACTION='{tracelog "GNG_R2_PRE ";tracesym pc,a,b,x,y,u,s,dp,cc}'
    ;;
  printf)
    TRACE_ACTION='{tracelog "GNG_R2_PRE PC=%04X A=%02X B=%02X X=%04X Y=%04X U=%04X S=%04X DP=%02X CC=%02X",pc,a,b,x,y,u,s,dp,cc}'
    ;;
  *) fail invalid_native_trace_mode ;;
esac
# A0.6.3 optional bank signature read by MAME's debugger TRACE action.
# b@ suppresses memory read side effects; both reads occur in the same
# per-instruction debugger callback as the CPU register prestate.
# The two addresses originate from CRC-verified local bank signatures and
# must uniquely identify all five banks. Never infer bank from frame samples.
if [[ -n "${GNG_A06_BANKSIG_HEX0:-}" || -n "${GNG_A06_BANKSIG_HEX1:-}" ]]; then
  [[ "$GNG_R2_TRACE_MODE" == "printf" ]] ||
    fail a063_requires_printf_trace_mode
  [[ "${GNG_A06_BANKSIG_HEX0:-}" =~ ^[0-9a-fA-F]{4}$ ]] ||
    fail a063_bad_first_bank_probe_address
  [[ "${GNG_A06_BANKSIG_HEX1:-}" =~ ^[0-9a-fA-F]{4}$ ]] ||
    fail a063_bad_second_bank_probe_address
  [[ "$GNG_A06_BANKSIG_HEX0" != "$GNG_A06_BANKSIG_HEX1" ]] ||
    fail a063_duplicate_bank_probe_address
  FIRST_DEC=$((16#$GNG_A06_BANKSIG_HEX0))
  SECOND_DEC=$((16#$GNG_A06_BANKSIG_HEX1))
  (( FIRST_DEC >= 16384 && FIRST_DEC <= 24575 &&
     SECOND_DEC >= 16384 && SECOND_DEC <= 24575 )) ||
    fail a063_bank_probe_outside_rom_window
  # Use ONE tracelog command with register and signature data to prevent
  # ambiguous joins across debugger callbacks, loops, or reset boundaries.
  TRACE_ACTION="$(python3 scripts/a063_trace_contract.py emit \
    --first "$GNG_A06_BANKSIG_HEX0" \
    --second "$GNG_A06_BANKSIG_HEX1")" || fail a063_trace_contract_invalid
fi
printf 'trace %s,:maincpu,noloop,%s\ng\n' "$OUTPUT/cpu.trace" "$TRACE_ACTION" > "$DEBUGSCRIPT"
echo "GNG_R2_TRACE_MODE=$GNG_R2_TRACE_MODE"
export GNG_R2_PROBE_DIR="$OUTPUT" GNG_R2_PROBE_FRAMES="${GNG_R2_PROBE_FRAMES:-4}"
export GNG_R2_PROBE_SOFT_RESET="${GNG_R2_PROBE_SOFT_RESET:-0}"
[[ "$GNG_R2_PROBE_SOFT_RESET" == "0" || "$GNG_R2_PROBE_SOFT_RESET" == "1" ]] ||
  fail invalid_soft_reset_option
echo "GNG_R2_PROBE=START_MAME_DEBUGGER_NOT_GAMEPLAY"
# Run in its own MAME process: startup/reset and instruction timing here
# intentionally differs from the Blackbox autoplay sessions.
# Populate only non-empty positional arguments; works on stock macOS Bash 3.2
# with strict nounset, and preserves the same argv order for normal R2 runs.
set -- gngb -rompath "$ROMPATH" -debug -debugscript "$DEBUGSCRIPT" \
  -autoboot_script "$ROOT/scripts/r2-mame-probe.lua"
if [[ "$NATIVE_LOG_EVENTS" == "1" ]]; then
  # Optional custom binary only. -oslog routes native logerror to mame.log.
  set -- "$@" -oslog
fi
set +e
"$MAME_BIN" "$@" -seconds_to_run "$SECONDS_TO_RUN" -skip_gameinfo \
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
