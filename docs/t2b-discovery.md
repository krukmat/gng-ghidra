# T2.B.6–7 — Grounded ROM discovery and function shortlist

## Goal and acceptance contract

Discover *real* MC6809 code entry points before expanding the P-code translator.
Never treat a raw opcode scan as proof of a CALL or a decoded instruction as a
complete, independent function. This block produces two **local**, gitignored
JSON outputs:

- `out/functions-inventory.json` — vectors, decoded Ghidra direct CALL sites,
  bank-4/fixed context, byte-matched function summaries, exclusions, and provenance.
- `out/functions-shortlist.json` — up to three prioritized **candidates**, with
  explicit blockers and next steps. A candidate is not translated or equivalent
  merely because it appears on the shortlist.

The source of truth is a Ghidra export plus the **matching** user-supplied ROM.
Each instruction's byte encoding is compared against the flat image; a stale or
mismatched export is rejected. ROMs and Ghidra exports remain local.

## Actual gngb ROM vector observations (verified with local ZIP)

| Vector | At | Value | Decision |
|---|---|---|---|
| SWI3 | `0xfff2` | `0xffff` | Sentinel; do not seed |
| SWI2 | `0xfff4` | `0xffff` | Sentinel; do not seed |
| FIRQ | `0xfff6` | `0xffff` | Sentinel; do not seed |
| IRQ | `0xfff8` | `0x65c4` | Genuine interrupt entry; seed and flag hardware dependence |
| SWI | `0xfffa` | `0xffff` | Sentinel; do not seed |
| NMI | `0xfffc` | `0xffff` | Sentinel; do not seed |
| RESET | `0xfffe` | `0x6000` | Genuine reset entry; previously validated |

IRQ code starts with bytes `f7 3c 00` at `0x65c4`: this is a strong
indication of a hardware-mapped write (`STB $3c00` on 6809). The classifier
never treats **any** IRQ entry as an independent pure function merely on the
strength of its vector. Only Ghidra-decoded graph data can provide additional
calls to leaf-routine candidates.

## What T2.B.6 implements

`ghidra_scripts/ExportFunctionGraph.java` now:

1. Reads all seven CPU vectors from the imported 6809 memory image, big-endian.
2. Seeds the bounded CFG traversal with valid targets; in this ROM, RESET and IRQ.
3. Follows decoded *direct* call targets and records the source call site.
4. Rejects the `0xffff` sentinel and avoids RAM/I/O entry points.
5. Limits discovery to 24 entries and 2,500 instructions per entry. Marks
   budget-truncated graphs as partial instead of complete.
6. Exports the vector table and per-function `direct_calls` with the existing
   P-code/CFG, skipped entries, and reasons.

`src/function_inventory.py` independently rereads the seven vectors from the
local flat ROM, confirms they match the Ghidra JSON, and checks **every**
exported instruction's bytes. It also rederives direct calls from decoded flow
classification and verifies Ghidra's call metadata when present. It **never**
scans unstructured ROM bytes for probable calls.

## What T2.B.7 implements

A deterministic shortlist ranks grounded entry points but blocks labels like
'eligible-for-codegen-review' when it sees:

- IRQ / RESET dependency; unproven manual seed; no verified export;
- direct or indirect callees; indirect/tail/external control flow;
- missing return boundary; incomplete or overlapping exported CFGs;
- unknown P-code operators, `SYNC`, or other unmodeled instructions;
- dynamic memory addresses where MMIO/bank access cannot be excluded;
- statically known MMIO/ROM stores or nondefault memory spaces.

Classification is a **review heuristic**, not proof of CPU semantic equivalence.
Leaf functions must additionally pass T2.B.8/B.9 codegen and independent tests.

## Run on the operator's Mac

Run the one command that already produces the existing IR, now with vector and
call discovery and inventory integrated:

```bash
git pull --ff-only
export GHIDRA_HOME="$(brew --prefix ghidra)/libexec"
bash scripts/functions-headless.sh "$PWD/roms/gng.zip"
```

Then inspect concise output:

```bash
python3 - <<'PY'
import json
from pathlib import Path
s = json.loads(Path('out/functions-shortlist.json').read_text())
for x in s['items']:
    print(x['entry'], x['classification'], ', '.join(x['review_blockers']))
print('shortlist ready:', s['acceptance_met'])
PY
```

To rebuild the inventory **without rerunning Ghidra**, provided the ROM image
and export have not changed:

```bash
python3 src/function_inventory.py \
  --input out/functions.raw.json --rom-image out/gngb-flat.bin \
  --out out/functions-inventory.json --shortlist out/functions-shortlist.json
```

**Evidence boundary:** The actual ROM vector values and the inventory logic
were validated locally. The upgraded Ghidra exporter needs a run on the
operator's Ghidra 12.1.4 installation to populate decoded call targets.
Until then we have one proven reset CFG and one ROM-backed IRQ **seed**, not
three verified independent routines. The shortlist can legitimately be PARTIAL.

## Next dependent block

T2.B.8 uses the produced inventory to pick genuinely bounded leaf functions
and implement only the P-code operators they require. T2.B.9 supplies
independent state vectors. Do not start hardware emulation or bypass unknown
MMIO semantics to force an artificial PASS.

## Ghidra Java compiler preflight (2026-10-12)

The B.6/B.7 exporter initially failed on Ghidra 12.1.4 because a local
JsonArray named calls collided with the ArrayDeque parameter calls
in exportSeed(). The subsequent ClassNotFoundException resulted from
the failed script compilation; it was not an installation issue.

The local JSON variable is now named directCalls, preserving the
direct_calls JSON field. CI now runs Java 21 javac against **minimal
tracked-in-Python API stubs** for both exporter scripts; a negative
regression verifies that the original name collision is rejected.
Run the same preflight locally with:

    python3 tests/test_java_preflight.py

This is a source-level Java preflight, **not** validation against the
actual Ghidra 12.1.4 JAR APIs or actual ROM execution. The latter
still requires the operator's Ghidra headless run.

## Operator validation of B.6/B.7 — October 12, 2026

The operator executed the Ghidra 12.1.4 exporter and ROM-authenticated
inventory after fixing the Java compile error. Actual terminal evidence:

```text
GNG_FUNCTION_EXPORT=PASS functions=3 skipped=0
GNG_FUNCTION_INVENTORY=PASS exported=3 calls=1 candidates=3
GNG_FUNCTION_SHORTLIST=PARTIAL candidates=2 eligible=0
GNG_FUNCTION_IR=PASS functions=3 generated=0 blocked=3
GNG_CODEGEN=BLOCKED generated=0
```

Real entries: RESET 0x6000, IRQ 0x65c4 and IRQ-called 0x65fb
(call site 0x65d1). All three exported graphs match local ROM bytes.
They are **not three independently validated leaf functions**.
The 0x65fb routine writes the bank-select register 0x3e00
(6809 instruction STA extended, bytes b7 3e 00), then dispatches
using an indirect jump (6e 95). It is not safe to compile as a
standalone pure function; the IRQ path also touches hardware. The
reported `LOAD: >32-bit` issue is only the *first* compiler blocker.

### Changes after operator run

- Triage now recognizes byte-verified decoded STA/STB extended to
  0x3e00 as `writes-bank-select-register: 0x3e00`.
- The P-code emitter excludes LOAD/STORE input[0] (address-space
  identifier metadata, occasionally an 8-byte constant) from its
  32-bit *data* width limit; actual addresses, values and results
  must still fit <=32 bits.
- Ghidra discovery now explicitly considers the next physical
  instruction after a decoded CALL when Ghidra has no explicit
  fallthrough. Such an edge is tagged
  `fallthrough_source: 6809-call-return-inferred`. The caller
  continuation is a candidate control-flow edge, not proof that
  a particular callee returns.

These fixes are tested synthetically; the improved call discovery
still needs validation on the operator's real Ghidra instance.
No hardware bypass, emulator dependency or behavioral equivalence
is claimed. Prioritize *other* genuinely isolated routines after
the next discovery run.

## Call continuation provenance hardening

Operator-validated T2.B.6/7 baseline: Ghidra exported 3 entries and one
direct call, while the shortlist contained zero eligible pure routines.
The post-CALL discovery extension is committed separately; its expanded
real-ROM result still requires Ghidra execution on the operator's Mac.

An inferred return-to-next-instruction has source
`6809-call-return-inferred`. The ROM-authenticated inventory now verifies
that the source instruction is a decoded CALL and the destination equals
its verified next byte boundary, and labels the owning graph
`call-return-continuation-unverified`. This provenance is preserved in
the normalized IR. Crucially it is not a proof of runtime callee return,
independent function bounds, or behavioral equivalence.

The bank selector `0x3e00` and indirect bank jumps remain blocked from
standalone code generation. Do not choose 0x65fb as an independent leaf.
