# T2.B.9-C — Native independent MC6809 differential gate

## State

- The owner validated the **real ROM-derived board-aware JS** on both
  0x622c and 0x6755: 2 generated; 0 blocked;
  3 controlled cases and 3 rejected invalid cases per routine.
  `PASS_BOARD_JS_ONLY` is **not** MC6809 equivalence.
- A **test-only CPU reference** now builds an independent, pinned open-source
  MC6809 instruction implementation: [elmerucr/mc6809](https://github.com/elmerucr/mc6809)
  at commit `5bad24375961418d6591491929aea1f4dc8cb90f`.
  It is not a product dependency and is never linked to generated JS.
- Its test harness exposes precisely seven ROM-audited MMIO port sites
  and rejects any other accesses. Port semantics are **not simulated**:
  two DSW values are injected and five board writes are recorded.
- A ROM-free GitHub Actions smoke test compiles the actual upstream C++
  implementation and executes a short **synthetic** MC6809 routine. This
  is an integration smoke test, not verification of the game ROM.

## Operator: verify real ROM without rerunning Ghidra

From the repository root on macOS, with Xcode Command Line Tools, Git
and Node 22 (or compatible versions):

```bash
git pull --ff-only
python3 src/board_codegen.py
node scripts/verify-board-functions.mjs
bash scripts/build-mc6809-oracle.sh
node scripts/compare-mc6809.mjs
cat out/generated-board/differential-report.json
```

The build script pins and verifies a specific upstream commit and builds a
standalone C++ test binary in the ignored `out/native-oracle/` directory.
It **does not download a game ROM**. The JS generator verifies the local
Ghidra instruction bytes against `out/gngb-flat.bin`; the board manifest
includes that ROM's SHA-256. The differential harness rejects any image
whose SHA-256 differs. No game ROM, CPU state or user traces are committed.

Possible markers:

- `GNG_NATIVE_BUILD=PASS`: verified upstream CPU library builds.
- `GNG_MC6809_DIFFERENTIAL=PASS_DIFFERENTIAL_TEST_VECTORS`: both
  ROM-derived JS functions matched the independent CPU across all
  six **synthetic initial states**. This is not runtime reachability.
- `GNG_MC6809_DIFFERENTIAL=MISMATCH_OR_BLOCKED`: mismatched state,
  event trace, control flow, memory or an unsupported opcode.
  **Do not** change CPU expectations to make this green; fix the P-code
  compiler or document a genuine hardware semantic discrepancy.
- `GNG_MC6809_DIFFERENTIAL=BLOCKED`: missing native build, ROM digest,
  invalid provenance or manifest; see the JSON report.

The comparator always writes
`out/generated-board/differential-report.json` with per-case details,
including first mismatching registers, flags, RAM/stack bytes and
ordered board I/O events.

## How independence is enforced

1. Generated JS is emitted from ROM-authenticated Ghidra P-code in Python.
2. The native CPU engine is independent C++ source from a third party,
   independently fetched and pinned, *not* a second P-code interpreter.
3. Initial RAM/register buffers are independently initialized by the
   same specified xorshift32 byte-vector contract. An injected stack
   return address `0x7000` allows precise end-of-routine detection.
4. The C++ core executes actual opcode bytes from the local 64 KiB ROM
   image, one instruction at a time, and stops after the real RTS.
5. The comparator verifies A, B, CC, DP, X, Y, U, S; the generated
   routine's source RTS; the CPU's architectural return PC; instruction
   count; ordered board events (instruction PC, address, byte width,
   direction, value); and every RAM/stack change below `0x3000`.
   A different PC representation on the JS side is **not** silently
   compared as equal to the native CPU PC.
6. Unknown ports, ROM writes, stack contract violations, altered
   manifests, extra/missing port reads and mutated caller buffers fail.

The pinned library documents a known typo in its `set_dr` setter;
the adapter uses `set_ac` and `set_br` separately. `CWAI` is not
implemented by this external CPU library, so any tests covering
`CWAI` remain outside the scope. These two selected routines have
no claim of reaching such instructions.

## Scope remaining after first differential PASS

A passing differential across six contrived states proves those
cases only; it does **not** establish that `DP=0` and
`0x0100<=S<=0x2ffc` hold in actual game execution, or prove bank,
IRQ, sound, sprites, timing, and full-game behavior. T2.B closure
still requires a third genuine routine and verified runtime entry
conditions, or an explicitly documented narrower acceptance criterion.


## Operator's genuine ROM differential result — October 15, 2026

The independent, third-party MC6809 CPU test **passed on the actual
local ROM**, with synthetic initial states: `0x622c` had 3/3 matched
vectors and `0x6755` had 3/3. Both generated without static board
MMIO blockers. This is a **verified six-vector differential result**,
not exhaustive equivalence and not evidence of actual game entry states.
See [operator evidence](audit/t2b-mc6809-operator-evidence-2026-10-15.md).

The differential suite now includes **60 deterministic vectors per
routine** (boundary stacks, port extremes and seeded register/RAM
states). These expanded real-ROM runs are still pending operator
execution. The third-candidate ROM-backed triage is available through:

```bash
git pull --ff-only
python3 src/board_codegen.py
node scripts/compare-mc6809.mjs
python3 src/third_routine_candidates.py --limit 8
```

The final command reuses `out/functions.raw.json` and
`out/gngb-flat.bin`; it does not rerun Ghidra or expose the ROM.
It writes `out/third-routine-candidates.json` (gitignored).
`POTENTIAL_CONDITIONAL_PURE_LEAF` is **not** a proof: the tool
requires native RTS P-code S-pop evidence, checks Ghidra graph
overlap, and marks unproven decoded-call reachability separately.
