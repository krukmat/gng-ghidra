# Tarea preparada — explorador con búsqueda (V3.B3 G2.1)

Estado: preparada el 27/10/2026. No iniciada.

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
