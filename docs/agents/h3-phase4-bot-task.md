# H3 fase 4 — bot, cinta y vídeo

**Estado:** pendiente. Referencia operativa única: [docs/go-explore/README.md](../go-explore/README.md). Este encargo solo fija el objetivo, el punto de partida y la entrega; los comandos, las variables y los límites se consultan allí.

## Objetivo

Trabajar en `/Users/matias/gng-ghidra`. Continuar desde el final de la fase 3 hasta completar la fase visible 4, es decir, hasta la transición RAM `0x72: 3→4`. Seguir jugando hasta que se vea el inicio jugable de la fase 5. Entregar una cinta de solo entradas, el MP4 y el JSON de métricas.

Al empezar, pedir el uso restante (5 h y semanal) si no se han dado ambos números, y esperar la respuesta. Estimar el coste en las dos unidades. No iniciar V2–V4.

## Punto de partida

| Dato | Valor |
| --- | --- |
| Cinta | `out/h3/explore/tape-fase3-completa-22380.json` |
| SHA-256 de la cinta | `9feecfa49b269ad0a0c6cb2e2b96b0e684d1ae7c1f76efef33c3ca96a552b1ed` |
| `goalFrame` | 22380 |
| RAM | `00f267b13bfbb90b500cb493c25005dbeb81bba964ac6a2f5f3f1a682fcc59b5` |
| Estado | `phase=3`, `cp=0`, X=3632, Y=591, scroll=3584, 4 vidas, armadura puesta (`0xAC=0`) |
| Bundle | g6 certificado; no aceptar una degradación |

Hacer primero el preflight de README §5. El replay de la cinta tiene que dar `MATCH`.

## Cómo trabajar

1. Seguir el flujo de README §5–§6. Avanzar con `h3_boss_search.mjs` partiendo de `H3_SEED` (fase RAM `3`, inicio 22380). Usar segmentos de 120 frames en tramos abiertos y de 60 o menos junto a peligros. Encadenar los resultados con `H3_SEED` y usar `h3_boss_maneuver.mjs` para llaves, esperas y cierres. Diagnosticar con `h3_boss_inspect.mjs` y `h3_boss_trace.mjs`, filtrando su salida.
2. Respetar los límites de README §8:
   - Sin contador de jefe validado para esta fase. Si se usa `H3_WB` o `H3_BOSS_LIFE`, validar antes la dirección con RAM y sprites en al menos dos ramas, y registrar esa evidencia.
   - La geometría cambia de una fase a otra: no trasladar `XCAP`, límites ni X de fases anteriores.
   - Matar al jefe no cierra la fase. El cierre es la transición RAM, y puede exigir esperar una llave y recogerla.
3. `h3_finalize_phase3.mjs` y `verify_h3_phase3.sh` están fijados a la fase 3. Generalizarlos con la cinta inicial, la fase de origen y el frame de corte como parámetros, o añadir equivalentes para la fase N. Las interfaces y el resultado de los scripts de la fase 3 no deben cambiar. Añadir tests mínimos y actualizar README §2–§4.
4. Registrar cada comando que contribuya a la cinta final, en orden y con sus salidas en `out/`. La fase 2 se quedó sin poder reproducirse por no hacerlo.

## Entrega y aceptación

- Nombres según README §11:
  - cinta `out/h3/explore/tape-fase4-completa-<goalFrame>.json`;
  - vídeo y métricas `out/h3/video/fase4.{mp4,json}`, renombrados cuando el gate dé `PASS`.
- La cinta:
  - es de solo entradas y no usa `H3_POKE`;
  - conserva exactamente el prefijo hasta el frame 22380;
  - tiene `h3.goalFrame`, `h3.signal`, `h3.ramSha`, `h3.transitionFrom=3`, `h3.transitionFrame`, `minLives` y `firstFatal`;
  - deja los controles P1 liberados.
- Verificación:
  - replay desde reset con `MATCH`;
  - `h3_video.mjs check` en el `goalFrame` con `PASS`;
  - `export <cinta> <goalFrame> 22380`, de modo que el vídeo comparta el frame 22380 con `fase3.mp4`;
  - ffprobe: H.264, 256×224 y frames = `goalFrame − 22380 + 1`;
  - métricas con `ramVerified=true` y exactamente un evento `phase` 3→4;
  - gate de aceptación `PASS`.
- Muertes, vidas y armadura se registran como ocurrieron, sin ocultarlas.
- Añadir la fila de la fase 4 y su secuencia de comandos a README §10, y marcar la tarea en el [plan del bot](../plan-bot-control-jugabilidad-2026-11-01.md). No copiar instrucciones en otros documentos.

## Restricciones

- No modificar el motor congelado, el AOT, el runtime, los bundles, la ROM ni la RAM.
- `H3_POKE` está prohibido. Los snapshots de laboratorio solo se usan entre ramas.
- No subir `roms/`, `out/`, `cfg/`, `gng-ghidra/`, cintas, capturas ni vídeos.
- MAME y el navegador (Playwright), si hicieran falta, corren sin ventana y sin tomar el foco.
- Se puede hacer commit y push directo a `main` de scripts, tests y documentación seguros.
- Informar del progreso con barra de progreso y casillas de tareas. Al cerrar, dar la ruta, el tamaño, la duración, los frames y la transición del vídeo, más los hashes.
