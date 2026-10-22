#!/usr/bin/env bash
# Offline revalidation and static bank/PC compilation. No MAME invocation.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
python3 scripts/r3_bank_inventory.py >/dev/null
python3 scripts/r3_bank_provenance.py report
node scripts/r3_banked_static_gate.mjs
