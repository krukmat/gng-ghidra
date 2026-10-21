# gng-ghidra — ROM → IR → JavaScript / TypeScript proof of concept

**ROM-derived, testable** migration experiment for Ghosts 'n Goblins
(`gngb`, Motorola 6809). MAME is used **only as an external test oracle**
for video capture and differential validation; it is not part of the JS product.

**[Plan operativo actual R0–R6: tareas, subtareas y criterios STOP/GO](docs/plan-ejecucion.md)** · [Issues de seguimiento](https://github.com/krukmat/gng-ghidra/issues). La prioridad inmediata es validar el frame real R0 en el Mac; la recompilación directa 6809→JS es una hipótesis con gate de dos semanas, no una solución ya demostrada.

### Corrección del rumbo visual — R0 (primero)

La imagen V1.2 enviada por el operador mostró un mosaico
aleatorio e ilegible. **V1.2 queda rechazado visualmente.**
No se intentará mejorar el collage con más fixtures.

En su lugar se captura un **frame original real**
externamente (MAME solo en test), junto con memoria
FG/BG/sprites, scroll y paleta auténticos. Nuestro
JavaScript recompone esos bytes y muestra un
diff objetivo contra la imagen de referencia.

```bash
git pull --ff-only
bash scripts/r0-blackbox-frame.sh
```

**Diagnóstico actualizado (21/10/2026):** el intento de capturar
el frame 1550 dentro de la sesión de Blackbox produjo
`BLACKBOX_TIMELINE_MISSING` y errores Lua repetidos por no detectar
DMA en `0x3c00`. Esa combinación **NO** ha validado R0.

El nuevo `scripts/r0-blackbox-frame.sh` ejecuta **dos sesiones
independientes**: primero Blackbox original sin observadores para verificar
inputs efectivos y generar el vídeo privado; solo si pasa, realiza otra
ejecución con captura de memoria. La ausencia de DMA en esta segunda
sesión **se registra una sola vez y no interrumpe el bot**. Es posible
que el segundo paso siga bloqueado: no se sustituye el buffer DMA por RAM.

```bash
git pull --ff-only
bash scripts/r0-blackbox-frame.sh
```

El primer paso puede producir
`out/reference/blackbox-video/gameplay-frame.png` desde el AVI
auténtico, aunque todavía no tengamos la memoria de sprites bufferizados.
**Ese PNG NO prueba equivalencia JS**. Si falla la traza del primer paso,
la ejecución termina con un diagnóstico específico y no intenta R0.
ROM, AVI, PNG y volcados permanecen en `out/` (privados).

La revisión se determina por los CRC de los chips *dentro* del ZIP, no por su nombre. El wrapper crea un alias privado en `out/` para que MAME cargue `gngb` cuando `roms/gng.zip` contiene `gg4.bin`, `gg3.bin` y `gg5.bin`; no exige renombrar el original.
MAME se usa **solo como oráculo**; no forma parte de
la aplicación nativa JS. Hace falta MAME en el Mac.
[R0 completo](docs/frame-oracle.md).


### R0 / T1 — Blackbox conectado a gameplay (no solo coin/start)

**Causa del bloqueo corregida:** la ejecución anterior usaba el plan
\`gng_boot_only.yaml\`: después de Coin/Start no enviaba movimiento.
La ruta operativa ahora importa el **plan original**
\`plans/generated/gng_gameplay.yaml\` del checkout fijado de Blackbox,
lo convierte a un input-plan por frame con su planificador, y ejecuta
su \`scripts/mame_autoboot.lua\` original. Sólo invierte las etiquetas
Button 1/2 del plan exportado para respetar GNGb:
**Button 1 = ataque**, **Button 2 = salto**.

\`\`\`bash
git pull --ff-only
bash scripts/r0-blackbox-baseline.sh
\`\`\`

MAME ejecuta automáticamente ~40 s y graba la sesión en un AVI privado;
si hay ffmpeg disponible, crea y abre
\`out/blackbox-baseline/gameplay.mp4\`. No hay que jugar manualmente.
La traza de **inputs efectivos leídos por MAME** debe mostrar Coin,
Start, Right, Jump y Attack para que el script avance; una partida
visualmente correcta **sigue pendiente de comprobar el vídeo**.
El ROM/AVI/trazas nunca se incluyen en Git. No usar el bot experimental
\`GNG_BOT_SEQUENCE\` para esta fase.


## Qué puedes ejecutar y ver hoy

**Seguimiento visual:** seis checkpoints verificables ([roadmap](docs/roadmap.md)),
con tablero local de capturas antes/después, independiente de los tests:

```bash
python3 scripts/visual-progress.py
open out/visual-progress.html
```

No se atribuye «aceptado» automáticamente a la existencia de una imagen.
Las capturas y gráficos ROM permanecen en `out/`, fuera de Git.


- **[Roadmap de entregas visibles](docs/roadmap.md)**: diferencia gráficos ROM (V0), renderer VRAM (V1), primer frame derivado de código traducido (V2) y gameplay (V3). No contamos más funciones aisladas como avance visual.
- **Visor gráfico local V0 (código implementado, ROM privada pendiente de comprobar):**

```bash
git pull --ff-only
python3 src/graphics_preview.py --rom roms/gng.zip
open out/graphics-preview.html
```

Muestra sprites, tiles y caracteres desde los chips gráficos originales si están presentes en tu ZIP. Si la ROM está dividida, añade `--shared /ruta/al/parent.zip`. Los colores son diagnósticos, no la paleta real del arcade. **No es todavía un frame ni una partida ejecutada.** El HTML generado contiene píxeles de tu ROM y solo debe permanecer local.


### V1.1: comparación visual de sprite RAM

El primer renderer diagnóstico de sprites (sin CPU ni gameplay)
está implementado. Es un artefacto **local con bytes derivados
de la ROM** que muestra ANTES/DESPUÉS y los bytes alterados:

```bash
git pull --ff-only
python3 src/sprite_scene.py --rom roms/gng.zip
open out/visual/vram-sprites.html
```

Los botones de la página descargan `v1.1-before.png` y
`v1.1-after.png` para el seguimiento. El panel cambia
índice gráfico, atributos y posición X/Y, y actualiza el
buffer solo tras una copia explícita, como el hardware.
**No es un frame del juego.** [Criterios de aceptación](docs/roadmap.md).


### V1.2 — Composición BG/FG/sprites desde VRAM + scroll

Nuevo visor diagnóstico con **escena comparativa ANTES/DESPUÉS**,
ahora con gráficos ROM de fondo 16×16, foreground 8×8 y sprites.
Permite variar registros de scroll, tile y posición.
El mapa de tiles es un **fixture de memoria determinista**,
no el escenario de una partida. La paleta sigue siendo de
inspección; es un progreso visual, no gameplay.

```bash
git pull --ff-only
python3 src/vram_scene.py --rom roms/gng.zip
open out/visual/vram-scene.html
```

Si faltan ROMs gráficos, usar
`--shared /ruta/local/zip-padre.zip`.
La página muestra los cambios byte a byte y descarga PNG
ANTES/DESPUÉS para el [dashboard visual](docs/roadmap.md).

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
- **T2.B still partial:** two original-ROM functions matched 60/60 laboratory CPU comparisons each; a third is not validated; live IRQ, bank switching and complete game execution remain pending.
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


**Operator verification of B.6/B.7:** Ghidra 12.1.4 has now recovered
three real entries (`0x6000`, `0x65c4`, `0x65fb`), with one direct call
from IRQ to `0x65fb`. The shortlist remains `PARTIAL` (`eligible=0`).
Entry `0x65fb` writes to the hardware ROM bank-select register
`0x3e00` and uses indirect dispatch; do **not** treat it as an isolated
function or bypass hardware checks. See [discovery status](docs/t2b-discovery.md).

### Real-ROM discovery update — 2026-10-12

The operator's Ghidra 12.1.4 run recovered **14 ROM-rooted code graphs** and
confirmed seven 6809 extended `JSR` instruction sites with the Ghidra
`PseudoDisassembler` and the ISA's `0xBD` operand. No anchored sites
were rejected in that run. This confirms **static decoding only** — it
does not prove execution reachability, isolated function boundaries or
behavioral equivalence.

To inspect **all candidates** and their compiler blockers after pulling,
without re-running Ghidra:

```bash
python3 src/function_inventory.py --input out/functions.raw.json \
  --rom-image out/gngb-flat.bin --out out/functions-inventory.json \
  --shortlist out/functions-shortlist.json
python3 scripts/triage-functions.py
```

T2.B.7 remains open until independent, bounded ROM routines are
selected and validated. See [Ghidra discovery evidence](docs/t2b-discovery.md).

### Memory pointer origin diagnosis

When `src/memory_analysis.py` cannot prove the address range for a
P-code `LOAD/STORE`, use the 6809 register-origin diagnostic without
rerunning Ghidra:

```bash
python3 src/memory_provenance.py \
  --entries 0x622c 0x6755 0x7930 0x6793 0x6839
```

The tool tracks per-instruction `unique` temporaries back to `S`
(stack), `X/Y/U` (indices), `DP`, and other registers. This is a
**pointer-origin fingerprint**, not a proof that those registers remain
within RAM; MMIO/ROM write protection is unchanged.

### T2.B.9 — controlled execution of two real-ROM candidates

The operator confirmed that the guarded P-code compiler generated
modules for 0x622c and 0x6755, with 3/3 and 5/5 conditionally bounded
memory accesses, respectively. These are real ROM-derived generated
modules, **not yet behaviorally equivalent** to the MC6809 CPU.

Run a bounded, deterministic JS-only harness (no new Ghidra run):

```bash
git pull --ff-only
python3 src/guarded_codegen.py
node scripts/verify-guarded-functions.mjs
```

The harness requires SHA-256 of each generated file, checks three
synthetic input cases per routine, replay determinism, no MMIO/ROM
mutations, non-mutation of caller buffers, and invalid-DP/S rejection.
It writes `out/generated-guarded/verification-report.json`.

Even a successful `GNG_GUARDED_HARNESS=PASS_JS_CONTROLLED_ONLY`
is **not** a native 6809 comparison. See [T2.B.9 harness gate](docs/t2b.md).

**T2.B.9 safety update (2026-10-13):** the previous conditional
3/3 and 5/5 memory-access counts did not include native P-code direct
RAM varnodes. These routines appear to touch MMIO. The memory audit
and guarded pure-codegen gate now include those accesses; a BLOCKED
result is expected until a hardware I/O test adapter is explicitly
defined. See [T2.B discovery and memory safety](docs/t2b-discovery.md).

### T2.B.9-A/B — Experimental board-aware ROM transpilation

The previously unsafe routines remain BLOCKED under pure codegen. A separate
[board-aware experiment](docs/t2b-board-io.md) now permits exactly seven
verified MMIO sites: two injected one-byte reads in 0x622c and five recorded
one-byte writes in 0x6755. The new generator never silently writes MMIO into
the RAM buffer or simulates board behavior.

With an existing verified local Ghidra export, execute:

```bash
git pull --ff-only
python3 src/board_codegen.py
node scripts/verify-board-functions.mjs
cat out/generated-board/verification-report.json
```

The output reports deterministic JS execution and exact I/O traces.
**No behavioral equivalence with an independent MC6809 implementation
is established by JS-only tests.** Pure output remains blocked.

### T2.B.9-C — Independent CPU oracle (test-only)

The two ROM-derived board functions have now passed the operator's
controlled JS execution with 3 accepted and 3 rejected states each.
The separate independent CPU differential is implemented but **not yet
validated against the operator's real ROM**.

Build a pinned third-party C++ MC6809 reference, execute actual ROM
instruction bytes on synthetic input states, and compare complete
register/CC/S, return boundaries, memory deltas, and ordered MMIO events:

```bash
git pull --ff-only
python3 src/board_codegen.py
bash scripts/build-mc6809-oracle.sh
node scripts/compare-mc6809.mjs
cat out/generated-board/differential-report.json
```

No proprietary ROM is transferred or committed. The test-only
oracle is not a game emulator dependency. See
[MC6809 differential verification](docs/t2b-mc6809-differential.md).


### Native MC6809 differential and third-routine selection (2026-10-15)

**Operator-verified result:** `0x622c` and `0x6755` each matched
3/3 real ROM opcode executions against the independent MC6809 CPU,
under synthetic DP/S/board-read input states. The generated JS and
native CPU agreed on registers, CC flags, RAM changes, RTS behavior
and ordered MMIO effects. **No actual game entry-state/reachability
proof exists yet.** See [audit evidence](docs/audit/t2b-mc6809-operator-evidence-2026-10-15.md).

The independent differential test is now expanded to **60 states per
routine**. For the next block (without rerunning Ghidra):

```bash
git pull --ff-only
python3 src/board_codegen.py
node scripts/compare-mc6809.mjs
python3 src/third_routine_candidates.py --limit 8
```

The last command ranks the already-exported ROM functions, detects
unknown X/U bounds, fixed MMIO, overlapping graphs and incomplete
RTS stack models. Its shortlist is **static triage, not a certification**.


## Expanded native differential and third indexed routine (2026-10-15)

The operator ran the updated native MC6809 comparison against genuine
local ROM bytes and observed **120/120 vector matches**:
`0x622c: 60/60` and `0x6755: 60/60`. Game entry states remain
unverified; this is independent lab-state equivalence only.

The next third routine targets **0x6239**, selected from the operator's
14-function ROM-backed triage (33 instructions, ten conditionally
bounded RAM/stack operations, two unresolved indexed pointers and
**no fixed MMIO**). A separate fail-closed generator enforces
P-code-proven X/Y/U pointer origin, the existing DP/S contract,
per-access memory checks and a conservative index range, without
altering the previously certified routines. Its independent native
comparison tests 54 new laboratory states. Nothing has been declared
equivalent for this third routine yet.

```bash
git pull --ff-only
python3 src/indexed_codegen.py
bash scripts/build-mc6809-oracle.sh
node scripts/compare-indexed-mc6809.mjs
```

Read [the third-routine gate](docs/t2b-third-indexed.md) for
conditions, expected pass/block markers and limitations. No new Ghidra
run is necessary unless the byte-verified export is stale.
