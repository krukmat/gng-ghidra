#!/usr/bin/env bash
# Native MC6809 IRQ/SYNC experiment. Requires a USER-BUILT instrumented
# MAME executable. Stock/Homebrew MAME is deliberately rejected.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
[[ -n "${GNG_R3_MAME_BIN:-}" && -f "${GNG_R3_MAME_BIN:-}" ]] || {
  echo "GNG_R35_NATIVE=BLOCKED missing_explicit_instrumented_mame_binary" >&2
  exit 2
}
# Prevent accidentally running stock MAME. This alone is not source attestation.
LC_ALL=C grep -aFq 'GNG_R35_NATIVE_V1' "$GNG_R3_MAME_BIN" || {
  echo "GNG_R35_NATIVE=BLOCKED binary_lacks_native_hook_marker" >&2
  exit 2
}
# B2.T4 requires a separate, explicit approval. A marker in the binary
# is a preflight check, NOT provenance of its instrumented build.
[[ "${GNG_R35_NATIVE_T4_APPROVED:-}" == EXPLICIT_OPERATOR_B2_T4 ]] || {
  echo "GNG_R35_NATIVE=BLOCKED t4_operator_authorization_required" >&2
  exit 2
}
# The legacy R2 probe creates out/r2/mame-probe and removes named files.
# Fail closed if prior evidence exists: no backup-and-overwrite, no retries.
for evidence in out/r2/mame-probe out/r3/native-irq-report; do
  if [[ -e "$evidence" || -L "$evidence" ]]; then
    echo "GNG_R35_NATIVE=BLOCKED existing_evidence_use_isolated_checkout" >&2
    exit 2
  fi
done
# Source-compiled native 6809 marker lines are routed to mame.log by -oslog.
GNG_R3_MAME_NATIVE_EVENTS=1 GNG_R2_PROBE_SOFT_RESET=1 \
  GNG_R2_PROBE_SPRITE_RAM=1 bash scripts/r2-mame-probe.sh
node scripts/r3_native_irq_report.mjs \
  --log out/r2/mame-probe/mame.log \
  --out out/r3/native-irq-report
# A structured log is NOT proof of a matching JS IRQ handler or full bus.
