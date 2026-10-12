# gng-ghidra — ROM → IR → JavaScript / TypeScript proof of concept

First **ROM-derived, testable** migration experiment for Ghosts 'n Goblins
(`gngb`, Motorola 6809), deliberately **without MAME automation, video capture,
or gameplay recording**.

## Status

- **PASS locally (Python + Node):** real reset-loop ROM bytes → 7 decoded
  instructions (`gng.lir.v1`) → verified bounded-memory initialization IR
  (`gng.sir.v1`) → executable JS and TS.
- **PASS (operator's Mac, Ghidra 12.1.4):** real-ROM P-code exporter and
  seven-instruction independent decoder cross-check.
- **PASS (operator's Mac):** nine-instruction boot prefix (`0x6000` up to
  but not including `SYNC` at `0x6016`) compiled from Ghidra P-code to
  JavaScript, executed with Node; 384 sprite RAM bytes verified and
  execution suspended at the required boundary.
- **T2.B still partial:** complete function translation, interrupt handling,
  and three independently verified real ROM routines remain pending.
- **Not a playable port:** physics, graphics, Z80 sound, and other ROM banks
  have not been translated. No entire 6809 emulator is involved in the
  generated output.

## Requirements

- Python 3.10+ (stdlib only)
- Node.js 20+ for the JS test
- Your own local `gng.zip` matching **MAME `gngb`** set (the archive previously
  discussed; requires `gg3.bin`, `gg4.bin`, and `gg5.bin`)
- Optional: Ghidra supporting processor `6809:BE:16:default`

**Do not commit or upload ROMs.** `.gitignore` excludes them and generated output.

## Run the actual proof (Mac / Linux)

```bash
git clone https://github.com/krukmat/gng-ghidra.git
cd gng-ghidra
python3 -m unittest discover -s tests -v
python3 src/poc.py --rom /absolute/path/to/gng.zip --out out
node --test tests/test_generated.mjs
```

Expected output from the ROM verified in development:

```text
POC PASS: reset=0x6000, bytes=7 instructions, sprite init=96 x 4=384 bytes
... tests pass ...
```

The output is inspectable:

| Output | Purpose |
| --- | --- |
| `out/rom-map.json` | ROM provenance, fixed ranges, selectable banks |
| `out/reset-loop.lir.json` | Seven 6809 instructions, addresses, bytes, operands |
| `out/reset-loop.sir.json` | Auditable, structured fill-loop IR |
| `out/sprite-init.mjs` | Runnable vanilla JavaScript function |
| `out/sprite-init.ts` | Same generated routine for TypeScript / RN integration |
| `out/gngb-flat.bin` | One **bank-4** 64-KiB image for Ghidra, local only |

The generated TypeScript routine takes a `Uint8Array(0x10000)`, fills
`0x1e00..0x1f7f` with `0xf8`, and returns `{ nextX: 0x1f80, nextY: 0 }`.
It doesn't depend on React Native and can run inside a TS game-core package.

## Optional independent Ghidra check

Set `GHIDRA_HOME` to the installed Ghidra directory (the one with `support/analyzeHeadless`).

```bash
GHIDRA_HOME=/absolute/path/to/ghidra ./scripts/ghidra-headless.sh /absolute/path/to/gng.zip
```

The script imports `out/gngb-flat.bin` at address zero using language
`6809:BE:16:default`, decodes the bounded routine, exports P-code to
`out/reset-pcode.json`, and compares every instruction's address and raw bytes
against the Python LIR. It fails if Ghidra cannot decode or disagrees.
**This Ghidra cross-check was executed successfully on the operator's Mac.
It is not part of ROM-free CI.**

## Architecture and limits

See [docs/architecture.md](docs/architecture.md). The first gate proves one
real ROM function can be **structurally translated** to standalone JS/TS.
Further mechanics must be added incrementally, with explicit evidence. The
project intentionally avoids a requirement to automate MAME or record games.

Source material: [MAME GnG hardware driver](https://github.com/mamedev/mame/blob/master/src/mame/capcom/gng.cpp)
and [Ghidra SLEIGH 6809](https://github.com/NationalSecurityAgency/ghidra/blob/master/Ghidra/Processors/MC6800/data/languages/6809.slaspec).


## T2.B — Generalized Ghidra P-code function pipeline (experimental)

A second, separate pipeline now exports candidate functions and CFGs from
Ghidra, normalizes a typed intermediate representation and compiles supported
isolated functions into generic JavaScript / TypeScript. It fails closed on
unsupported P-code, calls, MMIO or unresolved control flow.

```bash
export GHIDRA_HOME="$(brew --prefix ghidra)/libexec"
bash scripts/functions-headless.sh "$PWD/roms/gng.zip"
cat out/functions.report.json
```

Run ROM-free CI fixtures locally:

```bash
python3 -m unittest discover -s tests -v
python3 tests/generate_function_fixtures.py
node --test tests/test_function_generated.mjs
tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution node out-synthetic/functions/generated/*.ts
```

**Verified on real ROM:** the generalized Ghidra exporter and normalizer
recovered one CFG rooted at reset `0x6000`. Full-routine code generation
correctly blocks on `SYNC`, but the bounded boot prefix translates and
passes the memory invariant check in Node:
```bash
python3 src/region_codegen.py --input out/functions.ir.json \
  --entry 0x6000 --stop-before 0x6016 --out out/generated
node scripts/verify-boot-prefix.mjs
```
Results supplied by the operator: `GNG_REGION_CODEGEN=PASS`
(`instructions=9`) and `GNG_BOOT_PREFIX_MEMORY=PASS`
(`steps=389 bytes_written=384 boundary=0x6016`).

**Not yet proven:** three separate real routines, full-game behavior, hardware
interrupts, or end-to-end behavioral equivalence. See
[docs/t2b.md](docs/t2b.md) and
[operator evidence](docs/audit/t2b-boot-prefix-operator-evidence-2026-10-12.md).

## T2.B.6–7 — ROM-authenticated function discovery and triage

The Ghidra exporter now reads real CPU vectors, seeds RESET and IRQ entries,
and follows **decoded** direct call targets (no guessed opcode scanning).
A fail-closed inventory checks every exported instruction's bytes against
local ROM, then prioritizes independent candidates without claiming that
hardware-dependent paths are translatable:

```bash
bash scripts/functions-headless.sh "$PWD/roms/gng.zip"
cat out/functions-shortlist.json
```

Outputs `out/functions-inventory.json` and `out/functions-shortlist.json`
are local-only. The ROM confirms RESET `0x6000` and IRQ `0x65c4`; all other
6809 vector targets are `0xffff` sentinels. The IRQ is not a pure leaf.

See [T2.B.6–7 plan](docs/t2b-discovery.md) for eligibility criteria, partial
results, and the next Ghidra execution requirement.
