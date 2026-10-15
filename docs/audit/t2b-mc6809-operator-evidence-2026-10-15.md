# T2.B.9-C — Native Motorola 6809 differential (operator evidence)

Date: 2026-10-15
Location of evidence: operator's private Mac checkout, not in GitHub
ROM custody: operator local only; game image not committed or redistributed
Reference implementation: independently compiled C++ elmerucr/mc6809 pinned
at commit `5bad24375961418d6591491929aea1f4dc8cb90f`

## Received terminal evidence

After real-ROM-based Ghidra export and board-aware generation:

```text
GNG_BOARD_CODEGEN=EXPERIMENTAL generated=2 blocked=0
  0x622c board=out/generated-board/board_622c.mjs equivalence=UNVERIFIED
  0x6755 board=out/generated-board/board_6755.mjs equivalence=UNVERIFIED
GNG_T2B_ACCEPTANCE=NOT_ESTABLISHED no independent 6809 CPU reference
GNG_NATIVE_BUILD=PASS oracle=out/native-oracle/mc6809-reference provider=elmerucr/mc6809 commit=5bad24375961418d6591491929aea1f4dc8cb90f
GNG_MC6809_DIFFERENTIAL=PASS_DIFFERENTIAL_TEST_VECTORS
  0x622c vectors=3 matched=3 failed=0
  0x6755 vectors=3 matched=3 failed=0
GNG_MC6809_DIFFERENTIAL_REPORT=<operator-local-path>/out/generated-board/differential-report.json
GNG_REAL_GAME_ENTRY_STATES=UNPROVEN
```

The 39 Clang `unused parameter 'ea'` warnings were emitted from the
external unmodified C++ CPU implementation and did not fail compilation.
The pinned builder now suppresses only the harmless unused-parameter
warning (`-Wno-unused-parameter`), preserving `-Wall -Wextra`.

## Assessment

**Verified on actual game opcode bytes, synthetic initial states**:
- The board-aware P-code JS for 0x622c and 0x6755 generated successfully.
- Both routines matched an independent native instruction engine on
  three deterministic seed/stack states each: six differential executions.
- A/B/CC/DP/X/Y/U/S, S-pop/return-PC boundary, byte-for-byte RAM/stack
  deltas, and the ordered 2-read/5-write MMIO effects were compared
  by the test harness under the stated model.
- No discrepancies appeared in those six vectors.

**Not established**:
- These synthetic entry states actually occur during play.
- The inferred CALL chain is dynamically reachable.
- Actual board signal timing, IRQ/banking and non-I/O hardware semantics.
- Exhaustive CPU/P-code equivalence or entire-game behavior.
- A third independent ROM routine.

The generator's own marker `GNG_T2B_ACCEPTANCE=NOT_ESTABLISHED` is
expected because it has no CPU oracle. The *subsequent* independent
differential PASS is separate and stronger evidence, but limited to
those six inputs.

## Next implementation blocks

1. Extend the independent comparison to **60 reproducible boundary,
   input-extreme and random-seed vectors per routine**. CI verifies
   the vector plan, the isolated CPU on synthetic ROM and fail-closed
   detection, but only the operator can execute the true ROM cases.
2. Rank genuine third-routine candidates from the existing 14-function
   byte-verified Ghidra export: exclude roots, IRQ/bank-dispatch,
   overlapping CFGs and unmodeled RTS stack pops. Mark X/U pointer
   bounds and MMIO effects as explicit blockers.
3. Select and implement a third routine only after inspecting the
   operator's local candidate triage; never invent ROM-specific
   P-code or grant hardware permissions to force success.
