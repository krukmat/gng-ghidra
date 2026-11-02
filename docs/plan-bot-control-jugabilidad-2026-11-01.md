# Bot estándar de control de jugabilidad — tareas

**Fecha:** 2026-11-02 · **Estado:** E0 y V1 implementadas; fases 1–4 completadas; siguiente: V2.

**Referencia operativa:** comandos, variables, flujo y resultados verificados de las herramientas H3 están en [docs/go-explore/README.md](go-explore/README.md). Este plan mantiene las tareas y su cierre.

**Objetivo del operador:** un bot estándar que juegue y produzca un video con métricas, para controlar la jugabilidad tras futuros cambios y en otros juegos. El audio no es relevante; lo que importa es la fidelidad visual. No hace falta un bot en vivo ni uno que juegue solo con píxeles.

## Hecho (E0)

- `node scripts/h3_explore.mjs import <cinta-en-vivo>` convierte una cinta de la app o del laboratorio y la reproduce en g6.
  - La verifica contra `check.record_sha256`. Una cinta sin check solo pasa con `--unverified`.
  - Marca `inputsLive`, que es false en la demo y durante un golpe mortal.
- `explore --from <cinta>` sigue jugando desde esa cinta. Con la cinta de demo o de un golpe mortal, se niega a arrancar.
- La exportación con la T de la app incluye `check:{frame, record_sha256}`, que se reconstruye a partir del checkpoint.
  - El APK de Android no está recompilado, así que el teléfono todavía exporta sin check.
- La cinta humana del 27/10 sirve hasta el frame ~3500; después corre la demo.

## Tareas

Antes de empezar cada tarea, estimar su coste en la ventana de 5 h y en el semanal.

- [x] **V1 — Cinta → MP4 + métricas.**
  - Usar `src/gngb_frame_renderer.mjs`, el mismo renderer de la app, y ffmpeg.
  - Generar un JSON con avance, vidas, fase y el frame de cada evento.
  - Validar primero lo barato: un frame renderizado debe ser igual al que dibuja la app.
  - La salida va en `out/h3/video/`, que es privado.
  - Cierre: video y métricas de una cinta del bot que complete al menos una fase; verificar el frame de transición.
  - Herramientas: `h3_video.mjs check|export` (paridad RGBA con la app; MP4 H.264 y JSON de métricas en `out/h3/video/`) y `h3_finish_phase.mjs` (continuación acotada tras el primer jefe). Uso e interfaces en [el README de Go-Explore §3](go-explore/README.md#3-interfaces).
  - Conversión verificada con la cinta `tape-live-input-tape-session-1-2724.json` (`gate=PASS`): paridad RGBA en frame 1801; MP4 de 2724 frames a 256×224; pérdida de vida en frame 2173; huella RAM coincidente. Esta cinta no completa una fase.
  - Cierre verificado con `tape-s2-phase-5950.json`: `h3_explore.mjs replay` da `MATCH`, transición de fase 0→1 en frame 5890 y huella RAM final coincidente. MP4 de 5950 frames (99,77 s) y JSON de 5950 filas en `out/h3/video/`; el JSON registra el evento de fase en frame 5890.
  - [x] Clip adicional hasta el avance actual de la fase siguiente: `search-p1-11007.json`, frames 5950–11007, 5058 frames (84,81 s) y métricas en `out/h3/video/`. El primer frame coincide con el último del vídeo anterior; el bot llega a X=5449 con 3 vidas. La fase sigue en 1; el objeto con 10 de vida observado en `0xe76` corresponde a un ogro del hotel, por lo que no acredita el estado de los guardianes finales. Este clip no acredita completar la siguiente fase. La cinta de búsqueda no incluye una huella RAM de referencia; la verificación cubre el prefijo de entradas, la continuidad y el archivo MP4.
  - [x] Continuación solicitada: segunda fase completada (RAM `phase` 1→2 en frame 16566), incluidos hotel, canales, los dos guardianes y llave. Cinta `out/h3/explore/tape-fase2-completa-16980.json`, solo entradas y sin pokes; conserva el prefijo de `tape-s2-phase-5950.json`. `h3_explore.mjs replay` da `MATCH` desde reset en g6, sin frame fatal ni pérdidas de vidas: empieza con 3 y termina con 4. En frame 16980 ya muestra la fase 3, X=80, Y=574 y armadura recuperada. Huella RAM final `825a13d0af28a906b43942f46d2f8088d225691fa4466b658b7983f7fbffa004`.
    - `out/h3/video/fase2.mp4` y `fase2.json`: frames 5950–16980, 11031 frames, 184,97 s, H.264 a 256×224. Primer frame idéntico al último de `fase1.json`; el JSON fecha la transición en frame 16566 y verifica la huella RAM final (`ramVerified: true`). Paridad RGBA con la app: `PASS` en frame 16980.
    - La búsqueda admite `H3_BOSS_LIFE=0xc66,0xcf6` como vida conjunta de los dos guardianes, ponderada con `H3_WB`; no consta su validación. El contador predeterminado `0xe76` solo está validado para el primer jefe y puede corresponder a otro enemigo en fases posteriores ([límites](go-explore/README.md#8-limitaciones-reales)).
  - [x] Clip del hotel: `search-p1-14161-826fb4d7-11007-14161.mp4` y su JSON en `out/h3/video/`; 3155 frames, 52,90 s, 256×224. Métricas: X=5449→5767, mínimo 3 vidas, fase 1 durante todo el tramo. Primer frame compartido con el final del clip anterior; aún no acredita terminar la fase.
  - [x] Continuación fase 3: cinta privada `out/h3/explore/tape-fase3-completa-22380.json`, de solo entradas y sin pokes, con prefijo y RAM del frame 16980 idénticos a la cinta de fase 2. Transición RAM `0x72:2→3` en frame **22029**; frame 22380: inicio jugable y visible de la fase 4, 4 vidas y armadura (`0xAC=0`). Replay desde reset `MATCH`, paridad RGBA `PASS`, sin muertes en el tramo. `bash scripts/verify_h3_phase3.sh out/h3/explore/tape-fase3-completa-22380.json` da `H3_PHASE3_ACCEPTANCE=PASS`.
    - Vídeo y métricas privados: `out/h3/video/tape-fase3-completa-22380-9feecfa4-16980-22380.{mp4,json}`. H.264, 256×224, 5401 frames (16980–22380), 90,56 s, `ramVerified: true`; el JSON registra exactamente un evento `2→3` en 22029. El primer frame se comparte con el final del vídeo de la fase 2.
    - Búsqueda reproducible: secuencia completa de comandos en [el README de Go-Explore §10](go-explore/README.md#10-resultados-verificados).
  - [x] **Continuación fase 4.** Transición RAM `0x72:3→4` en frame **27849**; cinta `out/h3/explore/tape-fase4-completa-28260.json` (solo entradas, sin pokes, prefijo 22380 intacto), frame 28260 con la fase 5 jugable, 4 vidas y armadura. Replay `MATCH`, RGBA `PASS`, `fase4.{mp4,json}` y `H3_PHASE4_ACCEPTANCE=PASS`; secuencia reproducida byte a byte. Evidencia en [README §10](go-explore/README.md#10-resultados-verificados). [Tarea](agents/h3-phase4-bot-task.md).
- [ ] **V2 — Suite de cintas de referencia.** Reproducirlas en cada build y reportar el frame de divergencia, con video.
- [ ] **V3 — Explorador genérico con un adaptador por juego.**
  - Separar `scripts/h3_explore.mjs` y `src/h3_explore.mjs` en un núcleo y un adaptador.
  - El adaptador define las entradas, `look`, `isFatal` y `cellKey`.
  - Mejor hacerlo cuando haya un segundo juego.
- [ ] **V4 — Correcciones humanas donde el explorador se atasca.**

## Reglas

- No tocar el motor congelado, el AOT, el runtime ni los bundles.
- No subir a git la ROM, nada de `out/`, ni `cfg/` o `gng-ghidra/`.
- Commits directos en main, solo cuando el operador los pida.
- Las pruebas de navegador usan Playwright sin ventana; MAME corre sin ventana y sin tomar el foco.
