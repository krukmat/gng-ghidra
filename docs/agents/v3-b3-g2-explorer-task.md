# Explorador con búsqueda (V3.B3 G2.1)

Estado: E0 GO; E1 PARTIAL (posición y vidas validadas, fase provisional); E2 GO hasta
`x=1606`, siguiente iteración STOP por estancamiento; E3 no necesario para
esta cinta; E4 GO hasta el frame 2730. Checkpoint 27/10/2026.

## Checkpoint ejecutado (g4, 27/10/2026)

| Bloque | Resultado y evidencia |
| --- | --- |
| **E0 GO** | `src/v3_b3_lab_board.mjs` instrumenta **en memoria** el runtime congelado solo si coincide con el SHA-256 del manifiesto. Guarda/restaura registros y máscaras CPU, RAM y máscaras, paleta, DMA, scroll, banco, IRQ/SYNC, latches, sonido, ciclo y contadores. `scripts/v3_b3_lab_snapshot_check.mjs`: `arthurControls`, 2200 frames, cortes 311/640/1200/1974; todos los hashes de record coinciden con g4 sin cortes y tras restaurar. Test ROM-free con cuatro cortes. Ningún bundle modificado. |
| **E1 PARTIAL** | Posición absoluta de Arthur: palabra big-endian `0x00A0–0x00A1`; vidas: byte `0x0060`. En `botA`, `world_x=138`/scroll=10 (frame 1600) y `world_x=204`/scroll=76 (frame 2000): ambos dan x=128 en pantalla y coinciden con sprites DMA. Las vidas bajan 3→2 entre 2200–2600 y 2→1 entre 3800–4200, con muerte/respawn visibles. `0x0052=1` durante estas cintas, pero **no está validado como fase**: no hubo transición de nivel. El buscador solo puntúa posición y vidas. |
| **E2 GO / frontera STOP** | `scripts/v3_b3_explore.mjs` hace búsqueda por ramas desde snapshots y emite únicamente transiciones P1 en formato B3. Máximo de `botA` vivo: `x=500`. La mejor cinta privada `out/v3/b3/explorer/explorer-g4-2730-1606.json` llega a `x=1606` con 3 vidas, frente al agua y un enemigo rojo al final del tramo visto. Variantes de 90 y 30 frames (derecha, disparo, salto temprano/tardío, arriba, izquierda) no superaron `x=1606` hasta el horizonte 6000. Siguiente puntuación debe incluir supervivencia/enemigo y acción contextual cerca del agua; no declarar fase 1 completa. |
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
