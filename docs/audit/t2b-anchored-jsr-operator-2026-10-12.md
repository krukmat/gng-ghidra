# T2.B.6 — Operator evidence: static 6809 JSR discovery
Date: 2026-10-12

## Observed in Ghidra 12.1.4 headless console

- `GNG_FUNCTION_EXPORT=PASS functions=14 skipped=0 anchored_verified=7 anchored_rejected=0`.
- Every decoded site had `listing_matches=true` and target resolution
  `6809-jsr-extended-operand`.
- Address and derived encoded target:
  - `0x65d3` -> `0x6755`
  - `0x65d6` -> `0x6772`
  - `0x65d9` -> `0x622c`
  - `0x65dc` -> `0x7930`
  - `0x65df` -> `0x67b3`
  - `0x65e2` -> `0x6239`
  - `0x65e5` -> `0x6274`

## Evidence boundaries

These are seven verified *static instruction encodings*, not evidence
of runtime reachability or callee return. The 14 recovered roots are not
14 demonstrated independent functions. There is no operator-supplied
post-discovery shortlist/behavioral equivalence evidence in this turn.

No ROM bytes, memory images or Ghidra raw exports are committed here.
