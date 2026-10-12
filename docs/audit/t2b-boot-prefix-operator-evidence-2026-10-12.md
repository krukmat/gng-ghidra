# T2.B — Real-ROM boot prefix operator evidence
Date: 2026-10-12

## Provenance
Direct console output supplied by the operator running gng-ghidra on an
Apple Silicon Mac using the local gngb-compatible Ghosts 'n Goblins ROM.
No ROM bytes or derived copyrighted assets are stored in this document.

Software revision confirmed by operator git pull:
- main advanced from `b44c39a` to `ead21de` (fast-forward).
- Ghidra 12.1.4 headless, Motorola 6809 processor, was previously
  confirmed to export one real ROM reset CFG.
- Generic full-CFG codegen remained blocked at `0x6016 SYNC`:
  `Unmodeled instruction 0x6016 (SYNC): unmodeled-wait-for-interrupt`.

## Executed validation

```bash
python3 src/region_codegen.py --input out/functions.ir.json \
  --entry 0x6000 --stop-before 0x6016 --out out/generated
node scripts/verify-boot-prefix.mjs
```

Operator-reported output:

```text
GNG_REGION_CODEGEN=PASS entry=0x6000 stop_before=0x6016 instructions=9
GNG_BOOT_PREFIX_MEMORY=PASS steps=389 bytes_written=384 boundary=0x6016
```

## Accepted claim

A real ROM-derived nine-instruction prefix is emitted as JavaScript via
the Ghidra P-code -> typed IR path, executed in Node without MAME or a
6809 instruction emulator, and independently checked to initialize
384 bytes in sprite RAM without changing the other memory bytes.

## Non-claims and open gates

- NOT a full function decompilation: stop-before-`SYNC` is a suspension.
- NOT an interrupt/hardware model; `SYNC` is not rewritten as NOP.
- NOT three distinct ROM routines; only one reset-rooted CFG observed.
- NOT whole-game equivalence or a playable game.
- Further validation: independently grounded function entries and
  separate test vectors, preserving bank selection and I/O semantics.

Validation evidence is operator supplied; it was not produced by ROM-free
GitHub Actions CI.
