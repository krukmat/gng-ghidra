#!/usr/bin/env bash
# R3.6.B2. One native capture of ONLY the ROM-attested LDA extended address.
# Preserves previous complete R2 evidence in private out/r3.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
command -v python3 >/dev/null || { echo "GNG_R36_CAPTURE=BLOCKED python_missing" >&2; exit 2; }
command -v node >/dev/null || { echo "GNG_R36_CAPTURE=BLOCKED node_missing" >&2; exit 2; }
python3 scripts/prepare_r3_flat_rom.py --rom roms/gng.zip --out out/gngb-flat.bin
# Private ROM never printed. Verify exact opcode and MMIO window before
# starting MAME. The address is passed ONLY as a process environment variable.
ADDR="$(python3 - <<'PY'
from pathlib import Path
b=Path('out/gngb-flat.bin').read_bytes()
if len(b)!=65536 or b[0xfffe:0x10000]!=bytes([0x60,0]) or b[0x6017]!=0xb6:
    raise SystemExit('GNG_R36_CAPTURE=BLOCKED rom_or_opcode_mismatch')
addr=(b[0x6018]<<8)|b[0x6019]
if not 0x3800<=addr<=0x3fff:
    raise SystemExit('GNG_R36_CAPTURE=BLOCKED operand_not_mmio')
print(addr)
PY
)"
mkdir -p out/r3
if [[ -d out/r2/mame-probe ]]; then
  BACKUP="$(mktemp -d "$ROOT/out/r3/probe-before-r36-mmio.XXXXXXXX")"
  cp -R out/r2/mame-probe/. "$BACKUP/"
  echo "GNG_R36_PREVIOUS_MAME_PROBE_PRESERVED=$BACKUP"
fi
GNG_R36_TARGET_READ_ADDRESS="$ADDR" \
GNG_R2_PROBE_SOFT_RESET=1 GNG_R2_PROBE_SPRITE_RAM=1 \
  bash scripts/r2-mame-probe.sh
# Opt-in B4 captures native unmap_value as independent policy evidence.
# Do not invoke the older single-sample gate on a known 100-read capture.
if [[ "${GNG_R36_CAPTURE_UNMAP_POLICY:-0}" == "1" ]]; then
  node scripts/r3_unmapped_read_policy.mjs
else
  node scripts/r3_mmio_read_gate.mjs
fi
