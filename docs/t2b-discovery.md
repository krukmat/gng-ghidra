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

## Operator result after call-continuation update; targeted diagnosis

The operator re-ran Ghidra 12.1.4 and again obtained
`exported=3 calls=1`, with an empty eligible shortlist.
The resulting `0x65fb` uses bank selection and `BRANCHIND`,
so it remains unsafe as a pure leaf.

The ROM bytes **after the verified Ghidra call at `0x65d1`** contain
seven consecutive `BD xxxx` Motorola 6809 JSR-extended patterns,
at `0x65d3, 0x65d6, 0x65d9, 0x65dc, 0x65df, 0x65e2, 0x65e5`.
These indicate *syntactic call candidates* to 0x6755, 0x6772,
0x622c, 0x7930, 0x67b3, 0x6239, and 0x6274.
They are **not confirmed reachable instructions**: the earlier BSR
may not return, and the Ghidra CFG stopped before decoding them.

The extractor now gives decoded call continuations priority in the
bounded work queue and reports which ones were not recovered.
The byte-backed inventory additionally performs a **strict, bounded
three-byte JSR probe** starting only at the next instruction after a
*Ghidra-decoded* CALL, never an arbitrary ROM scan. Probes:
- retain raw bytes and the decoded parent call-site provenance;
- remain tagged `execution_proven=false`, `ghidra_disassembly_verified=false`;
- are not counted as confirmed direct calls or eligible pure functions;
- appear in `anchored_jsr_probes` and as optional candidates in the
  local inventory, even if the previous Ghidra CFG missed them.

When the existing `functions.raw.json` exists, the operator can generate
the probe inventory **without running Ghidra**:

```bash
git pull --ff-only
python3 src/function_inventory.py --input out/functions.raw.json \
  --rom-image out/gngb-flat.bin \
  --out out/functions-inventory.json --shortlist out/functions-shortlist.json
```

The corresponding Ghidra rerun is required **only** to validate the new
work-queue priority and discover the candidate functions themselves.

## Real-ROM repeat: still 3 entries; Ghidra-anchored JSR verification

The operator repeated the full Ghidra 12.1.4 headless run on the
call-continuation-priority build. The result **remained** three
exported entries, one decoded direct call and zero eligible leaf
routines. The ROM-only inventory also printed no
`GNG_ANCHORED_JSR_PROBES` line.

Direct byte inspection of the *matching local* gngb bank-4 flat image
confirms seven contiguous MC6809 `BD xxxx` encodings at
`0x65d3..0x65e7`. The absence of ROM-only probes means the old
probe's `decoded_sites` suppression rule or the anchor/continuation
classification prevented output; the prior log does not distinguish
these conditions. **Do not report the calls as proven execution edges.**

The exporter now independently asks Ghidra to disassemble each
three-byte `JSR` after a **decoded** call anchor. It verifies the
mnemonic, instruction size, Ghidra flow type, and flow destination
against the encoded ROM target. Results appear in
`anchored_verified_calls` or `anchored_rejected_probes`;
the console prints `GNG_ANCHORED_JSR_VERIFIED` or
`GNG_ANCHORED_JSR_REJECT`. Confirmed targets can become bounded
export seeds, but the originating call's return behavior remains
unverified. No Ghidra or synthetic stub tests assert a playable game.

The inventory independently rechecks the 0xBD opcode, target word,
verified call anchor and 3-byte alignment in the ROM. Verified anchored
candidates are **not** counted as pure functions: the shortlist
retains `anchored-call-return-not-verified` among its blockers.
The result also reports
`GNG_GHIDRA_ANCHORED_JSR=REVIEW verified=N rejected=M`,
including rejection reasons.

To validate with real Ghidra:

```bash
git pull --ff-only
bash scripts/functions-headless.sh "$PWD/roms/gng.zip"
grep -E 'GNG_ANCHORED_JSR|GNG_FUNCTION_EXPORT' out/functions-ghidra.log | tail -40
cat out/functions-shortlist.json
```

Ghidra's script compilation/execution still must run on the Mac.
Java preflight stubs and synthetic inventory regression tests pass in CI.

## Operator repeat: seven anchored JSRs rejected (2026-10-12)

The operator ran Ghidra 12.1.4 and observed seven anchored JSR candidates
rejected at 0x65d3, 0x65d6, 0x65d9, 0x65dc, 0x65df, 0x65e2, and 0x65e5.
The console showed `anchored_verified=0 anchored_rejected=7`. These results
are **not** seven proven calls. Full JS codegen remains blocked as before.

Previously, anchored validation used `Listing.getInstructionAt()`, optionally
followed by `GhidraScript.disassemble()`, and then `getFlows()` from the
installed listing instruction. Under `-noanalysis`, existing/overlapping code
units or unavailable flow references can make that test reject an otherwise
valid 6809 encoding. The operator's log did not include rejection reasons.

The new probe instead uses Ghidra's `PseudoDisassembler.disassemble(Address)`
with the current program's language and memory, independent of installed code
units. It validates the three-byte `JSR` instruction and its decoded default
flow target against the 16-bit ROM word. The output independently records
`listing_matches` and `decode_backend=ghidra-pseudo-disassembler`. Any
failure is logged with the actual reason and mnemonic/length/flow, and remains
rejected. Even pseudo-verified instructions are **not** proof of dynamic
reachability or a returning callee. The actual function export still needs
Ghidra to disassemble target routines; unsafe bank hardware stays blocked.

Repeat on operator's Mac:

```bash
git pull --ff-only
python3 tests/test_java_preflight.py
bash scripts/functions-headless.sh "$PWD/roms/gng.zip"
grep -E 'GNG_ANCHORED_JSR|GNG_FUNCTION_EXPORT|GNG_FUNCTION_SHORTLIST' \\
  out/functions-ghidra.log | tail -50
```

A Java-stub CI pass is not a real Ghidra runtime test.

## Root cause verified: 6809 extended JSR is COMPUTED_CALL in Ghidra

Operator's Ghidra 12.1.4 output verified all seven candidate instructions
as three-byte `JSR 0xNNNN`, but marked every one `COMPUTED_CALL` with
`target_matches=false` when querying `getDefaultFlows()`. This is
consistent with the upstream Ghidra 6809 SLEIGH source:

- `OP2J: imm16` uses `export *[const]:2 imm16`;
- `JSR OP2J` uses `call [target]` and thus produces an indirect call P-code
  rather than a declared direct address edge.

Source: https://github.com/NationalSecurityAgency/ghidra/blob/master/Ghidra/Processors/MC6800/data/languages/6x09.sinc

**Correction:** For a Ghidra pseudo-decoded 6809 `JSR` whose first byte
is exactly `BD`, length exactly three, and flow type computed-call,
if no concrete default target exists, derive the statically encoded
16-bit target from the two following bytes. This rule does **not** apply
to the indexed/direct JSR forms. If Ghidra provides a conflicting
concrete target, the instruction stays rejected. The JSON now records
`target_resolution=6809-jsr-extended-operand`,
`target_from_isa_encoding=true`, `ghidra_flow_type=COMPUTED_CALL` and
`return_semantics_verified=false`. The Python inventory rejects claims
missing or mislabeling that provenance and independently checks the ROM
opcode and address operand.

This proves ISA decoding plus an explicit target interpretation, **not**
that the previous BSR returns, that a candidate is reachable or that a
hardware/banked function is safe to compile. New function bodies must
still be recovered and independently tested.

Mac acceptance:

```bash
git pull --ff-only
python3 tests/test_java_preflight.py
bash scripts/functions-headless.sh "$PWD/roms/gng.zip"
grep -E 'GNG_ANCHORED_JSR|GNG_FUNCTION_EXPORT' out/functions-ghidra.log | tail -40
```

## Real Ghidra validation of seven JSR instruction sites (2026-10-12)

The operator's Ghidra 12.1.4 headless run resolved **seven** previously
rejected `JSR` sites using the MC6809 extended-instruction target encoding.
Actual terminal output:

```text
GNG_ANCHORED_JSR_VERIFIED=0x65d3 target=0x6755
GNG_ANCHORED_JSR_VERIFIED=0x65d6 target=0x6772
GNG_ANCHORED_JSR_VERIFIED=0x65d9 target=0x622c
GNG_ANCHORED_JSR_VERIFIED=0x65dc target=0x7930
GNG_ANCHORED_JSR_VERIFIED=0x65df target=0x67b3
GNG_ANCHORED_JSR_VERIFIED=0x65e2 target=0x6239
GNG_ANCHORED_JSR_VERIFIED=0x65e5 target=0x6274
GNG_FUNCTION_EXPORT=PASS functions=14 skipped=0 anchored_verified=7 anchored_rejected=0
```

Each site reported `listing_matches=true`,
`resolution=6809-jsr-extended-operand`, and
`reachability=unverified`. Therefore these are proven
**static JSR encodings and destinations**, not evidence of seven
dynamically executed calls or fourteen independent routines.

### Separate independent-callee safety from caller reachability

Previously, any callee with an anchored incoming `JSR` was blocked
because the caller's runtime return behavior had not been verified.
That conflated entry *reachability* with isolated *callee safety*.

The inventory now records `anchored-call-reachability-unverified`
as an `evidence_caveats` item instead of a callee `review_blocker`.
All callee-specific restrictions remain unchanged: missing returns,
incomplete/overlapping CFGs, unsupported P-code, unresolved calls or
branching, dynamic/unsafe memory, bank selection, MMIO, and incorrect
bank context. This is a triage distinction, **not** permission to
claim executed calls, drop MMIO restrictions, or consider a routine
behaviorally equivalent.

The latest operator run does not include the complete shortlist or
codegen report, so the number of eligible independent routines is
**not established** yet.

The top-three shortlist can hide other candidates. The new
`scripts/triage-functions.py` prints every currently discovered entry,
its provenance, CPU/flow blockers and compiler failure. It requires no
new Ghidra execution:

```bash
git pull --ff-only
python3 src/function_inventory.py --input out/functions.raw.json \
  --rom-image out/gngb-flat.bin --out out/functions-inventory.json \
  --shortlist out/functions-shortlist.json
python3 scripts/triage-functions.py
```

T2.B.6 is verified for the expanded discovery; T2.B.7 remains open
until actual complete leaf candidates and independent behavioral
reference vectors are available.

## T2.B.7 — Per-instruction memory-address proof (2026-10-13)

The operator's updated ROM-authenticated inventory exports **14** roots,
**seven** Ghidra-confirmed anchored JSR sites and **zero** routines eligible
for isolated codegen. Nine candidates have only one common blocker:
`dynamic-memory-address: needs-MMIO-and-bank-proof`.

**Root cause:** The old heuristic marked *every* non-constant P-code
LOAD/STORE address unsafe, without recording its instruction address,
value width, or address provenance. Yet some dynamic addresses may be
provably within safe RAM (e.g. 8-bit pointer or 16-bit pointer masked
with `INT_AND 0x1fff`). Others, such as a raw 16-bit X/Y/S/U pointer,
can address MMIO, ROM or RAM and MUST remain blocked.

The new `src/memory_analysis.py` computes a conservative abstract
interval for each LOAD/STORE pointer, scoped to the current Ghidra
instruction. Supports constants, bounded register widths, COPY,
INT_ZEXT, constant-mask INT_AND and non-overflowing addition/subtraction.
Unknown arithmetic/overflows/overwrites fail closed. It never infers
machine hardware state, register initial values or inter-instruction
dataflow. The audit classifies safe RAM/ROM reads separately from
unresolved pointers, ROM writes and MMIO. The inventory removes the
*dynamic address review blocker* **only if every dynamic access is
provably within an allowed range**. Other blockers remain intact.
Codegen already has runtime MMIO/ROM guards; this is only
`eligible-for-codegen-review`, not functional equivalence.

To get instruction-level evidence without another Ghidra run:

```bash
git pull --ff-only
python3 src/function_inventory.py --input out/functions.raw.json \
  --rom-image out/gngb-flat.bin --out out/functions-inventory.json \
  --shortlist out/functions-shortlist.json
python3 src/memory_analysis.py
python3 scripts/triage-functions.py
```

`out/functions-memory-audit.json` lists every memory operation with
source address, assembly, P-code index, pointer varnode and safe/unsafe
range. `memory=N/M` in the triage output reports proven-safe memory
operations versus all accesses. **Do not change the IO bounds or treat
an unknown 16-bit pointer as RAM to force a passing status.**

## Operator: 14 functions, 217 memory operations, 0 statically safe

The operator ran the memory audit on the 14 Ghidra-exported ROM entry
graphs and reported **217 LOAD/STORE operations**, with **zero**
statically proven safe. This is a limitation of the available
context-sensitive proof, not evidence that all accesses touch hardware.
In particular, unknown 16-bit register pointers span RAM, I/O, and ROM;
the strict memory filter rightly refuses to make them safe by default.

To find the actual missing preconditions, a diagnostic-only
`src/memory_provenance.py` has been added. It follows register/unique
dependencies **within each decoded instruction**, using the
upstream Ghidra MC6809 SLEIGH register offsets (S at 24, X at 18,
Y at 20, U at 22, all 2 bytes). It labels stack-pointer-dependent
accesses separately from index pointers, mixed expressions, memory
derived pointers, literal addresses and unknown unique temporaries.
It does not propagate values across instructions, and does not infer
register initialization from the ROM, stack bounds, dynamic
reachability, or behavioral equivalence. Existing memory safety gates
are entirely unchanged.

Ghidra SLEIGH source:
https://github.com/NationalSecurityAgency/ghidra/blob/master/Ghidra/Processors/MC6800/data/languages/6x09.sinc

Get a concise per-function register fingerprint **without a new Ghidra
run**:

```bash
git pull --ff-only
python3 src/memory_provenance.py \
  --entries 0x622c 0x6755 0x7930 0x6793 0x6839
```

The script writes
`out/functions-memory-provenance.json` and prints pointer-origin
groups and one sample instruction for each group. It also validates
the Ghidra bytes and vector table against the operator's local flat
ROM. Use the grouping to decide whether the next step is an explicit
stack-domain contract or an index/memory-map adapter. Do not approve
all 217 accesses merely because they have identifiable source
registers. The full 6809 `RTS` P-code includes stack activity, so
a safe stack contract will be necessary for full routine translation.

## T2.B.7 — Conditional DP/S memory proof obligations (2026-10-13)

The actual Ghidra memory provenance diagnosis covered five short
ROM routines, 43 memory accesses, and zero unconditionally safe:
- 0x622c: two DP-based direct-page accesses, one S-based RTS stack read
- 0x6755: four DP-based accesses, one S-based RTS stack read
- 0x7930: three DP, one X, one S access
- 0x6793: nine X, two U, two S accesses
- 0x6839: two DP, fourteen X, one S access

We therefore prioritize the first two candidates. Ghidra's ordinary
MC6809 SLEIGH source defines DP at register byte 9 and S at byte 24
(two bytes). Direct page effective addresses use
\`(zero_extend(DP) << 8) + imm8\`; RTS loads a 16-bit return address
from S, then advances S by two.

\`src/memory_contracts.py\` evaluates each P-code memory pointer under
a deliberately **illustrative hypothesis**:
\`DP == 0x00\`, \`0x0100 <= S <= 0x2ffc\`
at **every instruction**. It recognizes bounded zext/left-shift,
integer addition/subtraction without wrap, copies, constant masks
and pair concatenations within one instruction. Writes to overlapping
register bytes invalidate the assumed range. Unmodeled operations,
16-bit X/U pointers, alias writes, wrapping and MMIO/ROM writes fail
closed. This is a conditional *what-if* report, NOT a function safety
proof. Assumptions may be invalidated by prior instructions or calls;
they are not inferred from the real game. The existing unconditional
inventory/codegen safety checks remain unchanged.

Run with existing raw Ghidra export and ROM image, without Ghidra:

\`\`\`bash
git pull --ff-only
python3 src/memory_contracts.py --entries 0x622c 0x6755
\`\`\`

\`out/functions-memory-obligations.json\` includes all P-code accesses,
effective-address intervals and unresolved proof obligations. A
\`hypothetical_in_range=N/M\` result means **only** that if the
invariants hold at every instruction, those N accesses are bounded.
It is NOT \`eligible_for_codegen_review\` and is NOT behaviorally
equivalent to original MC6809 execution.

Next engineering step: validate actual DP and stack state at routine
entry and through its control-flow, or implement guards enforcing the
contract during execution; then validate return behavior against
independent reference state vectors. Do not assume DP=0 solely because
a direct-page operand appears in disassembly. Unknown X/U memory
remains excluded from these two contracts.
