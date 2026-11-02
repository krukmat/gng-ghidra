# Go-Explore y exploración H3 — entrada canónica

**Estado (2026-11-02):** fases visibles 1–5 completadas desde reset con cintas de solo entradas, replay `MATCH`, vídeo y métricas. Fase visible 6 aparcada: el primer intento derrotó a los dos jefes, pero el juego exigió el escudo y devolvió a la fase visible 5. V2–V4 del [plan del bot de control](../plan-bot-control-jugabilidad-2026-11-01.md) no iniciados.

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
| [`scripts/h3_finalize_phase.mjs`](../../scripts/h3_finalize_phase.mjs) + [`src/h3_phase_contract.mjs`](../../src/h3_phase_contract.mjs) | Sellado genérico, comprueba prefijo y transición fase N. | Vigente (validado en g6 con las fases 4 y 5) |
| [`scripts/verify_h3_phase.sh`](../../scripts/verify_h3_phase.sh) | Gate genérico, exporta y renombra `faseN` tras PASS. | Vigente (validado en g6 con las fases 4 y 5) |
| [`scripts/h3_run_logged.sh`](../../scripts/h3_run_logged.sh) | Registra las variables `H3_*`, cada comando, su salida y el código de retorno en `out/h3/phaseN/commands.log`. | Vigente |
| [`scripts/verify_h3_phase3.sh`](../../scripts/verify_h3_phase3.sh) | Gate de aceptación: prefijo, replays, paridad RGBA, exportación y ffprobe. | Especializada (fase 3) |
| [`scripts/h3_video.mjs`](../../scripts/h3_video.mjs) | Cinta → paridad RGBA con la app, MP4 y JSON de métricas. | Vigente |
| [`scripts/h3_boss_inspect.mjs`](../../scripts/h3_boss_inspect.mjs) | Etiquetas y sprites visibles en frames concretos. | Diagnóstico |
| [`scripts/h3_boss_trace.mjs`](../../scripts/h3_boss_trace.mjs) + [`src/h3_lab_trace.mjs`](../../src/h3_lab_trace.mjs) | Traza causal neutral de un rango de RAM. | Diagnóstico |
| [`scripts/h3_boss_coverage.mjs`](../../scripts/h3_boss_coverage.mjs) | Bloques compilados que ejecutan las cintas y ninguna cinta certificada. | Diagnóstico |
| [`scripts/h3_static_cover.mjs`](../../scripts/h3_static_cover.mjs) | Cierre estático frente al bundle. Solo mide. | Diagnóstico |
| [`scripts/h3_tape.mjs`](../../scripts/h3_tape.mjs) + [`scripts/h3_tape_recorder.lua`](../../scripts/h3_tape_recorder.lua) + [`src/h3_tape_convert.mjs`](../../src/h3_tape_convert.mjs) | Grabador MAME → cinta B3, con rebobinado e ida y vuelta. | Vigente (requiere MAME) |
| [`src/h3_live_import.mjs`](../../src/h3_live_import.mjs) | Cinta en vivo (app) → eventos B3 al inicio de frame, para `import`. | Vigente |
| [`src/h3_lab_poke.mjs`](../../src/h3_lab_poke.mjs) | `H3_POKE`: escrituras de RAM de laboratorio. | Solo laboratorio; prohibido en cintas de fase |

Tests: [`tests/test_h3_phase_contract.mjs`](../../tests/test_h3_phase_contract.mjs) (contrato de fase, sin ROM), [`tests/test_h3_explore.mjs`](../../tests/test_h3_explore.mjs), [`test_h3_lab_maneuver.mjs`](../../tests/test_h3_lab_maneuver.mjs), [`test_h3_lab_trace.mjs`](../../tests/test_h3_lab_trace.mjs) y [`test_h3_tape_convert.mjs`](../../tests/test_h3_tape_convert.mjs). Se ejecutan con `node --test tests/test_h3_*.mjs`.

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
  - Con `--from`, reproduce la cinta hasta `h3.goalFrame` y exige `h3.ramSha` igual. Si la cinta tiene `inputsLive=false`, se niega a arrancar. El objetivo es `0x72 ≠` la fase inicial. `H3_RANK=y` ordena por armadura y después altura; `H3_RANK=height` prioriza altura ([§6](#6-criterios-de-búsqueda)).
  - Escribe `out/h3/explore/cells-[s2-]s<seed>-i<iters>.json` (sin snapshots) y `tape-[s2-]s<seed>-<frame>-{arena|phase|best}.json`, con `frames = goalFrame + 60`. El prefijo `s2-` indica `--from`, sea cual sea la fase. La cinta suelta todos los controles en `goalFrame`, así que un haz que continúe desde ella empieza en `goalFrame + 1`.
- **replay** (0 `MATCH`/`NO_REFERENCE`, 1 `MISMATCH`, 3 parada): reproduce desde reset sin restore hasta `h3.goalFrame`. Compara `ramSha`, `signal` y, si existe, `transitionFrame`.
- **import**: produce `tape-live-<nombre>-<frame>.json` y fija `inputsLive`. Termina con código 3 si `check.record_sha256` falla, o si no hay check y falta `--unverified`.

### `h3_boss_search.mjs`

```sh
[H3_SEED=<tape>] [H3_*=...] node scripts/h3_boss_search.mjs <fase-RAM> [start=2200] [step=60] [end=9000]
```

- `<fase-RAM>` es el valor de `0x72` que debe tener la placa en `start`; si no coincide, falla con `H3_BOSS_START_PHASE`.
- En cada profundidad prueba las 14 acciones desde cada miembro del haz. Poda las ramas muertas o con vidas perdidas, deduplica por posición, armadura, handler, puntuación y scroll, y se queda con `H3_WIDTH` ramas.
- Valor de una rama: `WX·min(maxX, XCAP) + WY·maxY + WCY·min(Y, YCAP) + WU·(y0 − minY) + WS·score − WA·armor − WB·Σvida`.
- Escribe `out/h3/boss/search-p<fase>-<frame>.json` con `frames = frame + 300` y `h3:{poke, route, ...}` (0 `PHASE_ADVANCED`, 2 sin avance). Sin `H3_POKE`, `h3` añade `goalFrame` (la cabeza guardada), `signal` y `ramSha`: `replay` la verifica y `explore --from` continúa desde ella. Estos campos no cambian el SHA de la cinta.

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
node scripts/h3_finalize_phase.mjs <fase-visible> <cinta-semilla> <candidata> <goalFrame>
bash scripts/verify_h3_phase.sh <fase-visible> <cinta-semilla> <cinta-final>
bash scripts/h3_run_logged.sh <fase-visible> <comando> [args...] # log privado de comandos y salidas
```

- `finish_phase` exige `h3.goalFrame ≥ 1200`, `ramSha` y `bossLife=0`. Prueba `p1.left` y `p1.right` mantenidos 120, 180, 240, 272 y 320 frames, con un horizonte de 500. Gana la primera variante que cambia `0x72`, y el objetivo queda en la transición + 60.
- `finalize_phase3` tiene fijados la cinta inicial, sus hashes, `START=16980` y g6, y rechaza `H3_POKE`. Exige exactamente una transición `2→3` y controles P1 liberados.
- El gate histórico de fase 3 vuelve a exportar el vídeo y escribe logs en `/tmp/h3-phase3-*.log`.
- `finalize_phase` usa la fase visible N, la cinta inicial y el frame de corte de `h3.goalFrame`; exige g6, prefijo exacto, solo entradas P1 nuevas, controles liberados y una transición RAM N−1→N. No altera `finalize_phase3`.
- `verify_h3_phase.sh` recibe fase N, semilla y cinta final; comprueba hashes, replay MATCH de ambas, RGBA, MP4, `ffprobe`, `ramVerified=true` y exactamente un evento de fase. Tras PASS renombra los archivos a `faseN.{mp4,json}`. La fase 3 conserva su gate antiguo e interfaz.
- `h3_run_logged.sh` envuelve cada comando que contribuya a la cinta: registra las variables `H3_*` del entorno, argumentos, salida y código de retorno en `out/h3/phaseN/commands.log`; usarlo en cada búsqueda, maniobra, sellado y gate. **No** copiar comandos sin ejecución a §10 como si fueran resultados.

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
| `H3_WCY`, `H3_YCAP` | boss_search | 0, 65535 | Peso de Y actual y su tope; evita premiar una altura ya abandonada. |
| `H3_WA` | boss_search | 2000 | Penalización por perder la armadura. |
| `H3_WB`, `H3_BOSS_LIFE` | boss_search | 0, `0xe76` | Peso y direcciones de vida sumadas. Ver [§8](#8-limitaciones-reales). |
| `H3_XCAP` | boss_search | 65535 | Tope de X premiada (arenas). |
| `H3_LAST` | boss_search | — | Guarda la cabeza final del haz en lugar de la mejor. |
| `H3_BACKTRACK`, `H3_BACKTRACK_LIMIT` | boss_search | 0, ilimitado | Retrocede N segmentos cuando mueren todas las ramas. |
| `H3_DEBUG` | boss_search | — | Registra cada rama podada. |
| `H3_RANK` | explore | `x` | Solo con `--from`: `y` ordena por armadura y luego altura; `height`, por altura y luego armadura. Para subidas en las que X y scroll no crecen. |
| `H3_HORIZON` | maneuver | 240 (máx.) | Horizonte de cada ruta. |
| `H3_MANEUVER_REF` | maneuver | — | `<ram.bin>:<firstRecord>` de una traza para comparar el control. |
| `H3_TRACE_WATCH`, `H3_TRACE_BASELINE` | trace | `0x510:2`, — | Rango vigilado y comparación con una salida de inspect. |
| `H3_TAB` | static_cover | 64 | Tamaño de tabla del cierre estático. |
| `H3_POKE` | search / maneuver / inspect / trace / coverage | — | `from:to:addr:value,...`. Solo laboratorio. Lo rechazan `finalize_phase3` y el gate. |
| `GNG_H3_*` | h3_tape → recorder.lua | — | Los fija `h3_tape.mjs`; no se ponen a mano. |

## 5. Flujo completo

1. **Preflight.** Comprobar que existen `node`, `ffmpeg`/`ffprobe`, `roms/gng.zip` y el bundle certificado g6. Después, reproducir la cinta semilla y exigir `MATCH`:
   ```sh
   node scripts/h3_explore.mjs replay out/h3/explore/tape-fase4-completa-28260.json
   ```
2. **Semilla.** Elegir una de tres: reset (`explore` sin `--from`), una cinta final con `h3.goalFrame` y `h3.ramSha` (`--from` o `H3_SEED`), o una cinta en vivo importada (`import`). Para ramificar, el prefijo debe tener los controles liberados en el punto de corte; si no, usar `h3_boss_maneuver.mjs`, que los libera.
3. **Exploración y búsqueda.** El método depende del tramo ([§6](#6-criterios-de-búsqueda)). Cada búsqueda guarda una cinta reanudable, que se encadena con `H3_SEED` o pasándola a `h3_boss_maneuver.mjs`.
4. **Cinta final.** Sellarla con `h3.goalFrame`, `h3.signal`, `h3.ramSha` y `h3.transitionFrom`/`transitionFrame`, sin poke. Para las fases visibles 4 y posteriores usar `h3_finalize_phase.mjs` con fase N, semilla, candidata y `goalFrame`. Para fase 3 se mantiene `finalize_phase3`. No sobrescribir la cinta de entrada.
5. **Replay.** `h3_explore.mjs replay <final>` debe dar `MATCH`.
6. **Vídeo y aceptación.** Comprobar con `h3_video.mjs check <final> <goalFrame>` y exportar con `h3_video.mjs export <final> <goalFrame> <inicio>`, compartiendo el primer frame con el vídeo anterior. Revisar con ffprobe el códec, el tamaño, el número de frames, el evento `phase` y `ramVerified=true`. Para las fases visibles 4 y posteriores, `verify_h3_phase.sh` hace todo esto (incluido el renombrado tras PASS); la fase 3 conserva `verify_h3_phase3.sh`.

## 6. Criterios de búsqueda

- **Go-Explore.**
  - Celda: `(fase, checkpoint, X>>4, Y>>3, armadura)`. Con `--from` se añade el byte `0x0E76`.
  - Cada celda guarda la trayectoria que conserva la armadura y, a igualdad, la que tarda menos frames.
  - Selección: peso `(1 + scrollBonus·min(scroll, 3072)/3072)/√(1+elegida)`.
  - Exploración: 120 frames de acciones pegajosas, generadas con mulberry32 de semilla fija y evaluadas cada 4 frames. La rama se corta al primer estado fatal. Un impacto con armadura no corta; genera otra celda.
  - Mejor celda en S1: scroll y luego X. Con `--from`: fase, luego menos vida y luego X. Con `H3_RANK=y`: fase, armadura conservada y luego altura Y. Con `H3_RANK=height`: fase, altura y luego armadura; permite continuar desde una planta superior aunque una recogida de armadura deje una celda mejor equipada más abajo.
- **Haz.** Macros fijas (`right`, `right_fire`, `right_jump`, `right_fire_jump`, `right_late_jump`, `fire`, `jump`, `duck_fire`, `left`, `left_fire`, `left_jump`, `up`, `up_fire`, `down`) con el valor de §3. Sirvió para avanzar en las fases 2 y 3 con segmentos de 120 frames en tramos abiertos y de 60 junto a peligros. En la torre de la fase 5, el valor por `maxY` engaña cuando la siguiente escalera queda lejos del máximo. Allí se alternó Go-Explore con `H3_RANK=y` (escaleras) y el haz con `H3_WY=3 H3_WS=1` (enemigos y jefe).
- **Maniobras.** Rutas cortas escritas a mano tras una observación (por ejemplo, ir a por la llave y esperar la transición). No buscan: comparan como máximo tres variantes contra el control.
- **Cierre de fase.** Matar al jefe no cierra la fase: en las fases 1–5 hubo que esperar a que apareciera la llave y recogerla. Premiar la X deja al bot esperando en el extremo derecho. El criterio de cierre es siempre la transición RAM `0x72`, comprobada en el replay y en el vídeo.

### GE-W1 — guarda de arma en el encuentro final (rama `feature/ge-w1-weapon-aware-progression`)

- El contrato de `src/h3_weapon_policy.mjs` se activa **solo** al empezar una búsqueda con `RAM[0x72]=5` (fase visible 6): arma `RAM[0x73]=3` (Shield/Cross). Sin precondición cumplida, una transición hacia adelante no es éxito; `5→4` con arma distinta de 3 se clasifica `INVALID_WEAPON_ROLLBACK` y se poda.
- `src/h3_explore.mjs` añade el arma a la clave de celda solo en RAM fase 5, por lo que las rutas con armas diferentes no se fusionan. `explore --from` reserva el 80% de las selecciones para celdas con escudo (si existen) y 20% para rutas alternativas, ignora retrocesos como objetivos y reporta `GO_PROGRESSION_CANDIDATE` si detecta avance con el arma correcta.
- `h3_boss_search.mjs` observa la misma dirección, conserva rutas con diferentes armas en la deduplicación y ordena lexicográficamente primero por escudo, después por la puntuación histórica (sin bonificación arbitraria). Poda cambios de fase inválidos (contabilizados en `invalidTransitions`); con la política activa informa `PROGRESSION_CANDIDATE`, nunca una sala final certificada.
- La comprobación utiliza el arma observada **en el frame anterior al cambio de fase**, por si la escena posterior reinicia `0x73`. `replay` mantiene `MATCH` para verificar determinismo, pero además imprime `H3_REPLAY_PHASE_GUARD` con la clasificación del retroceso; un `MATCH` no significa fase completada.
- **No impedir disparos sin el escudo:** son necesarios para abrir vasijas y obtener drops. Aún no existe una señal RAM fiable de inicio del encuentro para bloquear únicamente el combate contra los dos jefes. Tampoco se supone una fase 7 ni se infiere el segundo ciclo de un cambio en `0x72`.
- Validación local T5 (2026-11-02): tests dirigidos **13/13 PASS**, suite `tests/test_h3_*.mjs` **25/25 PASS** y sintaxis de los cuatro módulos **PASS**. En bundle g6, semilla y candidata dieron `MATCH`; la candidata reportó `H3_REPLAY_PHASE_GUARD` con `45814: 5→4`, `weaponAtExit=4` e `INVALID_WEAPON_ROLLBACK`. Los comandos están en `out/h3/phase6/commands.log`. No ejecutar `finalize` ni `verify_h3_phase.sh 6` sin prueba de un final real.

### GE-W2 — localización del escudo (rama `feature/ge-w2-shield-acquisition`)

**Estado:** herramientas y tests preparados; no se ha ejecutado una nueva exploración con los archivos privados ni se ha demostrado un pickup. GE-W1 sigue certificado; fase visible 6 sigue pendiente.

1. **Auditar primero la ruta histórica**, sin búsqueda ni alteraciones: `bash scripts/h3_run_logged.sh 6 node scripts/h3_weapon_probe.mjs out/h3/boss/search-p5-45828.json 36091`. Reproduce desde reset con g6, exige `ramSha` y `H3_POKE` vacío, y guarda `out/h3/phase6/weapon-probe-search-p5-45828.json` con cambios de arma (`0x73`), fase, X/Y y frame exacto. Una transición de RAM no prueba por sí sola dónde apareció el objeto; correlacionar con vídeo/sprites cuando haya candidatos.
2. **Buscar y detenerse en la adquisición**, no en el combate final: `H3_GOAL=weapon H3_RANK=height bash scripts/h3_run_logged.sh 6 node scripts/h3_explore.mjs explore --from out/h3/explore/tape-fase5-completa-36091.json 1 6000 30`. `H3_GOAL=weapon` solo acepta una semilla de fase RAM 5 que todavía no tenga arma 3. La meta es `phase=5 && weapon=3`; genera `tape-...-weapon.json` con `h3.objective=WEAPON_ACQUIRED`, `weaponPickupFrame`, `goalFrame` y `ramSha`. El checkpoint del arma conserva también las entradas P1 del propio `goalFrame` y libera controles en el siguiente frame; `explore --from` reconoce esos checkpoints y preserva su corte inclusivo para evitar divergencias en RAM. La cinta de objetivo arma **omite** `h3.transitionFrame` porque obtener el escudo no implica cambiar de fase; así `replay MATCH` valida RAM y señal sin exigir la transición histórica 0→1. Siempre exige replay `MATCH` desde reset antes de aprovechar esa cinta. **No es una finalización de fase.**
3. Si la búsqueda no consigue el escudo, conserva `*-best.json` y `cells-*.json` para análisis; no inventes la ubicación, no asumas un segundo ciclo, no uses `H3_POKE` ni promociones `fase6`.
4. Para continuar tras el pickup, verificar que `0x73=3` en el `goalFrame` y usar esa nueva cinta como semilla de `explore --from` (sin `H3_GOAL=weapon`) o del haz, según las condiciones. La transición de sala final sigue siendo `PROGRESSION_CANDIDATE` hasta vídeo, RAM y código.

Tests puramente lógicos: `node --test tests/test_h3_weapon_goal.mjs tests/test_h3_weapon_policy.mjs tests/test_h3_explore.mjs`. El probe requiere el bundle g6, la ROM y las cintas privadas locales. Cada comando ejecutado debe registrarse con `h3_run_logged.sh`.

## 7. Determinismo y snapshots de laboratorio

- El motor es determinista: la misma cinta da la misma RAM. Los snapshots (`lab.save`/`restore`) solo sirven para saltar entre ramas. Nunca escriben RAM ni entran en la cinta. La cinta final se valida reproduciéndola desde reset, sin restore.
- `explore` es función pura de semilla, iteraciones, cinta semilla, bundle y código **mientras termine por objetivo o por `iters`**. El límite `minutes` depende del reloj: si es lo que corta la búsqueda, el resultado cambia con la máquina.
- La búsqueda en haz y las maniobras no usan azar. Dependen solo de sus parámetros y de la cinta.
- El explorador se corrigió en `b2b9f6a` (`extendMasks`). Las cintas de S1/S2 son anteriores, así que no está comprobado que el código actual las regenere byte a byte. Su evidencia es el replay `MATCH`.
- Una cinta con `H3_POKE` no es una cinta de solo entradas: `replay` no aplica pokes y no sirve para certificar.

## 8. Limitaciones reales

- `replay` solo verifica cintas con `h3.ramSha`. Las cintas de maniobra y las de búsqueda con `H3_POKE` (`h3:{poke, route, ...}`) dan `MISMATCH` por construcción; para revisarlas, usar `h3_boss_inspect.mjs` o sellarlas. Las de búsqueda sin poke llevan `ramSha` desde la fase 5 y dan `MATCH`.
- Un haz con `H3_SEED` de una cinta `explore` que empiece en su `goalFrame` falla con `V3_B1_INPUT_IMPOSSIBLE_TRANSITION`, porque los eventos de liberación de ese ciclo quedan fuera de la base. Hay que empezar en `goalFrame + 1`.
- Sin `h3.transitionFrom`, `replay` compara la **primera** transición desde el frame 1200. Por eso la cinta de fase 2 comprueba 5890 (0→1). Su transición 1→2 (16566) está en `h3.phaseCompletionFrame` y en los eventos del vídeo, pero el replay no la comprueba.
- **Vida del jefe:** `0x0E76` (`BOSS_LIFE`) solo está validada para el jefe de la fase 1: empieza en 5, baja 1 por golpe y no cambia sin disparo; comprobado con las semillas 7 y 11. En fases posteriores puede ser otro objeto (por ejemplo, un ogro de la fase 2). Por tanto:
  - `explore --from` la incluye en la celda sea cual sea la fase;
  - `finish_phase` la exige a 0;
  - el `bossKill` de `replay` solo tiene sentido en la fase 1.
  - `0xc66,0xcf6` se usaron en la fase 2 como vida conjunta de los guardianes; no consta su validación.
  - Las fases 3, 4 y 5 se completaron con `H3_WB=0`, sin ningún contador de jefe. En la fase 5, `0x0E76` vale 4 en todo el tramo. **No hay contador de jefe validado para las fases 2–5.**
- **Poda del haz:** `h3_boss_search.mjs` solo poda por handler, impacto sin armadura o vidas perdidas al final del segmento. Una caída a un foso no cambia el handler hasta que se pierde la vida (en la fase 4, unos 120 frames después), así que con `H3_LAST` la cabeza guardada puede ser una rama ya condenada. Revisar el final de cada cinta de búsqueda con un export corto o `inspect`, y reanudar desde un frame anterior a la caída. En la fase 5, la cabeza de 34470 recibía un impacto sin armadura en 34600. Repetir el tramo con un `end` más lejano (35670) lo evitó: el haz siguió más allá de 34470, podó las ramas golpeadas y conservó las vivas, sin retrocesos.
- **Reloj de fase (3:00):** no tiene dirección RAM validada; se vigila en el HUD de los exports cortos. En la fase 5, el jefe cayó con 1:14 restantes.
- `maneuverOutcome` calcula `advance` y `aboveLimit` con `limit=5464`, que es la geometría de H3-F2. En otros tramos esos campos no significan nada.
- `h3_finish_phase.mjs` está pensado para el primer jefe. `h3_finalize_phase3.mjs` y `verify_h3_phase3.sh` tienen fijados la cinta, los hashes y el frame 16980 de la fase 3. Para las fases 4 en adelante se usan `h3_finalize_phase.mjs` y `verify_h3_phase.sh`.
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
| [`agents/h3-phase4-bot-task.md`](../agents/h3-phase4-bot-task.md) | Encargo de la fase 4, cumplido (02/11). Evidencia en §10. |
| [`agents/h3-phase5-bot-task.md`](../agents/h3-phase5-bot-task.md) | Encargo de la fase 5, cumplido (02/11). Evidencia en §10. |
| [`plan-bot-control-jugabilidad-2026-11-01.md`](../plan-bot-control-jugabilidad-2026-11-01.md) | **Vigente** como lista de tareas (V2–V4) y registro de V1. Los detalles operativos remiten aquí. |

## 10. Resultados verificados

Todas las cintas son de solo entradas, sin poke y sobre el bundle g6. El 2026-11-02 se repitieron `replay` de las cuatro cintas (todas `MATCH`) y `h3_video.mjs check` en el frame 22380 (`PASS`, RGBA `e9e8fe44…`). No se regeneraron vídeos ni se repitieron búsquedas.

**Fase visible 6, aparcada.** El intento reproducible `out/h3/boss/search-p5-45828.json` (SHA-256 `67dc51ddfd05334a3978f8355b2b04ecb1f482facfe1e495ea0571e9ebe99d77`) derrota a los dos jefes, pero lleva `0x73=4`. El juego muestra `THIS WEAPON HAS NOT EFFECT... TRY AGAIN!! GET A` junto al escudo y cambia `0x72:5→4` en el frame 45814; por tanto no cumple el objetivo `5→6` ni constituye un segundo ciclo. En la auditoría GE-W1 su replay volvió a dar `MATCH gen=g6` y el guard registró exactamente `weaponAtExit=4`, `outcome=INVALID_WEAPON_ROLLBACK`; la semilla de fase 5 también dio `MATCH`. El vídeo diagnóstico `out/h3/video/search-p5-45828-67dc51dd-36091-45828.mp4` cubre los frames 36091–45828, pasa la decodificación completa y la paridad RGBA en el frame 45528; SHA-256 `3f4d6abd8bc4617501918a586102f4e7e4b3b72ba64920f4ab289d7663cf71da`. La continuación queda aparcada hasta determinar una ruta de solo entradas que obtenga el escudo (`0x73=3`). No existe todavía cinta final, `fase6.mp4` ni gate de aceptación.

| Fase visible | `0x72` | Transición | Cinta final (`out/h3/explore/`) | SHA-256 cinta | RAM en `goalFrame` |
| --- | --- | --- | --- | --- | --- |
| 1 | 0→1 | **5890** | `tape-s2-phase-5950.json` (goal 5950) | `620200d77aabac60c8193a31b4985c5f7dc1399b9c55b39a5ec62e286ec40763` | `d5854d01bee9ad809f4992a3684f1267c9e88b9825a271a3f6f5485b602a24ff` |
| 2 | 1→2 | **16566** | `tape-fase2-completa-16980.json` (goal 16980) | `1b77dd6ba5e2798428edb97318b66c106f6bd297fc1fbf15ecffe248df65ccf5` | `825a13d0af28a906b43942f46d2f8088d225691fa4466b658b7983f7fbffa004` |
| 3 | 2→3 | **22029** | `tape-fase3-completa-22380.json` (goal 22380) | `9feecfa49b269ad0a0c6cb2e2b96b0e684d1ae7c1f76efef33c3ca96a552b1ed` | `00f267b13bfbb90b500cb493c25005dbeb81bba964ac6a2f5f3f1a682fcc59b5` |
| 4 | 3→4 | **27849** | `tape-fase4-completa-28260.json` (goal 28260) | `ca3be0033ff46cbe28e2b10870b698369505725de352253b7ec183ded62926ac` | `182df0da9c2a2451bf157d088b42c528af6f4771fed00c43ac3984e66c0a61dd` |
| 5 | 4→5 | **35680** | `tape-fase5-completa-36091.json` (goal 36091) | `0c3d5e95ee8fb7e2d2bb272792736f5a3abfdd0669730278686b22de3ed1f96c` | `18190b0a03bacac74a2c81e7b1ad82c0b0256d2fba6ef173057cc7811ae7fd71` |

Las señales finales de replay de esta sesión coinciden con `h3.signal`:

- 5950: `phase=1`, X=3373, 3 vidas, armadura puesta.
- 16980: `phase=2`, X=80, Y=574, 4 vidas, armadura puesta.
- 22380: `phase=3`, X=3632, Y=591, scroll=3584, 4 vidas, armadura puesta, `firstFatal=null`.
- 28260 (fase 4, replay del 02/11 dentro del gate): `phase=4`, `cp=0`, X=6736, Y=575, scroll=6656, 4 vidas, armadura puesta; en el tramo 22380–28260, `minLives=4` y `firstFatal=null`.
- 36091 (fase 5, replay del 02/11 dentro del gate): `phase=5`, `cp=0`, X=7472, Y=1615, scroll=7424, 5 vidas, armadura puesta; en el tramo 28260–36091, `minLives=4` y `firstFatal=null`.

El replay completo desde reset da `minLives=3`.

**Vídeos y métricas locales** (`out/h3/video/`). Cada exportación se renombró a `faseN.{mp4,json}`; el campo `video` del JSON conserva el nombre original. Los SHA-256 de los MP4 coinciden con `videoSha256`, y los cinco tienen `ramVerified=true`.

| Vídeo | Frames | Duración | Eventos `phase` | SHA-256 MP4 |
| --- | --- | --- | --- | --- |
| `fase1.mp4` | 1–5950 (5950) | 99,77 s | 0→1 en 5890 | `bc893b3f7b213b8202a23140bcbd1b1e71ce7e583331110d66864e636a2109bc` |
| `fase2.mp4` | 5950–16980 (11031) | 184,97 s | 1→2 en 16566 | `96a8131fbd701d20c70a67f0959c2be85bebe51805e8b4bfcb41995daed30b3d` |
| `fase3.mp4` (export `tape-fase3-completa-22380-9feecfa4-16980-22380`) | 16980–22380 (5401) | 90,56 s | 2→3 en 22029 (único) | `45767e6590d69154d46bbeafdf554d0736d05e78d1b94af49af1c2dd68319e8e` |
| `fase4.mp4` (export `tape-fase4-completa-28260-ca3be003-22380-28260`) | 22380–28260 (5881) | 98,61 s | 3→4 en 27849 (único) | `ededc65212aa29e7ff96b18cbbf9b8e4a0196b1f24e3a20d21f08c3f8f941f87` |
| `fase5.mp4` (export `tape-fase5-completa-36091-0c3d5e95-28260-36091`) | 28260–36091 (7832) | 131,33 s | 4→5 en 35680 (único) | `dc78375a319782ca23179527914c326e253c365ba60083eb4c9b8371d64b1755` |

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

**Fase 4.** Secuencia registrada en `out/h3/phase4/commands.log` (con variables `H3_*`); cada paso lee la salida del anterior:

```sh
node scripts/h3_explore.mjs replay out/h3/explore/tape-fase3-completa-22380.json                     # MATCH
H3_SEED=out/h3/explore/tape-fase3-completa-22380.json H3_WIDTH=8 H3_STEP=120 H3_LAST=1 H3_WX=1 H3_WS=0 H3_WA=500 node scripts/h3_boss_search.mjs 3 22380 120 23580
H3_SEED=out/h3/boss/search-p3-23460.json H3_WIDTH=16 H3_STEP=60 H3_LAST=1 H3_WX=1 H3_WS=0 H3_WA=2000 H3_BACKTRACK=2 H3_BACKTRACK_LIMIT=30 node scripts/h3_boss_search.mjs 3 23220 60 24420
H3_SEED=out/h3/boss/search-p3-23700.json H3_WIDTH=16 H3_STEP=60 H3_LAST=1 H3_WX=1 H3_WY=3 H3_WS=0 H3_WA=2000 H3_BACKTRACK=2 H3_BACKTRACK_LIMIT=40 node scripts/h3_boss_search.mjs 3 23340 60 24540
H3_SEED=out/h3/boss/search-p3-24540.json H3_WIDTH=24 H3_STEP=60 H3_LAST=1 H3_WX=1 H3_WY=1 H3_WS=1 H3_WA=100000 H3_BACKTRACK=3 H3_BACKTRACK_LIMIT=40 node scripts/h3_boss_search.mjs 3 24180 60 25380
H3_SEED=out/h3/boss/search-p3-25380.json H3_WIDTH=24 H3_STEP=60 H3_LAST=1 H3_WX=1 H3_WY=1 H3_WS=1 H3_WA=100000 H3_BACKTRACK=3 H3_BACKTRACK_LIMIT=40 node scripts/h3_boss_search.mjs 3 25380 60 27780
H3_HORIZON=240 H3_STEP=60 node scripts/h3_boss_maneuver.mjs out/h3/boss/search-p3-27780.json 27480 keyleft=left,left,left,left
H3_HORIZON=240 H3_STEP=60 node scripts/h3_boss_maneuver.mjs out/h3/boss/f2/maneuver-27480-keyleft.json 27720 wait4=idle,idle,idle,idle
H3_HORIZON=240 H3_STEP=60 node scripts/h3_boss_maneuver.mjs out/h3/boss/f2/maneuver-27720-wait4.json 27960 wait4=idle,idle,idle,idle
H3_HORIZON=240 H3_STEP=60 node scripts/h3_boss_maneuver.mjs out/h3/boss/f2/maneuver-27960-wait4.json 28200 wait4=idle,idle,idle,idle
node scripts/h3_finalize_phase.mjs 4 out/h3/explore/tape-fase3-completa-22380.json out/h3/boss/f2/maneuver-28200-wait4.json 28260
bash scripts/verify_h3_phase.sh 4 out/h3/explore/tape-fase3-completa-22380.json out/h3/explore/tape-fase4-completa-28260.json
```

- Las búsquedas terminan con código 2 (`NOT_ADVANCED`): cada una es un tramo, no la transición. Las tres primeras se quedaron sin ramas vivas o acabaron en una caída a un foso (ver §8 «Poda del haz»), así que la siguiente reanuda unos frames antes del final de la anterior; la quinta continúa justo en el final de la cuarta (25380).
- Tramo: plataformas flotantes y muro de roca (necesitó `H3_WY`), demonio rojo volador hacia 24200 (abatido con `H3_WS=1` y `H3_WA=100000`), checkpoint `cp` 0→1 en 25138, puente de lava y jefe abatido hacia 27180. Aparece «TAKE A KEY FOR COMING IN!»; `keyleft` recoge la llave en X≈6445 y la transición llega sola en 27849, sin más entradas. La fase 5 se dibuja hacia 28195 y el reloj corre desde 28220.
- Gate (`out/h3/phase4/gate.log`): `H3_PHASE_PREFIX=PASS`, replay `MATCH` de las dos cintas, `H3_VIDEO_CHECK=PASS` en 28260 (RGBA `a39323dae179ab555bdb3c9d4c3f506f8f0d7e0f55e77efe81e1b8dd71eea73f`), ffprobe h264 256×224 5881 frames y `H3_PHASE4_ACCEPTANCE=PASS`. `fase4.mp4` ocupa 13.078.458 bytes.
- La secuencia se repitió entera desde la semilla, con el registrador ya corregido: los cinco tramos, las cuatro maniobras y la cinta final salieron idénticos byte a byte (archivo `77b06535…`). Copias de los intermedios en `out/h3/phase4/steps/`. Los comandos de diagnóstico (exports cortos e `inspect`) y las maniobras descartadas (`keyleft3`, `return`) están en el log pero no contribuyen a la cinta.
- El frame 22380 de `fase4.mp4` coincide en métricas RAM con el último de `fase3.mp4`; en píxeles decodificados difiere por la recodificación H.264 (PSNR ≈ 40 dB).

**Fase 5.** Secuencia registrada en `out/h3/phase5/commands.log` (con variables `H3_*`); cada paso lee la salida del anterior:

```sh
node scripts/h3_explore.mjs replay out/h3/explore/tape-fase4-completa-28260.json                     # MATCH
H3_RANK=y node scripts/h3_explore.mjs explore --from out/h3/explore/tape-fase4-completa-28260.json 1 4000
H3_SEED=out/h3/explore/tape-s2-s1-29076-best.json H3_WIDTH=16 H3_STEP=60 H3_LAST=1 H3_WX=0.2 H3_WY=3 H3_WS=1 H3_WA=100000 H3_BACKTRACK=2 H3_BACKTRACK_LIMIT=30 node scripts/h3_boss_search.mjs 4 29077 60 29977
H3_SEED=out/h3/boss/search-p4-29977.json H3_WIDTH=16 H3_STEP=60 H3_LAST=1 H3_WX=0.2 H3_WY=3 H3_WS=1 H3_WA=100000 H3_BACKTRACK=2 H3_BACKTRACK_LIMIT=30 node scripts/h3_boss_search.mjs 4 29977 60 31177
H3_RANK=y node scripts/h3_explore.mjs explore --from out/h3/boss/search-p4-31177.json 1 15000
H3_RANK=y node scripts/h3_explore.mjs explore --from out/h3/explore/tape-s2-s1-32097-best.json 1 6000
H3_RANK=y node scripts/h3_explore.mjs explore --from out/h3/explore/tape-s2-s1-32801-best.json 1 6000
H3_SEED=out/h3/explore/tape-s2-s1-33269-best.json H3_WIDTH=16 H3_STEP=60 H3_LAST=1 H3_WX=0.2 H3_WY=3 H3_WS=1 H3_WA=0 H3_BACKTRACK=3 H3_BACKTRACK_LIMIT=60 node scripts/h3_boss_search.mjs 4 33270 60 35670
H3_HORIZON=240 H3_STEP=60 node scripts/h3_boss_maneuver.mjs out/h3/boss/search-p4-35670.json 35310 keyleft=left,left,left,left
H3_HORIZON=240 H3_STEP=60 node scripts/h3_boss_maneuver.mjs out/h3/boss/f2/maneuver-35310-keyleft.json 35550 wait4=idle,idle,idle,idle
H3_HORIZON=240 H3_STEP=60 node scripts/h3_boss_maneuver.mjs out/h3/boss/f2/maneuver-35550-wait4.json 35790 wait4=idle,idle,idle,idle
H3_HORIZON=240 H3_STEP=60 node scripts/h3_boss_maneuver.mjs out/h3/boss/f2/maneuver-35790-wait4.json 36030 wait4=idle,idle,idle,idle
node scripts/h3_finalize_phase.mjs 5 out/h3/explore/tape-fase4-completa-28260.json out/h3/boss/f2/maneuver-36030-wait4.json 36091
bash scripts/verify_h3_phase.sh 5 out/h3/explore/tape-fase4-completa-28260.json out/h3/explore/tape-fase5-completa-36091.json
```

- Cada búsqueda es un tramo, no la transición. Los haces terminan con código 2 (`NOT_ADVANCED`) y los `explore`, con `NOT_REACHED` al agotar `iters`. Cada `explore` guarda su mejor celda (`-best`); con `H3_RANK=y` es la más alta, con prioridad para las que conservan la armadura. Los haces que siguen a un `explore` empiezan en `goalFrame + 1` (29077 y 33270; ver §8).
- Tramo: una torre vertical de pisos unidos por escaleras (Y 575→1615). El scroll `0x58` se queda en 6656, así que el progreso se mide en Y.
  - El suelo inferior acaba en un foso junto a la torre (X=7416): el haz con `H3_WX=1` cayó y perdió una vida.
  - Hay diablillos azules, ogros, Red Arremer y plataformas móviles. La armadura se pierde en 29077 en todas las ramas; desde ahí cualquier golpe es mortal y el haz lo poda.
  - En el piso Y=1135 la escalera siguiente está a la izquierda (X≈6768) y el haz por `maxY` se estancó; Go-Explore con `H3_RANK=y` la encontró.
  - La primera búsqueda 33270→34470 dejó una cabeza condenada (ver §8), así que el tramo se repitió hasta 35670.
- Jefe: el demonio rojo de la sala superior cae hacia 35070 (+3000, `H3_WS=1`), con 1:14 en el reloj. Aparece «TAKE A KEY FOR COMING IN!» y la llave queda a la izquierda.
  - `keyleft` lleva a Arthur hasta X=7213 (35499) y recoge la llave. La armadura vuelve en 35610, se abre la puerta («BONUS 15000») y la transición 4→5 llega sola en **35680**, sin más entradas que esperas.
  - La fase 6 se dibuja hacia 36022 (vida extra 4→5 por puntuación) y el reloj corre desde 36030 (2:59). `goalFrame` 36091 = transición + 411, como en la fase 4.
- Gate (`out/h3/phase5/gate.log`): `H3_PHASE_PREFIX=PASS`, replay `MATCH` de las dos cintas, `H3_VIDEO_CHECK=PASS` en 36091 (RGBA `6957684a55f6922ec762d55f30b01bee56530190dfd579156904a788a27f45b5`), ffprobe h264 256×224 7832 frames (131,33 s) y `H3_PHASE5_ACCEPTANCE=PASS`. `fase5.mp4` ocupa 10.711.553 bytes. Las métricas registran:
  - `ramVerified=true` y un único evento `phase` (4→5 en 35680);
  - la armadura, perdida en 29077 y recuperada en 35610;
  - la vida extra (4→5) en 36022, sin muertes.
- La secuencia se repitió entera desde la semilla con el código final. Las 12 cintas intermedias dan el mismo SHA de cinta, y la cinta final (archivo `8eb95700…`) y `fase5.mp4` salieron idénticos byte a byte. El gate volvió a dar PASS. Solo cambiaron los metadatos de dos intermedias:
  - `search-p4-29977.json` gana `goalFrame`/`signal`/`ramSha`, porque la original es anterior a ese cambio;
  - `tape-s2-s1-29076-best.json` recupera `h3.from` = semilla. Un `explore` de diagnóstico lanzado desde ella misma la había sobrescrito con las mismas entradas.
- Copias de los intermedios regenerados en `out/h3/phase5/steps/`, con `SHA256SUMS`. El log también contiene lo que no contribuye a la cinta: los comandos de diagnóstico (exports cortos e `inspect`) y las búsquedas descartadas (haz por X desde 28260 que cae al foso, haz por Y estancado, `explore` sin `H3_RANK` y la cabeza condenada de 34470).
- El frame 28260 de `fase5.mp4` coincide en métricas RAM con el último de `fase4.mp4`.

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
- `h3_finalize_phase.mjs` escribe `tape-faseN-completa-<goalFrame>.json` y `verify_h3_phase.sh` renombra a `faseN.{mp4,json}` solo después de superar el gate; los scripts históricos de fase 3 mantienen sus interfaces.

- Los resultados nuevos (cintas, hashes, vídeos) se registran en §10, y su estado de tarea en el plan del bot. Los handoffs futuros deben remitir a este README en lugar de copiar instrucciones.
- Si cambia una interfaz o una variable, actualizar §3–§4 y el comentario de cabecera del script en el mismo commit.
- No subir `roms/`, `out/`, `cfg/`, `gng-ghidra/`, cintas, capturas ni vídeos. No modificar motor, AOT, runtime ni bundles.
