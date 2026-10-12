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
| Headless discovery of 3 **real ROM** functions | Run `scripts/functions-headless.sh` on Mac | PENDING |
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

**Evidence boundary:** The script-failure regression is tested without
redistributing ROMs. Real Ghidra 12.1.4 execution of this new exporter is
still pending on the operator's Mac; do not mark real-function discovery PASS
on the strength of synthetic fixtures or a successful ROM import.
