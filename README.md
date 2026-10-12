# gng-ghidra — ROM → IR → JavaScript / TypeScript proof of concept

First **ROM-derived, testable** migration experiment for Ghosts 'n Goblins
(`gngb`, Motorola 6809), deliberately **without MAME automation, video capture,
or gameplay recording**.

## Status

- **PASS locally (Python + Node):** real reset-loop ROM bytes → 7 decoded
  instructions (`gng.lir.v1`) → verified bounded-memory initialization IR
  (`gng.sir.v1`) → executable JS and TS.
- **Not yet executed in Ghidra in this environment:** optional headless
  P-code exporter and cross-check included; run locally if you have Ghidra.
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
GHIDRA_HOME=/absolute/path/to/ghidra bash scripts/ghidra-headless.sh /absolute/path/to/gng.zip
```

The script imports `out/gngb-flat.bin` at address zero using language
`6809:BE:16:default`, decodes the bounded routine, exports P-code to
`out/reset-pcode.json`, and compares every instruction's address and raw bytes
against the Python LIR. It fails if Ghidra cannot decode or disagrees.
**This optional Ghidra step is supplied but has not been run here.**

## Architecture and limits

See [docs/architecture.md](docs/architecture.md). The first gate proves one
real ROM function can be **structurally translated** to standalone JS/TS.
Further mechanics must be added incrementally, with explicit evidence. The
project intentionally avoids a requirement to automate MAME or record games.

Source material: [MAME GnG hardware driver](https://github.com/mamedev/mame/blob/master/src/mame/capcom/gng.cpp)
and [Ghidra SLEIGH 6809](https://github.com/NationalSecurityAgency/ghidra/blob/master/Ghidra/Processors/MC6800/data/languages/6809.slaspec).