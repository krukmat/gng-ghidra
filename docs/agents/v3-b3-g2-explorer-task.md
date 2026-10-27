# Explorador con búsqueda (V3.B3 G2.1)

Estado actual: **bot STOP por falta de avance sostenido**. E1 PARTIAL
(posición y vidas validadas, fase provisional); E2: pico diagnóstico `x=1700`
seguido de muerte, ninguna fase completa. E3: 24 ramas con `UNCOMPILED`,
bloqueo externo al bot; motor congelado. E0 y E4 conservan únicamente sus
gates históricos. Checkpoint 27/10/2026.

**Dirección actual:** el objetivo es terminar el juego completo, incluidos los
recorridos y niveles posteriores ([plan general](../plan-100pct-jugable-2026-10-26.md)).
El operador indicó detener el bot si ya no progresa. La búsqueda está detenida
en este STOP; no se ha superado el encuentro ni completado la primera fase.
Siguiente tarea: [investigar estrategias contra el estancamiento](gng-bot-antistuck-task.md).

### Reanudación anterior a 2400: STOP (27/10/2026)

**Decisión vigente:** aplicar el [límite estricto del bot](gng-bot-gameplay-plan-2026-10-27.md).
Los nuevos componentes están en `bot/` y `tests/bot/`; ejecutan el `createBoard`
original de g4 desde reset para cada candidato. No utilizan snapshots,
clonación, compilación, escrituras de memoria ni modificaciones del motor.
Los snapshots del apartado histórico no son el método de este bloque.

- Referencia `explorer-g4-2730-1606.json`, prolongada hasta 3600: primera
  pérdida observable de vida en **2839**, reaparición entre 3100 y 3200,
  `x=40` al terminar. No hay cambio de fase demostrado.
- **253 candidatos** con cortes 1920/2100/2190/2280/2340: 13 del primer
  barrido, 72 del segundo, 72 de espera/retirada/agacharse/disparo y 96 de
  cadencias de salto/disparo con distintos desfases. Cada uno parte de reset;
  no se añaden monedas ni Start al prefijo original.
- **229 ejecuciones completas y 24 censuradas por HALT**. Diecinueve
  `UNCOMPILED` en `0xE79E` y cinco en `0xC3A3`; veinte antes del primer
  decremento observable de vidas y cuatro después. Eso no acredita que las
  veinte estuvieran a salvo. Cada rama se detuvo y conservó su cinta; no se
  amplió AOT ni se cambió de bundle.
- Mejor pico de la primera vida: **1700**, `late-sweep/trial-6.json`, corte
  2100, derecha+disparo+salto cada 44 frames. Pierde una vida en **2881**,
  reaparece y acaba en `x=451`/2 vidas en 3600. Son +94 de pico y +42 frames
  hasta el decremento frente a la referencia, **no avance sostenido ni GO**.
- Solo dos candidatos completos conservan todas las vidas: se quedan en
  `x=1039` y `x=1279`. El segundo (`late-sweep/trial-67.json`, retirada con
  disparo desde 2340) conserva 3 vidas hasta **5000**, sin moverse desde
  aproximadamente 2400. Sus imágenes del motor fueron inspeccionadas.
  Sobrevivir inmóvil no cuenta como progreso.
- Ninguno registra cambios de `0x0052`; esa dirección sigue sin validarse
  como fase. **Cero transiciones reales y cero vueltas completadas**.

`bot/evaluation.mjs` acumula pérdidas aunque después se recuperen vidas,
congela el máximo de la primera vida y mantiene por separado la posición
final y los cambios candidatos de fase. `survivalFrames` mide hasta el
**decremento observable** de vidas, no hasta la colisión mortal. El ranking
no certifica progreso: incluso superar a la referencia puede significar
quedarse inmóvil. Las señales actuales solo están calibradas para estos
prefijos con 3 vidas y candidato de fase 1; no acreditan pantallas de demo.

**Artefactos privados:** `out/bot/{early-sweep,late-sweep,early-tactics,jump-cadence}/`
(informes y cintas) y `out/bot/safe-retreat/` (replay e imágenes). No se han
certificado estas cintas nuevas contra MAME ni en vivo; el E4 histórico no
se extiende a ellas. MAME no se ha usado para jugar ni para buscar acciones.

Verificación: Node 22.23.0, Python 3.15.0; fixtures sintéticos y suite
ROM-free: **458 PASS, 0 FAIL, 1 SKIP**, incluidos 11 tests nuevos del bot.
No queda una búsqueda ni un bot de este bloque en ejecución.

```bash
node --test tests/test_*.mjs tests/bot/*.test.mjs
# Solo reproducción de evidencia privada, no reanuda la búsqueda:
node bot/replay.mjs out/bot/late-sweep/trial-67.json 5000 2340,2800,3600,5000 verify-retreat
```

### Revisión del atasco (27/10/2026)

- Si se deja la mejor cinta sin más controles después del frame 2730,
  `world_x=1606` queda fijo, las vidas bajan de 3 a 2 antes del 2900 y Arthur
  reaparece al inicio hacia el 3200; `0x0052` sigue en 1. Por tanto,
  `x=1606` es un máximo alcanzado, no una posición segura ni una victoria.
- Desde el frame 2600, diez acciones sostenidas hasta el 3100 (quieto,
  derecha, izquierda, disparo, salto y combinaciones) dieron la misma traza
  de posición y vidas. Cambiar los controles tan tarde no resuelve la caída.
- Desde el frame 2400, las mismas familias de acciones alteran la posición,
  pero todas pierden una vida antes del 3100, sin transición de fase.
  Los intentos terminaron; la próxima búsqueda deberá empezar antes del 2400
  y exigir supervivencia posterior, además de avance, para aceptar una rama.

## Checkpoint previo: explorador con snapshots (g4, 27/10/2026)

| Bloque | Resultado y evidencia |
| --- | --- |
| **E0 GO** | `src/v3_b3_lab_board.mjs` instrumenta **en memoria** el runtime congelado solo si coincide con el SHA-256 del manifiesto. Guarda/restaura registros y máscaras CPU, RAM y máscaras, paleta, DMA, scroll, banco, IRQ/SYNC, latches, sonido, ciclo y contadores. `scripts/v3_b3_lab_snapshot_check.mjs`: `arthurControls`, 2200 frames, cortes 311/640/1200/1974; todos los hashes de record coinciden con g4 sin cortes y tras restaurar. Test ROM-free con cuatro cortes. Ningún bundle modificado. |
| **E1 PARTIAL** | Posición absoluta de Arthur: palabra big-endian `0x00A0–0x00A1`; vidas: byte `0x0060`. En `botA`, `world_x=138`/scroll=10 (frame 1600) y `world_x=204`/scroll=76 (frame 2000): ambos dan x=128 en pantalla y coinciden con sprites DMA. Las vidas bajan 3→2 entre 2200–2600 y 2→1 entre 3800–4200, con muerte/respawn visibles. `0x0052=1` durante estas cintas, pero **no está validado como fase**: no hubo transición de nivel. El buscador solo puntúa posición y vidas. |
| **E2 GO / frontera STOP** | `scripts/v3_b3_explore.mjs` hace búsqueda por ramas desde snapshots y emite únicamente transiciones P1 en formato B3. Máximo de `botA` vivo: `x=500`. La mejor cinta privada `out/v3/b3/explorer/explorer-g4-2730-1606.json` llega a `x=1606` con 3 vidas, frente al agua y el demonio rojo, identificado por el operador como jefe de la fase 1. Variantes de 90 y 30 frames (derecha, disparo, salto temprano/tardío, arriba, izquierda) no superaron `x=1606` hasta el horizonte 6000. El siguiente experimento debe estudiar y superar el encuentro con el jefe; no declarar fase 1 completa. |
| **E3 no activado** | Ninguna rama elegida llegó a `UNCOMPILED`/`BLOCK_ENTRY` hasta 2730. g4 sigue seleccionado; no hay g5 ni modificación de paquete certificado. |
| **E4 GO para esta cinta** | Imagen de los frames 1920/2200/2400/2600/2730 inspeccionada en privado. `v3_b3_oracle.mjs`: frames 1200, 1740, 1920, 2200, 2400, 2600, 2730 idénticos a MAME 0.288, 0 bytes desconocidos. `v3_b3_live_bot.mjs`: 2730 frames, 142/142 eventos, retraso máximo 0, sin HALT; `v3_b3_live_replay.mjs`: hash final idéntico. |

Comandos de reproducción local:

```bash
node scripts/v3_b3_lab_snapshot_check.mjs
node scripts/v3_b3_explore.mjs out/v3/b3/explorer/explorer-g4-1920-846.json 2000
node scripts/v3_b3_oracle.mjs out/v3/b3/explorer/explorer-g4-2730-1606.json 1200,1740,1920,2200,2400,2600,2730
node scripts/v3_b3_live_bot.mjs out/v3/b3/explorer/explorer-g4-2730-1606.json 2730
node scripts/v3_b3_live_replay.mjs out/v3/b3/live-tapes/bot-explorer-g4-2730.json
python3 tests/generate_synthetic.py && python3 tests/generate_function_fixtures.py
node --test tests/test_*.mjs
```

Node 22.23.0 no acepta `node --test tests/` como directorio (intenta cargarlo
como módulo). La invocación explícita anterior dio 447 PASS, 0 FAIL, 1 SKIP.
Los archivos de `out/` son privados e ignorados por Git; no se publican.

## Contexto

- **g4** (`out/v3/b3/g4`, privado) completa 24.000 frames en vivo sin HALT con
  `sustainA`/`sustainB`, y 18.000 con `botA`. Ver
  [informe §9](../v3-b3-playable-2026-10-26.md).
- Los bots actuales (`scripts/v3_b3_live_bot.mjs`) usan secuencias fijas. Al
  reproducir sus cintas y mirar los frames, **ninguno pasa del inicio de la
  fase 1 (cementerio)**:
  - `botA` llega a 3.800 puntos y a game over antes del frame 9.000; después
    pasa a la tabla de récords y a la demo.
  - `sustainA` vuelve una y otra vez a la salida del cementerio.
- Por eso el final de la fase 1, el jefe y las fases 2–6 no tienen ninguna
  prueba en vivo. Las 241 tablas de salto estáticas los siembran en la
  compilación, pero nunca se han ejecutado.

## Objetivo

Obtener cintas de entradas que lleven a Arthur cada vez más lejos: final de
la fase 1, jefe, fase 2… Cada cinta tiene que ser idéntica a MAME y jugable
en vivo sin HALT.

## Bloques

| Bloque | Trabajo | GO | STOP |
| --- | --- | --- | --- |
| **E0 Snapshot** | Guardar y restaurar el estado completo de la placa (CPU, RAM, vídeo, ciclo, IRQ pendiente, latches, scroll) sobre `createBoard` de `<bundle>/gngb_runtime.mjs`. Solo tooling de laboratorio en `src/` o `scripts/`. | Al restaurar en el frame N y seguir con la misma entrada, el hash del record es igual frame a frame a una ejecución sin cortes (test con varios N). | Algún hash diverge y no se encuentra la causa. Reportar qué estado falta. |
| **E1 Señales de avance** | Localizar en RAM la posición absoluta de Arthur o del nivel, las vidas y la fase. Documentar las direcciones y cómo se validaron (correlación con la imagen y con eventos conocidos). | Las señales cambian como se espera en las cintas existentes (muerte → vidas −1, avance → posición +). | — |
| **E2 Búsqueda** | Cada K frames, probar ramas de entrada (derecha, salto, disparo, combinaciones y duraciones) desde un snapshot. Puntuar con E1, penalizar perder vida y conservar la mejor rama. Salida: cinta en el formato B3 existente. | La cinta pasa claramente del punto alcanzado por `botA`. | La búsqueda no progresa: replantear las ramas o la puntuación y registrarlo. |
| **E3 Cobertura** | Si aparece `UNCOMPILED` o `BLOCK_ENTRY`: pasar la cinta por `scripts/v3_b3_discover.mjs` y generar g5… con todos sus gates. Si el destino es un despacho indirecto que `src/v3_b3_jump_tables.mjs` no cubre (`LDX B,U; JMP ,X`, vectores en RAM), ampliar el escáner con tests. | La nueva generación certifica y la cinta corre sin halt. | — |
| **E4 Certificación** | Reproducir la cinta en MAME (oráculo externo) con el flujo de cintas B3, y en vivo con el bot. | Mismos hashes que MAME y en vivo sin HALT. Un HALT en vivo se reproduce con `scripts/v3_b3_live_replay.mjs`. | Divergencia con MAME: es un bug de AOT o del runtime; investigarlo, nunca reinterpretarlo. |

Iterar E2–E4 fase por fase. Esto alimenta G3/P4: una partida completa.

## Restricciones

- ROM, gráficos, `out/`, volcados de RAM/VRAM y capturas son privados. Nada
  de eso va a GitHub.
- MAME solo como oráculo de laboratorio.
- El snapshot y la búsqueda nunca entran en el producto ni en el servidor en
  vivo. Nada de intérprete de opcodes, inyección de estado ni frames
  pregrabados.
- No se modifican bundles certificados: cada generación nueva va en un
  paquete nuevo.
- No reinterpretar la evidencia para llegar a un PASS.
- Commits verificables con tests (`node --test tests/`). Sin push sin
  autorización.
- Registrar avances y bloqueos en este documento y en el informe V3.B3.
- Medir lo lejos que llega Arthur, no la cantidad de bloques.
