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
rm -f "$OUTPUT/observations.tsv" "$OUTPUT/cpu.trace" "$OUTPUT/capabilities.json"
DEBUGSCRIPT="$OUTPUT/start-debugger.txt"
# MAME's debugger starts stopped. 'g' continues execution after enabling
# its native instruction trace (with loop suppression disabled).
printf 'trace %s,:maincpu,noloop\ng\n' "$OUTPUT/cpu.trace" > "$DEBUGSCRIPT"
export GNG_R2_PROBE_DIR="$OUTPUT" GNG_R2_PROBE_FRAMES=4
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
if grep -q '\[LUA ERROR\]' "$OUTPUT/mame.log"; then
  echo "GNG_R2_PROBE=LUA_ERROR" >&2
  grep '\[LUA ERROR\]' "$OUTPUT/mame.log" | tail -n 8 >&2
fi
python3 scripts/r2_probe_report.py --dir "$OUTPUT"
# Return nonzero unless we can authenticate the minimal probe fields,
# but a valid probe is NEVER an R2 equivalence PASS.
if [[ $EXIT_CODE -ne 0 ]]; then fail mame_debugger_runtime_failed; fi
python3 - "$OUTPUT/capabilities.json" <<'PY'
import json,sys
report=json.load(open(sys.argv[1],encoding="utf-8"))
if report["status"] != "PARTIAL_NATIVE_INSTRUMENTATION":
    raise SystemExit("GNG_R2_PROBE=INSTRUMENTATION_BLOCKED see capabilities.json")
print("GNG_R2_PROBE=OBSERVED_PARTIAL_ONLY R2.3_NOT_STARTED")
PY
