# T2.B.10 — Third genuine ROM routine, indexed RAM laboratory contract

## Real-ROM evidence that motivated the candidate

The operator's 2026-10-15 ROM-backed triage confirmed:

- **0x622c:** 60/60 independent MC6809 comparisons matched.
- **0x6755:** 60/60 independent MC6809 comparisons matched.
- **0x7930:** 10 instructions, 4/6 conditionally bounded data accesses,
  one fixed MMIO, one unresolved index; needs *two* new contracts.
- **0x6239:** 33 instructions, **10/12** conditionally bounded memory
  sites, **two unresolved index-register sites, zero fixed MMIO**,
  compiler structurally READY. This is the preferred third-routine
  experiment: it avoids granting another device permission.
- **0x6274:** 31 instructions, four unresolved indexes; more risk than
  0x6239. Others have additional I/O or interprocedural blockers.

This ranking is **not** evidence of actual call-site reachability or
of a safe X, Y or U register in the game. It does not identify which
index register is used: the exported Ghidra P-code remains private
to the operator. The generator infers the register **only from the
verified varnode dependency graph**, never from an address guess.

## Experimental implementation

`src/indexed_codegen.py` is a **third, independent generation mode**.
The pure generator and the seven-site board-aware generator remain
unchanged. It requires:

1. The same vector table and every emitted instruction byte to match
   `out/gngb-flat.bin`.
2. Exactly one modeled and byte-attested **RTS**, with a genuine
   two-byte `S` memory read inside Ghidra's P-code.
3. No CFG overlap or interprocedural edge, no unmodeled P-code,
   no hardware bank selector and no fixed MMIO site.
4. Exactly **12** Ghidra data-memory operations: ten conditionally
   bounded by the existing DP/S/ROM-read rules, and **two** unresolved
   pointers whose *sole* tracked input register must be X, Y or U.
5. Runtime guards for DP=0, 0x0100<=S<=0x2ffc **and**
   0x0100<=X/Y/U<=0x2ffc, checked at entry and before every
   memory operation. The effective address is separately checked
   against RAM/ROM/MMIO and never allowed to write ROM.
6. Cloned memory and register buffers; invalid calls cannot mutate
   caller inputs. No I/O adapter is authorized for 0x6239.
7. SHA-256-pinned generated JS and source ROM.

If any condition fails, status is **BLOCKED**. The contract is an
illustrative *laboratory* restriction; neither DP/S nor X/Y/U bounds
are proven to hold during game execution.

The native differential tests execute a pinned external C++ MC6809
CPU on the **operator's real ROM bytes**, with index registers all
initialized to the same controlled value. It verifies all architectural
A/B/CC/DP/X/Y/U/S, source RTS address vs CPU return PC, instruction
count, ordered MMIO trace (must remain empty) and every RAM/stack
mutation. 54 deterministic combinations of six seeds, three stack
positions and three index positions are compared independently.
The original 120 differential vectors for 0x622c and 0x6755 remain
untouched.

## Operator command — no Ghidra rerun

```bash
git pull --ff-only
python3 src/indexed_codegen.py
bash scripts/build-mc6809-oracle.sh
node scripts/compare-indexed-mc6809.mjs
```

The expected *structural* marker is
`GNG_INDEXED_CODEGEN=EXPERIMENTAL generated=1 blocked=0` **only
if the real raw Ghidra memory pointer provenance matches** the
12-site conditional whitelist. Otherwise inspect the printed blocker
and do not override it.

The native comparison is independent and may report
`GNG_INDEXED_DIFFERENTIAL=MISMATCH_OR_BLOCKED` even when codegen
succeeds. This is a **useful bug finding**, not reason to relax a
memory or register guard. Diagnosis is saved in
`out/generated-indexed/differential-report.json`.

Only
`GNG_INDEXED_DIFFERENTIAL=PASS_DIFFERENTIAL_TEST_VECTORS vectors=54
matched=54 failures=0`
would certify those controlled input states. A failure must be
investigated before claiming equivalence. Neither outcome proves
full-game runtime reachability, interrupt timing or correct memory
banks in live execution.

No ROM or C++ compiler artifacts are committed. The third native
CPU adapter has a ROM-free GitHub Actions smoke test using genuine
6809 `LDA ,X; RTS` instruction bytes and rejects unapproved MMIO.
