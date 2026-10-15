# T2.B — Function discovery and P-code IR

## What has been implemented

- **T2.B.1 Function discovery:** Ghidra 6809 headless exporter starts from `0x6000`
  or explicit entry addresses and follows direct call targets. Bounded at 12
  functions / 2,500 instructions per function; rejects unreachable RAM and
  invalid code. `out/functions.raw.json` preserves each instruction's ROM
  address, raw bytes, assembly, flows, fallthrough, P-code opcodes and **typed
  varnodes** (space, offset, size). Includes skipped entries and reasons.
- **T2.B.2 CFG/IR:** `src/function_ir.py` produces `gng.function-ir.v1`
  with block boundaries, direct flows, external edges, source provenance and
  bank-4-only context. Partial discovery is reported explicitly.
- **T2.B.3 Register and memory semantics:** `src/pcode_codegen.py` supports a
  strict subset of P-code operators, big-endian register aliasing, 8/16/32-bit
  arithmetic, typed RAM access, conditional branches and bounded loops.
  Unmodeled P-code/hardware/bank swaps/calls are rejected, not guessed.
- **T2.B.4 JS/TS generation:** eligible isolated functions are compiled to
  ordinary JavaScript/TypeScript using direct statements (not a 6809 opcode
  interpreter). Generated files and reasons for skipped functions are in
  `out/functions.report.json`. No Ghidra dependency at runtime.
- **T2.B.5 Verification:** three independent **synthetic** functions (memory
  write, bounded loop, big-endian word arithmetic) run in Node with strict
  TS type-checking. The previous **real ROM** bounded reset-loop proof still
  passes, and its Ghidra cross-check was run successfully on the user's Mac.

## Running on your Mac (real ROM)

```bash
cd ~/gng-ghidra/gng-ghidra # or your actual repository directory
export GHIDRA_HOME="$(brew --prefix ghidra)/libexec"
bash scripts/functions-headless.sh "$PWD/roms/gng.zip"
cat out/functions.report.json
```

Optional seed functions (addresses must be verified against the actual ROM):

```bash
bash scripts/functions-headless.sh "$PWD/roms/gng.zip" 0x6000 0x7000
```

The exporter will not assert that guessed addresses are valid functions. It
will only export entries Ghidra can decode and recognizes as functions.

## Acceptance gate: what is and is not demonstrated

| Gate | Evidence | Status |
|---|---|---|
| Real ROM initial loop -> JS | `src/poc.py` + Node test | PASS (previous work) |
| Real ROM reset P-code cross-check | Ghidra log supplied by operator | PASS (previous work) |
| Three distinct generic P-code routines | Synthetic fixtures + CI | PASS (synthetic only) |
| Headless recovery of one real ROM reset CFG | Operator Ghidra 12.1.4 `functions.raw.json` and `functions.report.json` | PASS (one CFG, full codegen blocked at SYNC) |
| Real ROM boot prefix `0x6000..0x6016` -> JS, memory invariant | Operator `GNG_REGION_CODEGEN=PASS` and `GNG_BOOT_PREFIX_MEMORY=PASS` | PASS (9 instructions, 384 bytes) |
| Headless discovery of 3 **distinct real ROM** functions | Additional verified seeds/call targets | PENDING |
| Three real function outputs with independent behavioral equivalence | Real 6809 reference tests / vectors | PENDING |

The extractor is exploratory: it may report zero generated functions because
of calls, hardware-specific instructions, dynamic banks, incomplete disassembly,
or unsupported P-code. This is **not** automatically a bug in the source ROM.
Check `out/functions.report.json` and `out/functions.raw.json` before changing
semantics. The result must not be described as a playable game or a fully
verified decompiler.

## Safety/limits

- A flat ROM image exposes **bank 4** at `0x4000–0x5fff`.
  Banks 0–3 are not modeled. Any conversion touching the bank-select register
  `0x3e00` cannot be considered hardware-correct without an explicit adapter.
- Memory at `0x3000–0x3fff` is I/O; generated functions refuse I/O reads and
  writes rather than silently manipulating a typed array. Writes to ROM fail.
- Calls, indirect jumps, unmodeled instructions and escapes from an isolated
  function block compilation. Step budgets prevent runaway loops.
- There is no MAME, video capture, screen scraping or gameplay recording.
- **Copyright:** ROMs/binaries and extracted graphics remain local and
  gitignored; CI exercises synthetic code only.

## Next actions after operator Ghidra run

1. Inspect any Java compile failures or function-discovery skips.
2. Prioritize only deterministic leaf routines with ROM-backed source and
   no hardware side effects. Add missing P-code operators only with tests.
3. Collect function-level reference vectors (inputs, register/memory outputs)
   to distinguish valid translation from mere successful compilation.

## Ghidra export troubleshooting (2026-10-12)

The initial headless wrapper allowed Ghidra to return exit status 0 without
producing `out/functions.raw.json`, so Python failed with `FileNotFoundError`
even though Ghidra's **ROM import**, not its Java exporter, had succeeded.

The wrapper now deletes stale exports, captures **full Ghidra output** at
`out/functions-ghidra.log`, demands an explicit
`GNG_FUNCTION_EXPORT=PASS/EMPTY` message **and** a nonempty JSON file,
and fails before invoking the normalizer when either is missing.

The extractor now traverses a bounded control-flow graph from reset (or
explicit seeds) instead of relying on `createFunction()` during `-noanalysis`.
It always serializes skipped discovery reasons when the Java script runs.

If the command fails on macOS, report only the diagnostic lines:

```bash
git pull --ff-only
export GHIDRA_HOME="$(brew --prefix ghidra)/libexec"
bash scripts/functions-headless.sh "$PWD/roms/gng.zip"
grep -iE 'error|exception|GNG_FUNCTION|compile|script' out/functions-ghidra.log | tail -40
```

**Evidence boundary:** Script-failure regression runs without distributing
ROMs. The operator has now executed Ghidra 12.1.4 successfully and recovered
one real ROM reset CFG. This does not establish three distinct real routines
or full-routine behavioral equivalence.

## Zero-P-code SLEIGH instructions (Ghidra 12.1.4)

Actual gngb reset path reaches address 0x6016 (hex byte 13, Motorola 6809 SYNC).
Ghidra's upstream 6x09.sinc defines SYNC with an empty SLEIGH
semantic body; it also defines NOP (hex byte 12) with an empty body.
The initial CFG exporter incorrectly threw Missing P-code at 6016.

**Contract:** Empty P-code never discards a whole discovered CFG.
Exported instructions include pcode_status:
- native: nonempty Ghidra P-code;
- verified-nop: byte 12, mnemonic NOP, empty P-code; safe JS no-op;
- unmodeled-wait-for-interrupt: byte 13, mnemonic SYNC; preserve in IR,
  block JS code generation pending interrupt/device model;
- unmodeled-empty-pcode: any other empty body; preserve, block codegen.

Exporter preserves graphs up to its instruction budget, then marks
truncated=true. Incomplete CFGs are not codegen eligible. The report
distinguishes GNG_FUNCTION_IR=PASS from GNG_CODEGEN=BLOCKED when the graph
is extractable but behavioral translation is unsupported.

Run on Mac:
```bash
git pull --ff-only
bash scripts/functions-headless.sh "$PWD/roms/gng.zip"
cat out/functions.report.json
```

A CODEGEN_BLOCKED mentioning SYNC is an expected safety limit, not
a completed translation of hardware behavior.

Source: https://github.com/NationalSecurityAgency/ghidra/blob/master/Ghidra/Processors/MC6800/data/languages/6x09.sinc

## Ghidra default RAM space normalization (2026-10-12)

The operator's real Ghidra 12.1.4 export contains typed P-code varnodes with
`space: "RAM"`. The first IR normalizer incorrectly accepted only lowercase
`ram`, so Ghidra's successful function export was discarded at normalization
with `Unsupported varnode space: RAM`.

The IR now canonicalizes only the four known default P-code spaces
(`const`, `ram`, `register`, `unique`) case-insensitively. It also
canonicalizes the default `LOAD`/`STORE` memory `space_name: "RAM"`
to `ram`. Unrecognized banks, overlays, and MMIO semantics are **not**
accepted silently; they remain rejected or blocked by code generation.

**No need to rerun Ghidra** when `out/functions.raw.json` was successfully
exported. After pulling, resume from the JSON directly:

```bash
git pull --ff-only
python3 src/function_ir.py --input out/functions.raw.json \
  --out out/functions.ir.json --report out/functions.report.json
cat out/functions.report.json
```

The normalizer can PASS even when code generation is BLOCKED for real CPU
semantics (SYNC, external control flow, hardware reads, etc.). Actual
behavioral equivalence of complete functions is not yet demonstrated.

## T2.B real-ROM `SYNC` boundary: verified executable prefix

The operator obtained `GNG_FUNCTION_EXPORT=PASS functions=1` and successfully normalized
the real ROM. Full function codegen correctly blocks at Motorola 6809
`SYNC` (`0x6016`), which waits for an interrupt and has no Ghidra P-code.

A separate *bounded region* compiler follows **actual Ghidra CFG edges** from
`0x6000` up to but not including the verified `SYNC` instruction.
Unknown paths, P-code operators, banks and truncated source graphs remain
blocked. It returns memory/register state and PC before that instruction,
not an emulation of the interrupt/wait state.

Run with the IR already extracted; no Ghidra rerun or MAME needed:

```bash
git pull --ff-only
python3 src/region_codegen.py --input out/functions.ir.json \
  --entry 0x6000 --stop-before 0x6016 --out out/generated
node scripts/verify-boot-prefix.mjs
```

The Node verifier checks the **384-byte sprite RAM initialization** at
`0x1e00..0x1f7f` and checks that no other memory changes.
The output report is `out/generated/boot-prefix.report.json` and explicitly
says `generated-not-equivalence-verified`.
A successful isolated prefix does not unblock full-game codegen, which
still requires modeled interrupt behavior.

## Operator-verified real-ROM prefix (2026-10-12)

Actual terminal output after updating to commit `ead21de`:

```text
GNG_REGION_CODEGEN=PASS entry=0x6000 stop_before=0x6016 instructions=9
GNG_BOOT_PREFIX_MEMORY=PASS steps=389 bytes_written=384 boundary=0x6016
```

This verifies the P-code-derived *region* codegen and its tested
384-byte sprite RAM memory effect in Node. The original full reset CFG
still returns `GNG_CODEGEN=BLOCKED` on `SYNC`. The segment stops before
`SYNC` rather than modeling an interrupt. See
[audit evidence](audit/t2b-boot-prefix-operator-evidence-2026-10-12.md).

**Next acceptance tasks:** discover and label candidate ROM routines using
grounded entry points (e.g. ROM reset/interrupt vector targets, validated
direct CALL destinations). Extract deterministic leaf functions, retain bank
identity, and obtain function-specific behavioral reference vectors. Do not
count additional segments of the same reset CFG as distinct functions.

## T2.B.6–7 status — ROM vector and decoded-CALL discovery

Implementation adds vector-seeded (RESET, IRQ) bounded Ghidra CFG discovery,
direct-call site provenance, a ROM-byte-matched function inventory, conservative
independent/leaf candidate selection, CI regression fixtures, and local JSON
reports (no ROM assets committed).

Confirmed from verified gngb ROM bytes: RESET 0x6000, IRQ 0x65c4; all other
vectors point to 0xffff sentinels. IRQ is a hardware-dependent handler, **not**
a verified pure leaf. Full call discovery and a 2–3 candidate shortlist still
require running updated Ghidra headless on the operator Mac.
A shortlist can remain PARTIAL and is never itself evidence of translation.

Run `bash scripts/functions-headless.sh "$PWD/roms/gng.zip"` then inspect
`out/functions-inventory.json` and `out/functions-shortlist.json`.
See [B.6–7 detailed design](t2b-discovery.md).

## T2.B.9 Round 1 — controlled execution harness (2026-10-13)

**Actual Ghidra/ROM result reported by operator:** the two real entrypoints
0x622c and 0x6755 passed the conditional DP/S analysis (3/3 and 5/5
addresses, respectively), and the experimental guarded JS generator
produced **two modules, zero blocks**. Their status is
`EXPERIMENTAL_NOT_EQUIVALENCE_VERIFIED`; there are no independent MC6809
state vectors yet.

`scripts/verify-guarded-functions.mjs` now executes those *existing*
generated modules under three deterministic synthetic input states per
routine (low/mid/high safe stack address). It checks:
- the generated module's SHA-256 matches the manifest, and each module
  corresponds to the expected entry point and DP/S contract;
- exactly bounded execution returning at the known source `RTS`
  instruction (0x6238 or 0x6771; this is NOT the CPU return PC);
- registers, memory, steps and output fingerprints are reproducible;
- no writes to MMIO/ROM (0x3000 and above);
- the caller's memory/register arrays remain unchanged, including
  when a contract fails;
- malformed DP/S inputs are rejected before mutation.

The synthetic inputs are *not* sampled from the actual game's runtime.
The harness does not compare against an independent MC6809 reference and
must never report behavioral equivalence.

Run in the repository directory (no new Ghidra execution):

```bash
git pull --ff-only
python3 src/guarded_codegen.py
node scripts/verify-guarded-functions.mjs
cat out/generated-guarded/verification-report.json
```

Expected stdout marker if and **only if** the two real compiled modules
complete all three controlled cases and reject invalid conditions:

```text
GNG_GUARDED_HARNESS=PASS_JS_CONTROLLED_ONLY routines=2
GNG_6809_EQUIVALENCE=NOT_ESTABLISHED synthetic inputs; no native CPU oracle
```

The harness writes detailed synthetic input seeds, stack values,
changed-memory/register offsets, steps and SHA-256 output-state
fingerprints into `out/generated-guarded/verification-report.json`.
If a real routine fails, the harness writes a failure reason, returns
nonzero and leaves T2.B.9 open. No ROM or extracted memory content
is committed to the repository.

**Next rounds:** obtain independently reproducible MC6809 state vectors
for each candidate, compare *all* registers, memory effects, stack
transitions and control-flow/return semantics, and only then claim
equivalence. A third leaf candidate is still required. Full game
porting, IRQ, MMIO, dynamic banks and sound are outside this gate.


## T2.B.9 safety correction — direct RAM varnodes (October 13, 2026)

The operator's real guarded JS execution FAILED:
- `0x622c`: `Direct RAM varnode read not implemented; use LOAD`.
- `0x6755`: `Invalid register write`.

This is not just a missing JS emitter feature. Native Ghidra P-code
may encode concrete memory accesses as **direct RAM-space varnodes**,
not only `LOAD`/`STORE` operations. Previous 3/3 and 5/5 conditional
bounds were therefore **incomplete access inventories**.

Independent instruction bytes already recorded for the matching ROM
indicate `LDA $3003`, `LDA $3004` in `0x622c` and stores to
`$3d00`, `$3b09`, `$3b08` in `0x6755`. These addresses fall in
the project's forbidden I/O window `0x3000..0x3fff`. Do not call
these routines hardware-independent RAM leaves.

The shared `src/pcode_memory_sites.py` now enumerates both explicit
and direct-varnode memory data accesses. Control-flow target varnodes
to BRANCH/CBRANCH/CALL/RETURN are **not** counted as data accesses.
`memory_analysis.py`, `memory_contracts.py`, and
`memory_provenance.py` share this inventory. The compiler can emit
direct RAM reads/writes through the existing guarded helpers, but the
**pure** `guarded_codegen.py` blocks any unmodeled I/O access.

Recompute the real-ROM inventory without rerunning Ghidra:

```bash
git pull --ff-only
python3 src/memory_contracts.py --entries 0x622c 0x6755
python3 src/guarded_codegen.py
```

The local ROM/Ghidra export determines the exact access counts.
`GNG_GUARDED_CODEGEN=EXPERIMENTAL generated=0 blocked=2` is a
**correct fail-closed result** if the known MMIO operands are present.
The previous `generated=2` does not constitute equivalence.

Next: either select RAM-only leaf candidates, or introduce a separate
explicit, narrowly allowlisted I/O port adapter for test fixtures with
recorded reads/writes and a 6809 differential oracle. Never silently
treat I/O as ordinary RAM to force a PASS. T2.B.9 remains open.

## T2.B.9-A/B — board-aware experiment

The real-ROM memory audit established 3/5 and 5/10 conditionally RAM-safe
memory sites. The remaining seven are fixed MMIO accesses. The pure codegen
gate correctly refuses them. See the [board-aware experimental plan](t2b-board-io.md)
for the separate 7-site allowlist, generated JS event-trace semantics,
real-ROM operator commands and pending MC6809 differential acceptance gate.

## T2.B.9-C — Independent MC6809 differential integration

A separate pinned external MC6809 C++ instruction engine is now
compiled in a ROM-free CI smoke job. The test-only adapter and Node
differential checker compare real CPU instructions (from the owner's
local 64 KiB ROM image) against compiled P-code JS. The operator's
real-ROM comparison is still pending; no behavioral equivalence is
claimed. See [differential verification](t2b-mc6809-differential.md).
