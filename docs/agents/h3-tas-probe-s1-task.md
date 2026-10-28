# H3-S1 — Sonda TAS: explorador Go-Explore en la fase 1 desde reset

**Estado:** S0 hecho; S1 **GO** (28/10/2026): arena del cíclope en el frame 5348 desde reset, sin pokes, 3 vidas; replay independiente MATCH (cinta `f5cbb0c7…`, RAM `8ad5a998…`). Métricas en el [plan](../plan-contenido-h3-h4-2026-10-27.md). Siguiente: S2.
Pertenece al [plan de contenido](../plan-contenido-h3-h4-2026-10-27.md) y
sustituye, como fuente de cintas, a la grabación del operador (paso 3). Viene
después de [H3-F2](h3-phase2-first-hit-task.md). No reanuda el bot visual de `bot/`.

## Por qué

La búsqueda en haz ([h3_boss_search.mjs](../../scripts/h3_boss_search.mjs)) no
podía certificar ni avanzar por cinco motivos:

- Arranca con un poke de fase y checkpoint.
- Premia la X, de modo que el lanzamiento de un impacto fatal (X=5464) contaba
  como avance.
- Ensanchar el haz de 8 a 96 no cambió el alcance: el haz se amontona en la misma X.
- Usa macros fijas de 23/60 frames, sin timing fino.
- No tiene ninguna señal de jefe: en la arena del cíclope se mantuvo del frame
  3700 al 9000 sin victoria.

Certificar no exige un humano. Basta una cinta desde reset, con solo entradas,
que MAME reproduzca igual. [v3_b3_oracle.mjs](../../scripts/v3_b3_oracle.mjs) ya
compara AOT y MAME con cualquier cinta de laboratorio. La sonda es un TAS: se
genera con ayuda (lectura de RAM, save/restore) y se valida al reproducirla.

## S0 — Decisión del operador (28/10/2026): actualizar el plan

Editar [plan-contenido-h3-h4-2026-10-27.md](../plan-contenido-h3-h4-2026-10-27.md):

- **§1 (nueva fila):** una sonda TAS certifica igual que una cinta humana. Requisitos:
  - cinta generada offline desde reset;
  - solo entradas de puerto, sin pokes ni escrituras de estado;
  - doble replay idéntico;
  - paridad MAME en la entrada de fase, el jefe y la transición.

  La cinta humana pasa a opcional.
- **§2, F-N.1 (§4) y §7:** donde dice «cinta humana», poner «sonda TAS o cinta
  humana».
- **Estado y «Siguiente acción»:** la siguiente acción pasa a ser esta tarea.
  La corrección de la poda de `h3_boss_search.mjs` va a §8: la sustituye el
  corte en el impacto del explorador.
- **§5:** el bot visual de `bot/` sigue aparcado. Su objetivo es otro (jugar en
  vivo solo con píxeles).

## S1 — Objetivo

Crear un explorador tipo Go-Explore que produzca, desde reset y sin pokes, una
cinta de entradas que llegue a la arena del cíclope de la fase 1. Archivos nuevos:
`scripts/h3_explore.mjs`, `src/h3_explore.mjs` y un test mínimo,
`tests/test_h3_explore.mjs`.

## Datos de partida (medidos en g6, un núcleo, 28/10/2026)

- **Velocidad:** 6.400 fps en lineal desde reset y 20.000 fps en ramas
  (restore más 60 frames, unos 3 ms).
- **Snapshots:** `lab.save()` tarda 0,018 ms y ocupa ~26,6 KB serializado.
  `restore` es determinista: dos repeticiones dan el mismo hash de RAM.
- **Patrón de arranque:** el de `h3_boss_search.mjs`.
  - `selectB3Bundle` (g6) y `loadFrozen`.
  - `labCreateBoard` con `portRead`/`readScheduledPort`.
  - Anular `records` en `onFrame` para limitar la memoria.
  - Prefijo `b3Tape('titleCoinStart')`.
  - Sin `H3_POKE`.
- **Etiquetas RAM** (solo lectura):

  | Dato | Dirección |
  |---|---|
  | Fase | `0x72` |
  | Checkpoint | `0x81` (se pone a 1 cuando X > 1792 en la fase 1) |
  | Vuelta | `0x71` |
  | Vidas | `0x60` |
  | X | `0xA0:A1` |
  | Y | `0xA2:A3` |
  | Scroll | `0x58:59` |
  | Armadura | `0xAC` (1 = sin armadura) |
  | Puntuación BCD | `0x68–0x6B` |
  | Modo | `0x0503` |
  | Handler | `0x0510:11` |

- **Impacto:** modo 3 en `0x0503`, puesto por la rutina 0xF586. Sin armadura
  lleva a la muerte (`0x9c64` llega 52–58 frames después). El predicado `fatal`
  vive en [h3_lab_maneuver.mjs](../../src/h3_lab_maneuver.mjs); se puede exportar.
- **Controles:**
  - `p1.button1` = disparo; `p1.button2` = salto. Hay que pulsar y soltar.
  - Derecha y salto a la vez desde parado da un salto vertical. Con unos 4
    frames de carrera previos, el salto es horizontal.
- **Fase 1:**
  - Agua en x≈1666–1959; la plataforma móvil oscila entre 1666 y 1782 y la
    orilla derecha empieza hacia 1784.
  - Arena del cíclope: scroll ≈3072–3073.
  - Cinta legítima de referencia: `out/v3/b3/explorer/explorer-g4-2730-1606.json`
    (sin poke, llega a X=1606).

## Diseño mínimo

- **Celda:** fase, checkpoint, X>>4, Y>>3 y armadura. Cada celda guarda el
  snapshot y los eventos de su mejor trayectoria. Gana la que conserva la
  armadura y, a igualdad, la de menos frames (hay temporizador).
- **Selección:** se favorecen las celdas poco elegidas, por ejemplo con peso
  1/sqrt(1+elegida), con un bonus leve por scroll.
- **Exploración:** ~120 frames de acciones «pegajosas» generadas con un PRNG de
  semilla fija.
  - La dirección se mantiene varios frames.
  - Disparo y salto son pulsaciones que se sueltan.
  - La celda se evalúa cada 4 frames.
- **Corte inmediato:**
  - un impacto sin armadura;
  - un handler de muerte;
  - una vida perdida.

  Un impacto con armadura no se corta: genera otra celda.
- **Fuera de S1:** la novedad por bloques de código (como un fuzzer) y la vida
  del jefe. Se añaden en S2 si hacen falta.

## Ejecución y límites

Un agente, secuencial (plan §6: sin subagentes ni workflows). Al empezar, pedir
la cuota 5h/7d y esperar.

**Prohibido:**
- Usar MAME o crear g7.
- Modificar engine, AOT, runtime, renderer o bundles (están congelados).
- Escribir RAM o estado, o usar pokes.
- Añadir `cfg/` o `gng-ghidra/`.
- Hacer commit de `program.mjs` o de cualquier archivo derivado de la ROM.
- Tocar los cambios de audio sin commit.

**Salidas:** privadas, en `out/h3/explore/`.

**Pasos:**
1. Validación barata:
   - comprobar las etiquetas RAM sobre la cinta de referencia;
   - comprobar que dos exploraciones con la misma semilla dan el mismo archivo
     de celdas y la misma cinta.
2. Ejecutar la exploración, con un máximo de 30 minutos de reloj.
3. Guardar la mejor cinta, solo con entradas (`schema`, `events`, `sha256`, más
   la semilla y los parámetros).
4. Replay independiente desde reset, en un tablero nuevo y sin restore.

## GO / STOP

- **GO:** la cinta llega a la arena (fase 0, scroll ≥3072) desde reset, sin
  pokes y sin perder vidas. El replay independiente reproduce el mismo hash y
  la misma señal.
- **STOP:** se da cualquiera de estos casos.
  - No se supera x≈1905 en 30 minutos de reloj.
  - Aparece no determinismo.
  - Aparece HALT o `UNCOMPILED`: se registra como asunto del motor y no se corrige.

**Presupuesto:** ~15–20 % de la ventana de 5h y ~3 % del semanal. Avisar antes
de superarlo.

## Siguientes pasos (fuera de esta tarea)

- **S2:** localizar la vida del cíclope comparando la RAM antes y después de
  cada golpe. GO: `0x72` pasa de 0 a 1.
- **S3:** certificar F-1 con doble replay y el oráculo MAME, más ramas de
  muerte con respawn y de game over con continue.
- **Fase 2:** si el explorador se atasca en la columna X≈5450, diagnóstico
  H3-F3 de la colisión con el fondo.

## Entrega

- Plan actualizado (S0 y resultado de S1, GO o STOP) con métricas: celdas,
  ramas, frames, tiempo de reloj, X máxima y scroll máximo.
- Hashes de las cintas. Las cintas quedan privadas.
- Tests, commit y push directo a main. Los commits terminan con
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Informe breve en castellano, con barras de progreso.

## Prompt para retomar

```text
Ejecuta docs/agents/h3-tas-probe-s1-task.md (S0 y luego S1) en /Users/matias/gng-ghidra.
Lee primero esa tarea. Pide la cuota 5h/7d y espera.
Un agente, secuencial; sin MAME ni g7; respeta los límites de la tarea.
Actualiza el plan, verifica, haz commit y push. Reporta breve.
```
