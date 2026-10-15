# T2.B.9-A/B — Board-aware MMIO P-code experiment

## Purpose and evidence boundary

This is an experimental **transpiler extension**, not a 6809 emulator.
Two routines generated from the owner's byte-matched `gngb` ROM
depend on hardware I/O. The existing pure `guarded_codegen.py` correctly
rejects them; its eligibility is **unchanged**.

Real Ghidra/ROM memory audit provided by the operator:

| Entry | Conditional RAM/stack sites | Fixed MMIO sites | Pure eligibility |
| --- | ---: | --- | --- |
| 0x622c | 3 | READ 0x3003 at 0x622c; READ 0x3004 at 0x6232 | BLOCKED |
| 0x6755 | 5 | WRITE 0x3d00 at 0x6759; 0x3b09 at 0x675e; 0x3b08 at 0x6761; 0x3b0b at 0x676b; 0x3b0a at 0x676e | BLOCKED |

The labels here identify *address/direction/width*, **not** verified
functional meanings of DIP switches, graphics scroll registers or other
real-world board operations.

`src/board_codegen.py` is a separate **board-aware** compilation gate.
It uses the same ROM-authenticated Ghidra P-code, normalized typed IR,
and conditional DP/S hypothesis as pure compilation, with an exact MMIO
allowlist tied to source-PC, direction, address and width. All five
static RAM/stack sites in 0x6755 and three in 0x622c must remain
conditionally bounded. There is no implicit permission to access any
other MMIO location. Unknown memory sites, widths, changed access
counts, unsupported P-code, partial CFG, or ROM verification failure
block generation. All memory accesses remain guarded at runtime.
ROM writes are forbidden.

The conditional contract is **illustrative only**:
DP=0, 0x0100 <= S <= 0x2ffc, checked on entry and before every memory
operation. We have NOT proved that actual execution satisfies this
precondition, nor that it suffices for arbitrary caller state.

## Execution model (zero implicit hardware emulation)

Output is a standalone `board_<entry>.mjs` with:

```js
runRoutine(memory, registers, maxSteps, ioReads)
```

- `memory` is a caller-owned 65,536-byte buffer; `registers` is a
  256-byte byte-addressed Ghidra register file. Both are copied before
  executing the generated core, including rejection paths.
- `ioReads` is an **exact ordered array** of `{addr,size,value}`.
  For `0x622c`, pass the values of addresses `0x3003` and `0x3004`
  (each width 1); for `0x6755`, pass `[]`. Any missing, extra,
  reordered, wrong-sized or out-of-range input is rejected.
- `memRead` and `memWrite` continue to access normal RAM. Only
  exact whitelisted I/O sites may invoke `readBoard`/`writeBoard`.
  An I/O write **does not write the memory buffer**; it adds a recorded
  effect to `ioTrace`. An I/O read consumes one injected value and
  records it. No timers, sprites, registers or other board state is
  simulated.
- The returned `{registers,memory,steps,pc,ioTrace}` includes all
  observed I/O effects, including their order, source instruction PC,
  address, direction, width and byte value. A `RETURN` checks that
  there are no unused read inputs. The `pc` is the source RTS
  instruction address, **not** the CPU return target.

The source is compiled P-code operations, not an interpreter or
hard-coded imitation of those routines. A future native 6809 reference
may compare byte-level effects against the identical injected port
reads. If that reference shows mismatches in stack, flags, PC, memory
or MMIO order, T2.B.9 remains blocked.

## Operator: regenerate and exercise real ROM-derived board modules

Use your **existing local** byte-matched `out/functions.raw.json`
and `out/gngb-flat.bin` (Ghidra does not need to be rerun).

```bash
git pull --ff-only
python3 -m unittest discover -s tests -v
python3 src/board_codegen.py
node scripts/verify-board-functions.mjs
cat out/generated-board/verification-report.json
```

Expected **only if actual P-code compiles and runs successfully**:

```text
GNG_BOARD_CODEGEN=EXPERIMENTAL generated=2 blocked=0
GNG_BOARD_HARNESS=PASS_BOARD_JS_ONLY routines=2
GNG_MC6809_EQUIVALENCE=NOT_ESTABLISHED no independent CPU reference
```

If actual Ghidra P-code contains unsupported semantics, access paths,
or byte mismatches, the generator/harness will fail explicitly. Do not
report the synthetic CI PASS as a real-ROM PASS. Inspect:

- `out/generated-board/report.json` for blocked compilation.
- `out/generated-board/verification-report.json` for ordered I/O
  traces, register/memory deltas, replay hashes, individual failures.

The report and all ROM-derived data are inside ignored `out/`.
Do not commit the ROM, memory contents, generated code or vectors.

## Acceptance gates and next stages

1. **T2.B.9-A** (code): exact 7 MMIO sites; static whitelist,
   unrecognized sites rejected; independent pure-codegen still blocked.
   CI uses ROM-free synthetic byte-matched fixtures.
2. **T2.B.9-B** (code): two board modules generated, input injection,
   ordered writes, protection on invalid calls, replay and hashes;
   then owner validates against the actual ROM/Ghidra export.
3. **T2.B.9-C** (pending): establish a separate MC6809 oracle and
   compare complete register state (including CC, DP, PC, S),
   RAM/stack effects, return behavior and ordered port operations.
   JS-only self-replay is **not** independent behavioral equivalence.
4. **T2.B.10** (pending): select/certify a third genuine routine and
   close the initial translation gate. Banks, interrupts, IRQ timing,
   sprites, sound and full-game functionality remain later milestones.

CI has no proprietary ROM and must not claim to exercise `gngb`.
