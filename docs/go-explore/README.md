# Go-Explore y exploración H3 — entrada canónica

**Estado (2026-11-02):** fases visibles 1–3 completadas desde reset con cintas de solo entradas, replay `MATCH`, vídeo y métricas. Siguiente trabajo: V2–V4 del [plan del bot de control](../plan-bot-control-jugabilidad-2026-11-01.md) (no iniciado).

Este documento es la referencia vigente para ejecutar, reproducir y verificar las herramientas de exploración H3. Los handoffs y planes enlazados en [§9](#9-documentos-históricos) conservan la evidencia y el razonamiento de cada etapa, pero sus instrucciones ya no están vigentes.

Todo se ejecuta desde la raíz del repo, sobre el bundle certificado local (g6), sin ventanas y sin tocar el motor. Las cintas, vídeos y métricas viven en `out/`, que es privado y no está en git.

## 1. Arquitectura

```text
 cinta semilla (B3) ──┐                        ┌── lab.save()/restore() solo entre ramas
 o reset + titleCoin  │                        │
                      ▼                        │
            labCreateBoard(bundle g6 congelado) ◄── portRead: eventos de la cinta / máscaras P1
                      │ onFrame: lee RAM (solo lectura) → look(), isFatal(), cellKey()
                      ▼
   búsqueda: Go-Explore | haz | maniobras | continuación acotada
                      ▼
   cinta de solo entradas  {schema, profile, frames, events, sha256, h3:{goalFrame, signal, ramSha, ...}}
                      ▼
   replay desde reset, sin restore  →  MATCH de RAM + señal (+ transición)
                      ▼
   h3_video.mjs check (RGBA = app)  →  export MP4 + JSON de métricas  →  gate de aceptación
```

Piezas comunes, importadas por todas las herramientas de este documento:

| Pieza | Papel |
| --- | --- |
| [`src/v3_b3_bundle.mjs`](../../src/v3_b3_bundle.mjs) `selectB3Bundle` + [`src/v2_b1_frozen.mjs`](../../src/v2_b1_frozen.mjs) `loadFrozen` | Selecciona y carga el bundle certificado. Si no hay ninguno, la herramienta falla con `V3_B3_NO_CERTIFIED_BUNDLE`. |
| [`src/v3_b3_lab_board.mjs`](../../src/v3_b3_lab_board.mjs) `labCreateBoard` | Placa de laboratorio: `lab.advanceTo(n)`, `lab.save()` y `lab.restore(snap)`. |
| [`src/v3_b3_external_tape.mjs`](../../src/v3_b3_external_tape.mjs) `resolveB3LabTape` | Valida y carga una cinta B3 externa: esquema y `sha256 = sha256(JSON{schema,profile,frames,events})`. |
| [`src/v3_b3_tapes.mjs`](../../src/v3_b3_tapes.mjs) `b3Tape('titleCoinStart')` | Prefijo de arranque (moneda y Start) cuando no hay cinta semilla. |
| [`src/gngb_input_contract.mjs`](../../src/gngb_input_contract.mjs) | `defineInputSchedule` y `readScheduledPort`: los eventos `{cycle, control, pressed}` se convierten en lecturas de puerto. `cycle = frame × CYCLES_PER_FRAME` (25152). |
| [`games/gngb/state.mjs`](../../games/gngb/state.mjs) `look`, `BOSS_LIFE` | Etiquetas RAM de solo lectura. Las reexporta [`src/h3_explore.mjs`](../../src/h3_explore.mjs). |
| [`src/h3_lab_maneuver.mjs`](../../src/h3_lab_maneuver.mjs) `maneuverFatal` | Predicado fatal: impacto (`0x0503=3`) sin armadura, handler de muerte o vida perdida. |

Etiquetas RAM usadas como señal: fase `0x72`, checkpoint `0x81`, vuelta `0x71`, vidas `0x60`, X `0xA0:A1`, Y `0xA2:A3`, scroll `0x58:59`, armadura `0xAC` (0 = puesta, 1 = sin armadura), puntuación BCD `0x68–0x6B`, modo `0x0503` y handler `0x0510:11`. `ramSha` es el SHA-256 de la RAM `0x0000–0x2FFF` en `h3.goalFrame`.

**Fase visible y valor RAM:** `0x72` empieza en 0. La fase visible N corresponde a `0x72 = N−1`, y completarla es la transición `0x72: N−1 → N`.

## 2. Inventario y métodos

No todas las herramientas usan Go-Explore. Hay cuatro métodos de búsqueda distintos, más herramientas de diagnóstico, cintas y vídeo.

| Herramienta | Método / propósito | Estado |
| --- | --- | --- |
| [`scripts/h3_explore.mjs`](../../scripts/h3_explore.mjs) + [`src/h3_explore.mjs`](../../src/h3_explore.mjs) | **Go-Explore** sobre máscaras P1. También hace `replay` (verificación) e `import` (cintas en vivo). | Vigente |
| [`scripts/h3_boss_search.mjs`](../../scripts/h3_boss_search.mjs) | **Búsqueda en haz** con 14 acciones macro, segmentos fijos y retroceso opcional. | Vigente desde `H3_SEED`; con `H3_POKE`, solo laboratorio |
| [`scripts/h3_boss_maneuver.mjs`](../../scripts/h3_boss_maneuver.mjs) | **Maniobras dirigidas**: control más ≤3 rutas desde un prefijo, ≤240 frames. | Vigente |
| [`scripts/h3_finish_phase.mjs`](../../scripts/h3_finish_phase.mjs) | **Continuación acotada** tras el jefe de la fase 1: pulsaciones izquierda/derecha de duración fija. | Especializada (fase 1) |
| [`scripts/h3_finalize_phase3.mjs`](../../scripts/h3_finalize_phase3.mjs) | Sella una continuación como cinta final verificable. | Especializada (fase 3) |
| [`scripts/verify_h3_phase3.sh`](../../scripts/verify_h3_phase3.sh) | Gate de aceptación: prefijo, replays, paridad RGBA, exportación y ffprobe. | Especializada (fase 3) |
| [`scripts/h3_video.mjs`](../../scripts/h3_video.mjs) | Cinta → paridad RGBA con la app, MP4 y JSON de métricas. | Vigente |
| [`scripts/h3_boss_inspect.mjs`](../../scripts/h3_boss_inspect.mjs) | Etiquetas y sprites visibles en frames concretos. | Diagnóstico |
| [`scripts/h3_boss_trace.mjs`](../../scripts/h3_boss_trace.mjs) + [`src/h3_lab_trace.mjs`](../../src/h3_lab_trace.mjs) | Traza causal neutral de un rango de RAM. | Diagnóstico |
| [`scripts/h3_boss_coverage.mjs`](../../scripts/h3_boss_coverage.mjs) | Bloques compilados que ejecutan las cintas y ninguna cinta certificada. | Diagnóstico |
| [`scripts/h3_static_cover.mjs`](../../scripts/h3_static_cover.mjs) | Cierre estático frente al bundle. Solo mide. | Diagnóstico |
| [`scripts/h3_tape.mjs`](../../scripts/h3_tape.mjs) + [`scripts/h3_tape_recorder.lua`](../../scripts/h3_tape_recorder.lua) + [`src/h3_tape_convert.mjs`](../../src/h3_tape_convert.mjs) | Grabador MAME → cinta B3, con rebobinado e ida y vuelta. | Vigente (requiere MAME) |
| [`src/h3_live_import.mjs`](../../src/h3_live_import.mjs) | Cinta en vivo (app) → eventos B3 al inicio de frame, para `import`. | Vigente |
| [`src/h3_lab_poke.mjs`](../../src/h3_lab_poke.mjs) | `H3_POKE`: escrituras de RAM de laboratorio. | Solo laboratorio; prohibido en cintas de fase |

Tests: [`tests/test_h3_explore.mjs`](../../tests/test_h3_explore.mjs), [`test_h3_lab_maneuver.mjs`](../../tests/test_h3_lab_maneuver.mjs), [`test_h3_lab_trace.mjs`](../../tests/test_h3_lab_trace.mjs) y [`test_h3_tape_convert.mjs`](../../tests/test_h3_tape_convert.mjs). Se ejecutan con `node --test tests/test_h3_*.mjs`.

Otros consumidores: [`scripts/ao_controls_check.mjs`](../../scripts/ao_controls_check.mjs) genera el `check.record_sha256` que valida `import`. Fuera de alcance quedan el bot visual de `bot/` (en vivo, solo píxeles) y el explorador anterior de [V3.B3 G2.1](../agents/v3-b3-g2-explorer-task.md).

## 3. Interfaces

Salidas privadas, con modo `0600`. Los códigos de salida se indican entre paréntesis.

### `h3_explore.mjs`

```sh
node scripts/h3_explore.mjs explore [--from <tape.json>] [seed=1] [iters=Infinity] [minutes=30]
node scripts/h3_explore.mjs replay <tape.json> [every=0]
node scripts/h3_explore.mjs import <live-tape.json> [frame] [--unverified]
```

- **explore** (0 GO, 2 sin objetivo, 3 fallo):
  - Sin `--from`, arranca con `titleCoinStart` y las máscaras P1 empiezan en el frame 1200. El objetivo es `0x72=0` y `scroll ≥ 3072` (arena del jefe de la fase 1).
  - Con `--from`, reproduce la cinta hasta `h3.goalFrame` y exige `h3.ramSha` igual. Si la cinta tiene `inputsLive=false`, se niega a arrancar. El objetivo es `0x72 ≠` la fase inicial.
  - Escribe `out/h3/explore/cells-[s2-]s<seed>-i<iters>.json` (sin snapshots) y `tape-[s2-]s<seed>-<frame>-{arena|phase|best}.json`, con `frames = goalFrame + 60`. El prefijo `s2-` indica `--from`, sea cual sea la fase.
- **replay** (0 `MATCH`/`NO_REFERENCE`, 1 `MISMATCH`, 3 parada): reproduce desde reset sin restore hasta `h3.goalFrame`. Compara `ramSha`, `signal` y, si existe, `transitionFrame`.
- **import**: produce `tape-live-<nombre>-<frame>.json` y fija `inputsLive`. Termina con código 3 si `check.record_sha256` falla, o si no hay check y falta `--unverified`.

### `h3_boss_search.mjs`

```sh
[H3_SEED=<tape>] [H3_*=...] node scripts/h3_boss_search.mjs <fase-RAM> [start=2200] [step=60] [end=9000]
```

- `<fase-RAM>` es el valor de `0x72` que debe tener la placa en `start`; si no coincide, falla con `H3_BOSS_START_PHASE`.
- En cada profundidad prueba las 14 acciones desde cada miembro del haz. Poda las ramas muertas o con vidas perdidas, deduplica por posición, armadura, handler, puntuación y scroll, y se queda con `H3_WIDTH` ramas.
- Valor de una rama: `WX·min(maxX, XCAP) + WY·maxY + WU·(y0 − minY) + WS·score − WA·armor − WB·Σvida`.
- Escribe `out/h3/boss/search-p<fase>-<frame>.json` con `frames = frame + 300` y `h3:{poke, route, ...}` (0 `PHASE_ADVANCED`, 2 sin avance).

### `h3_boss_maneuver.mjs`

```sh
[H3_STEP=23] [H3_HORIZON=240] node scripts/h3_boss_maneuver.mjs <tape.json> <prefix> <nombre=acción,...> [≤3 especificaciones]
```

- Reproduce la cinta (con su poke, si lo tiene) hasta `prefix` y ejecuta el control y cada ruta desde `prefix+1` hasta `prefix + H3_HORIZON`. Las acciones y la cadencia están en `MANEUVER_ACTIONS` ([`src/h3_lab_maneuver.mjs`](../../src/h3_lab_maneuver.mjs)); `idle` es la pausa.
- Libera los controles retenidos y escribe `out/h3/boss/f2/maneuver-<prefix>-<nombre>.json` (`frames = END + 1`) y `maneuvers-<prefix>.json`. El directorio `f2` conserva su nombre histórico.
- Código 0 si todas las rutas terminan `FRAMES_DONE`.

### Continuación, sellado y aceptación

```sh
node scripts/h3_finish_phase.mjs <cinta-jefe-derrotado.json>      # → out/h3/explore/tape-s2-phase-<goal>.json
node scripts/h3_finalize_phase3.mjs <candidata.json> <end>         # → out/h3/explore/tape-fase3-completa-<end>.json
bash scripts/verify_h3_phase3.sh <cinta-final-fase3.json>          # → H3_PHASE3_ACCEPTANCE=PASS
```

- `finish_phase` exige `h3.goalFrame ≥ 1200`, `ramSha` y `bossLife=0`. Prueba `p1.left` y `p1.right` mantenidos 120, 180, 240, 272 y 320 frames, con un horizonte de 500. Gana la primera variante que cambia `0x72`, y el objetivo queda en la transición + 60.
- `finalize_phase3` tiene fijados la cinta inicial, sus hashes, `START=16980` y g6, y rechaza `H3_POKE`. Exige exactamente una transición `2→3` y controles P1 liberados.
- El gate vuelve a exportar el vídeo y escribe logs en `/tmp/h3-phase3-*.log`.

### `h3_video.mjs`

```sh
node scripts/h3_video.mjs check  <tape.json> [frame=320]
node scripts/h3_video.mjs export <tape.json> [endFrame=tape.frames] [startFrame=1]
```

- `check` compara los píxeles RGBA de un frame con los módulos empaquetados de la app (`out/android/assets/lib/`).
- `export` escribe `out/h3/video/<cinta>-<sha8>[-<inicio>]-<fin>.{mp4,json}`: H.264 a 256×224 y `1500000/25152` fps. El JSON (`gng.h3.video-metrics.v1`) incluye filas por frame, eventos fechados (`inGame`, `phase`, `lives`, `stage`, `cp`, `armor`) y un resumen. El resumen solo cuenta los frames en juego (`inGame`), así que deja fuera los patrones de RAM del arranque.
- `ramVerified=true` solo si `endFrame = h3.goalFrame` y la RAM coincide.

### Diagnóstico y cintas

```sh
node scripts/h3_boss_inspect.mjs <tape.json> <f1,f2,...>
[H3_TRACE_WATCH=0x510:2] [H3_TRACE_BASELINE=<inspect.json>] node scripts/h3_boss_trace.mjs <tape.json> <from> <to> [a:b]
node scripts/h3_boss_coverage.mjs check | <search-tape.json>...
[H3_TAB=64] node scripts/h3_static_cover.mjs
node scripts/h3_tape.mjs selftest | selftest-rewind | record | convert <journal.txt> <tape.json>
```

- La traza admite ventanas ≤122 frames y detalle de lectura ≤4. Escribe `out/h3/boss/f2/trace-<from>-<to>.{txt,ram.bin,json}`.
- La cobertura escribe `out/h3/boss/coverage.json`.
- `h3_tape.mjs` necesita `mame` en el PATH y `roms/`. Sus modos `selftest*` corren sin vídeo, sonido ni teclado. `record` abre una ventana interactiva: solo debe usarlo el operador.

## 4. Variables de entorno

| Variable | Herramienta | Valor por defecto | Efecto |
| --- | --- | --- | --- |
| `H3_SEED` | boss_search | titleCoinStart | Cinta de la que se conservan los eventos anteriores a `start`. |
| `H3_STEP` | boss_search / maneuver | posicional / 23 | Longitud del segmento en frames. |
| `H3_WIDTH` | boss_search | 8 | Ancho del haz. |
| `H3_WX`, `H3_WY`, `H3_WU`, `H3_WS` | boss_search | 1, 0, 0, 0.02 | Pesos de X máxima, Y máxima, subida (`y0 − minY`) y puntuación. |
| `H3_WA` | boss_search | 2000 | Penalización por perder la armadura. |
| `H3_WB`, `H3_BOSS_LIFE` | boss_search | 0, `0xe76` | Peso y direcciones de vida sumadas. Ver [§8](#8-limitaciones-reales). |
| `H3_XCAP` | boss_search | 65535 | Tope de X premiada (arenas). |
| `H3_LAST` | boss_search | — | Guarda la cabeza final del haz en lugar de la mejor. |
| `H3_BACKTRACK`, `H3_BACKTRACK_LIMIT` | boss_search | 0, ilimitado | Retrocede N segmentos cuando mueren todas las ramas. |
| `H3_DEBUG` | boss_search | — | Registra cada rama podada. |
| `H3_HORIZON` | maneuver | 240 (máx.) | Horizonte de cada ruta. |
| `H3_MANEUVER_REF` | maneuver | — | `<ram.bin>:<firstRecord>` de una traza para comparar el control. |
| `H3_TRACE_WATCH`, `H3_TRACE_BASELINE` | trace | `0x510:2`, — | Rango vigilado y comparación con una salida de inspect. |
| `H3_TAB` | static_cover | 64 | Tamaño de tabla del cierre estático. |
| `H3_POKE` | search / maneuver / inspect / trace / coverage | — | `from:to:addr:value,...`. Solo laboratorio. Lo rechazan `finalize_phase3` y el gate. |
| `GNG_H3_*` | h3_tape → recorder.lua | — | Los fija `h3_tape.mjs`; no se ponen a mano. |

## 5. Flujo completo

1. **Preflight.** Comprobar que existen `node`, `ffmpeg`/`ffprobe`, `roms/gng.zip` y el bundle certificado g6. Después, reproducir la cinta semilla y exigir `MATCH`:
   ```sh
   node scripts/h3_explore.mjs replay out/h3/explore/tape-fase3-completa-22380.json
   ```
2. **Semilla.** Elegir una de tres: reset (`explore` sin `--from`), una cinta final con `h3.goalFrame` y `h3.ramSha` (`--from` o `H3_SEED`), o una cinta en vivo importada (`import`). Para ramificar, el prefijo debe tener los controles liberados en el punto de corte; si no, usar `h3_boss_maneuver.mjs`, que los libera.
3. **Exploración y búsqueda.** El método depende del tramo ([§6](#6-criterios-de-búsqueda)). Cada búsqueda guarda una cinta reanudable, que se encadena con `H3_SEED` o pasándola a `h3_boss_maneuver.mjs`.
4. **Cinta final.** Sellarla con `h3.goalFrame`, `h3.signal`, `h3.ramSha` y `h3.transitionFrom`/`transitionFrame`, sin poke. `explore` y `finish_phase` ya lo hacen; para la fase 3 se usa `finalize_phase3`. No sobrescribir la cinta de entrada.
5. **Replay.** `h3_explore.mjs replay <final>` debe dar `MATCH`.
6. **Vídeo y aceptación.** Comprobar con `h3_video.mjs check <final> <goalFrame>` y exportar con `h3_video.mjs export <final> <goalFrame> <inicio>`, compartiendo el primer frame con el vídeo anterior. Revisar con ffprobe el códec, el tamaño, el número de frames, el evento `phase` y `ramVerified=true`. Para la fase 3, `verify_h3_phase3.sh` hace todo esto.

## 6. Criterios de búsqueda

- **Go-Explore.**
  - Celda: `(fase, checkpoint, X>>4, Y>>3, armadura)`. Con `--from` se añade el byte `0x0E76`.
  - Cada celda guarda la trayectoria que conserva la armadura y, a igualdad, la que tarda menos frames.
  - Selección: peso `(1 + scrollBonus·min(scroll, 3072)/3072)/√(1+elegida)`.
  - Exploración: 120 frames de acciones pegajosas, generadas con mulberry32 de semilla fija y evaluadas cada 4 frames. La rama se corta al primer estado fatal. Un impacto con armadura no corta; genera otra celda.
  - Mejor celda en S1: scroll y luego X. Con `--from`: fase, luego menos vida y luego X.
- **Haz.** Macros fijas (`right`, `right_fire`, `right_jump`, `right_fire_jump`, `right_late_jump`, `fire`, `jump`, `duck_fire`, `left`, `left_fire`, `left_jump`, `up`, `up_fire`, `down`) con el valor de §3. Sirvió para avanzar en las fases 2 y 3 con segmentos de 120 frames en tramos abiertos y de 60 junto a peligros.
- **Maniobras.** Rutas cortas escritas a mano tras una observación (por ejemplo, ir a por la llave y esperar la transición). No buscan: comparan como máximo tres variantes contra el control.
- **Cierre de fase.** Matar al jefe no cierra la fase: en las fases 1–3 hubo que esperar a que apareciera la llave y recogerla. Premiar la X deja al bot esperando en el extremo derecho. El criterio de cierre es siempre la transición RAM `0x72`, comprobada en el replay y en el vídeo.

## 7. Determinismo y snapshots de laboratorio

- El motor es determinista: la misma cinta da la misma RAM. Los snapshots (`lab.save`/`restore`) solo sirven para saltar entre ramas. Nunca escriben RAM ni entran en la cinta. La cinta final se valida reproduciéndola desde reset, sin restore.
- `explore` es función pura de semilla, iteraciones, cinta semilla, bundle y código **mientras termine por objetivo o por `iters`**. El límite `minutes` depende del reloj: si es lo que corta la búsqueda, el resultado cambia con la máquina.
- La búsqueda en haz y las maniobras no usan azar. Dependen solo de sus parámetros y de la cinta.
- El explorador se corrigió en `b2b9f6a` (`extendMasks`). Las cintas de S1/S2 son anteriores, así que no está comprobado que el código actual las regenere byte a byte. Su evidencia es el replay `MATCH`.
- Una cinta con `H3_POKE` no es una cinta de solo entradas: `replay` no aplica pokes y no sirve para certificar.

## 8. Limitaciones reales

- `replay` solo verifica cintas con `h3.ramSha`. Las cintas de búsqueda y de maniobra (`h3:{poke, route, ...}`) dan `MISMATCH` por construcción; para revisarlas, usar `h3_boss_inspect.mjs` o sellarlas.
- Sin `h3.transitionFrom`, `replay` compara la **primera** transición desde el frame 1200. Por eso la cinta de fase 2 comprueba 5890 (0→1). Su transición 1→2 (16566) está en `h3.phaseCompletionFrame` y en los eventos del vídeo, pero el replay no la comprueba.
- **Vida del jefe:** `0x0E76` (`BOSS_LIFE`) solo está validada para el jefe de la fase 1: empieza en 5, baja 1 por golpe y no cambia sin disparo; comprobado con las semillas 7 y 11. En fases posteriores puede ser otro objeto (por ejemplo, un ogro de la fase 2). Por tanto:
  - `explore --from` la incluye en la celda sea cual sea la fase;
  - `finish_phase` la exige a 0;
  - el `bossKill` de `replay` solo tiene sentido en la fase 1.
  - `0xc66,0xcf6` se usaron en la fase 2 como vida conjunta de los guardianes; no consta su validación.
  - La fase 3 se completó con `H3_WB=0`, sin ningún contador de jefe. **No hay contador de jefe validado para las fases 2 y 3.**
- `maneuverOutcome` calcula `advance` y `aboveLimit` con `limit=5464`, que es la geometría de H3-F2. En otros tramos esos campos no significan nada.
- `h3_finish_phase.mjs` está pensado para el primer jefe. `h3_finalize_phase3.mjs` y `verify_h3_phase3.sh` tienen fijados la cinta, los hashes y el frame 16980 de la fase 3. Para otra fase hay que generalizarlos, sin cambiar su interfaz.
- La secuencia de comandos de la fase 2 **no quedó registrada**. Solo queda la procedencia en la cinta (ver §10). Reproducirla exactamente está pendiente.
- La paridad MAME (S3) de las fases completadas está pendiente. Solo se comparó con MAME el estancamiento de S2 (`PASS_ALL_FRAMES_MATCH`).

## 9. Documentos históricos

Conservan la evidencia de cada etapa en su documento de origen. Sus instrucciones quedan sustituidas por este README.

| Documento | Estado |
| --- | --- |
| [`plan-contenido-h3-h4-2026-10-27.md`](../plan-contenido-h3-h4-2026-10-27.md) | Plan H3→H4. El paso 5 (haz, cobertura, H3-F2) y los resultados de S1/S2 son históricos. Su «Siguiente acción» quedó resuelta. |
| [`agents/h3-tas-probe-s1-task.md`](../agents/h3-tas-probe-s1-task.md) | S1 GO (28/10). Diseño original del explorador. |
| [`agents/h3-tas-probe-s2-task.md`](../agents/h3-tas-probe-s2-task.md) | S2 STOP (28/10). Localizó `0x0E76`. El cierre de la fase 1 llegó después con `h3_finish_phase.mjs`. |
| [`agents/h3-phase2-first-hit-task.md`](../agents/h3-phase2-first-hit-task.md) | H3-F2 cerrada (27/10). Causa del impacto en X≈5464, con poke de laboratorio. |
| [`agents/h3-phase3-bot-video-handoff.md`](../agents/h3-phase3-bot-video-handoff.md) | Encargo de la fase 3, cumplido (02/11). |
| [`agents/h3-phase3-local-agent-kit.md`](../agents/h3-phase3-local-agent-kit.md) | Ejecución de la fase 3 (P0–P5) y defectos corregidos. |
| [`agents/h3-phase4-bot-task.md`](../agents/h3-phase4-bot-task.md) | **Vigente:** encargo de la fase 4 (pendiente). Remite a este README. |
| [`plan-bot-control-jugabilidad-2026-11-01.md`](../plan-bot-control-jugabilidad-2026-11-01.md) | **Vigente** como lista de tareas (V2–V4) y registro de V1. Los detalles operativos remiten aquí. |

## 10. Resultados verificados

Todas las cintas son de solo entradas, sin poke y sobre el bundle g6. El 2026-11-02 se repitieron `replay` de las cuatro cintas (todas `MATCH`) y `h3_video.mjs check` en el frame 22380 (`PASS`, RGBA `e9e8fe44…`). No se regeneraron vídeos ni se repitieron búsquedas.

| Fase visible | `0x72` | Transición | Cinta final (`out/h3/explore/`) | SHA-256 cinta | RAM en `goalFrame` |
| --- | --- | --- | --- | --- | --- |
| 1 | 0→1 | **5890** | `tape-s2-phase-5950.json` (goal 5950) | `620200d77aabac60c8193a31b4985c5f7dc1399b9c55b39a5ec62e286ec40763` | `d5854d01bee9ad809f4992a3684f1267c9e88b9825a271a3f6f5485b602a24ff` |
| 2 | 1→2 | **16566** | `tape-fase2-completa-16980.json` (goal 16980) | `1b77dd6ba5e2798428edb97318b66c106f6bd297fc1fbf15ecffe248df65ccf5` | `825a13d0af28a906b43942f46d2f8088d225691fa4466b658b7983f7fbffa004` |
| 3 | 2→3 | **22029** | `tape-fase3-completa-22380.json` (goal 22380) | `9feecfa49b269ad0a0c6cb2e2b96b0e684d1ae7c1f76efef33c3ca96a552b1ed` | `00f267b13bfbb90b500cb493c25005dbeb81bba964ac6a2f5f3f1a682fcc59b5` |

Las señales finales de replay de esta sesión coinciden con `h3.signal`:

- 5950: `phase=1`, X=3373, 3 vidas, armadura puesta.
- 16980: `phase=2`, X=80, Y=574, 4 vidas, armadura puesta.
- 22380: `phase=3`, X=3632, Y=591, scroll=3584, 4 vidas, armadura puesta, `firstFatal=null`.

El replay completo desde reset da `minLives=3`.

**Vídeos y métricas locales** (`out/h3/video/`). Cada exportación se renombró a `faseN.{mp4,json}`; el campo `video` del JSON conserva el nombre original. Los SHA-256 de los MP4 coinciden con `videoSha256`, y los tres tienen `ramVerified=true`.

| Vídeo | Frames | Duración | Eventos `phase` | SHA-256 MP4 |
| --- | --- | --- | --- | --- |
| `fase1.mp4` | 1–5950 (5950) | 99,77 s | 0→1 en 5890 | `bc893b3f7b213b8202a23140bcbd1b1e71ce7e583331110d66864e636a2109bc` |
| `fase2.mp4` | 5950–16980 (11031) | 184,97 s | 1→2 en 16566 | `96a8131fbd701d20c70a67f0959c2be85bebe51805e8b4bfcb41995daed30b3d` |
| `fase3.mp4` (export `tape-fase3-completa-22380-9feecfa4-16980-22380`) | 16980–22380 (5401) | 90,56 s | 2→3 en 22029 (único) | `45767e6590d69154d46bbeafdf554d0736d05e78d1b94af49af1c2dd68319e8e` |

En el frame 22380 la fila de métricas marca `inGame=true`, `phase=3`, 4 vidas y armadura puesta. El handoff de la fase 3 registra ese frame como inicio jugable y visible de la fase 4. ffprobe de `fase3.mp4` (repetido hoy): h264, 256×224, 5401 frames, 90,56 s. El gate `verify_h3_phase3.sh` dio `H3_PHASE3_ACCEPTANCE=PASS` al cerrar la fase; no se repitió porque vuelve a exportar el vídeo.

### Procedencia y reproducción

**Fase 1.** Comandos reconstruidos a partir de los metadatos de las cintas:

```sh
node scripts/h3_explore.mjs explore 1                                              # S1 → tape-s1-5348-arena.json (f5cbb0c7…, RAM 8ad5a998…), 10.848 iteraciones
node scripts/h3_explore.mjs explore --from out/h3/explore/tape-s1-5348-arena.json 1 300   # → tape-s2-s1-5528-best.json (19e2108d…, jefe a 0)
node scripts/h3_finish_phase.mjs out/h3/explore/tape-s2-s1-5528-best.json         # p1.left 240 frames → tape-s2-phase-5950.json
```

Por §7, las dos primeras líneas pueden no regenerar los mismos bytes con el código actual.

**Fase 2.** La cinta registra `h3.prefix = tape-s2-phase-5950.json` y `h3.source = out/h3/boss/f2/maneuver-16882-next-stage.json` (`bf7c3dae…`, ruta `idle,idle`, segmento de 120 frames). La ruta de búsqueda intermedia, el hotel, los canales, los dos guardianes y la llave no tienen comandos registrados; están pendientes, como indica §8.

**Fase 3.** Secuencia ejecutada; cada paso lee la salida del anterior:

```sh
H3_SEED=out/h3/explore/tape-fase2-completa-16980.json H3_WIDTH=8 H3_STEP=120 H3_LAST=1 H3_WX=1 H3_WS=0 H3_WA=500 node scripts/h3_boss_search.mjs 2 16980 120 17580
H3_SEED=out/h3/boss/search-p2-17580.json H3_WIDTH=8 H3_STEP=120 H3_LAST=1 H3_WX=1 H3_WS=0 H3_WA=500 node scripts/h3_boss_search.mjs 2 17580 120 19020
H3_SEED=out/h3/boss/search-p2-19020.json H3_WIDTH=8 H3_STEP=120 H3_LAST=1 H3_WX=1 H3_WS=0 H3_WA=500 node scripts/h3_boss_search.mjs 2 19020 120 20520
H3_SEED=out/h3/boss/search-p2-20460.json H3_WIDTH=24 H3_STEP=60 H3_LAST=1 H3_WX=1 H3_WS=0.1 H3_WA=5000 node scripts/h3_boss_search.mjs 2 20460 60 21660
H3_HORIZON=240 H3_STEP=60 node scripts/h3_boss_maneuver.mjs out/h3/boss/search-p2-21660.json 21660 keyleft=left,left,left,left
H3_HORIZON=240 H3_STEP=60 node scripts/h3_boss_maneuver.mjs out/h3/boss/f2/maneuver-21660-keyleft.json 21900 return=right,right,right,right
H3_HORIZON=240 H3_STEP=60 node scripts/h3_boss_maneuver.mjs out/h3/boss/f2/maneuver-21900-return.json 22140 wait4=idle,idle,idle,idle
node scripts/h3_finalize_phase3.mjs out/h3/boss/f2/maneuver-22140-wait4.json 22380
bash scripts/verify_h3_phase3.sh out/h3/explore/tape-fase3-completa-22380.json
```

La tercera búsqueda termina en `end=20520`, pero su cabeza final (`H3_LAST`) se guarda como `search-p2-20460.json`, que es lo que lee la cuarta. Todos los intermedios siguen en `out/h3/boss/`. La llave se vio en pantalla después de que desapareciera el enemigo; la maniobra a la izquierda la recogió y activó la transición automática.

**Otras cintas útiles:**

- `out/h3/explore/tape-live-input-tape-session-1-2724.json`: import `gate=PASS`, paridad RGBA en el frame 1801 y pérdida de vida en el 2173. No completa ninguna fase.
- `out/h3/explore/tape-s2-mamecheck.json` (`7cc074f5…`): paridad MAME del estancamiento de S2.

## 11. Mantenimiento

### Convención de nombres (obligatoria desde la fase 4)

Los artefactos de una fase completada siguen el patrón de las fases 2 y 3. `N` es la fase **visible**, no el valor de `0x72`; por ejemplo, la fase 4 cierra con `0x72: 3→4`.

| Artefacto | Nombre | Ejemplo (fase 3) |
| --- | --- | --- |
| Cinta final | `out/h3/explore/tape-faseN-completa-<goalFrame>.json` | `tape-fase3-completa-22380.json` |
| Vídeo | `out/h3/video/faseN.mp4` | `fase3.mp4` |
| Métricas | `out/h3/video/faseN.json` | `fase3.json` |

- `h3_video.mjs export` escribe con el nombre largo (`<cinta>-<sha8>-<inicio>-<fin>`), que es el que comprueba el gate de aceptación. Cuando el gate da `PASS`, ese par MP4/JSON se renombra a `faseN.{mp4,json}`. El campo `video` del JSON conserva el nombre original, y `videoSha256` debe coincidir con el MP4 renombrado.
- El vídeo `faseN` empieza en el frame final del vídeo `fase(N−1)` y termina en el `goalFrame` de la cinta, que debe mostrar el inicio jugable de la fase N+1.
- `faseN` queda reservado para la fase completa y aceptada. Los tramos parciales conservan el nombre largo de la exportación. `fase-2-incomplete.{mp4,json}` es anterior a esta regla y se mantiene como histórico.
- La fase 1 también es anterior: su cinta se llama `tape-s2-phase-5950.json` y no se renombra, porque la cinta de la fase 2 (`h3.prefix`) y varios documentos la citan por ese nombre.
- Una herramienta nueva de sellado para la fase N escribe directamente `tape-faseN-completa-<goalFrame>.json`, igual que hace `h3_finalize_phase3.mjs`.

- Los resultados nuevos (cintas, hashes, vídeos) se registran en §10, y su estado de tarea en el plan del bot. Los handoffs futuros deben remitir a este README en lugar de copiar instrucciones.
- Si cambia una interfaz o una variable, actualizar §3–§4 y el comentario de cabecera del script en el mismo commit.
- No subir `roms/`, `out/`, `cfg/`, `gng-ghidra/`, cintas, capturas ni vídeos. No modificar motor, AOT, runtime ni bundles.
