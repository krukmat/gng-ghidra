# Bot estándar de control de jugabilidad — tareas

**Fecha:** 2026-11-01 · **Estado:** E0 en main (`e7b2f2b`); V1 implementada y verificada en el árbol de trabajo; segunda fase completada con vídeo y métricas (2026-11-02); siguiente: V2.

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
  - `node scripts/h3_video.mjs check <cinta.json> [frame=320]` compara los píxeles RGBA de un frame real con los módulos empaquetados de la app.
  - `node scripts/h3_video.mjs export <cinta.json> [frame-final] [frame-inicial]` genera MP4 H.264 y JSON con métricas por frame, eventos fechados y resumen. Excluye del avance los patrones de RAM del arranque; verifica la huella RAM final si la cinta la contiene. Un frame inicial permite exportar solo un tramo de la cinta.
  - `node scripts/h3_finish_phase.mjs out/h3/explore/tape-s2-s1-5528-best.json` continúa la cinta del bot tras derrotar al cíclope: prueba movimientos acotados, encuentra la llave y guarda una cinta de solo entradas. No usa pokes ni altera el motor.
  - Conversión verificada con la cinta `tape-live-input-tape-session-1-2724.json` (`gate=PASS`): paridad RGBA en frame 1801; MP4 de 2724 frames a 256×224; pérdida de vida en frame 2173; huella RAM coincidente. Esta cinta no completa una fase.
  - Cierre verificado con `tape-s2-phase-5950.json`: `h3_explore.mjs replay` da `MATCH`, transición de fase 0→1 en frame 5890 y huella RAM final coincidente. MP4 de 5950 frames (99,77 s) y JSON de 5950 filas en `out/h3/video/`; el JSON registra el evento de fase en frame 5890.
  - [x] Clip adicional hasta el avance actual de la fase siguiente: `search-p1-11007.json`, frames 5950–11007, 5058 frames (84,81 s) y métricas en `out/h3/video/`. El primer frame coincide con el último del vídeo anterior; el bot llega a X=5449 con 3 vidas. La fase sigue en 1; el objeto con 10 de vida observado en `0xe76` corresponde a un ogro del hotel, por lo que no acredita el estado de los guardianes finales. Este clip no acredita completar la siguiente fase. La cinta de búsqueda no incluye una huella RAM de referencia; la verificación cubre el prefijo de entradas, la continuidad y el archivo MP4.
  - [x] Continuación solicitada: segunda fase completada (RAM `phase` 1→2 en frame 16566), incluidos hotel, canales, los dos guardianes y llave. Cinta `out/h3/explore/tape-fase2-completa-16980.json`, solo entradas y sin pokes; conserva el prefijo de `tape-s2-phase-5950.json`. `h3_explore.mjs replay` da `MATCH` desde reset en g6, sin frame fatal ni pérdidas de vidas: empieza con 3 y termina con 4. En frame 16980 ya muestra la fase 3, X=80, Y=574 y armadura recuperada. Huella RAM final `825a13d0af28a906b43942f46d2f8088d225691fa4466b658b7983f7fbffa004`.
    - `out/h3/video/fase2.mp4` y `fase2.json`: frames 5950–16980, 11031 frames, 184,97 s, H.264 a 256×224. Primer frame idéntico al último de `fase1.json`; el JSON fecha la transición en frame 16566 y verifica la huella RAM final (`ramVerified: true`). Paridad RGBA con la app: `PASS` en frame 16980.
    - La búsqueda admite `H3_BOSS_LIFE=0xc66,0xcf6` para evaluar la vida conjunta de los dos guardianes, con `H3_WB` como peso. El contador predeterminado `0xe76` sirve para el primer jefe y puede corresponder a otro enemigo en fases posteriores.
  - [x] Clip del hotel: `search-p1-14161-826fb4d7-11007-14161.mp4` y su JSON en `out/h3/video/`; 3155 frames, 52,90 s, 256×224. Métricas: X=5449→5767, mínimo 3 vidas, fase 1 durante todo el tramo. Primer frame compartido con el final del clip anterior; aún no acredita terminar la fase.
  - [ ] Continuación fase 3: programar el bot desde la cinta verificada del frame 16980 hasta la transición RAM 2→3; entregar vídeo completo, métricas y entrada visible en la fase 4. Instrucciones y estado inicial en [el handoff](agents/h3-phase3-bot-video-handoff.md).
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
