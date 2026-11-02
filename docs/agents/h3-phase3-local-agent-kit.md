# H3 fase 3 — handoff para agente local

> **Histórico (2026-11-02).** Instrucciones vigentes, herramientas y resultados de las fases 1–3: [docs/go-explore/README.md](../go-explore/README.md). Este documento conserva la evidencia de su etapa.

## Objetivo

Trabajar en /Users/matias/gng-ghidra. Continuar desde out/h3/explore/tape-fase2-completa-16980.json, frame 16980, phase=2, 4 vidas y armadura puesta (0xAC=0). Preservar el prefijo completo y generar una cinta de solo entradas verificable desde reset. Detectar el frame exacto de RAM 0x72: 2 -> 3 y continuar hasta mostrar la fase 4. Exportar el MP4 completo desde 16980 inclusive y el JSON de métricas.

Leer primero todos los AGENTS.md aplicables del workspace y los documentos docs/agents/h3-phase3-bot-video-handoff.md y docs/plan-bot-control-jugabilidad-2026-11-01.md. El operador autorizó publicar scripts/documentos seguros sin pedir autorización por commit y dispensó esperar las cuotas de 5h/semanal. No iniciar V2–V4.

## Preflight obligatorio
- Comprobar node, ffmpeg, ffprobe, ROM y g6 certificado local. No aceptar degradación a g5.
- Ejecutar node scripts/h3_explore.mjs replay out/h3/explore/tape-fase2-completa-16980.json. Resultado exigido: MATCH.
- Cinta SHA canónico: 1b77dd6ba5e2798428edb97318b66c106f6bd297fc1fbf15ecffe248df65ccf5.
- RAM SHA en 16980: 825a13d0af28a906b43942f46d2f8088d225691fa4466b658b7983f7fbffa004.
- Estado esperado: phase=2, cp=0, x=80, y=574, scroll=0, lives=4, armor=0.

## Defectos identificados
1. scripts/h3_explore.mjs borra la trayectoria recién generada: después de cur.set(c.masks) y cur.set(chunkMasks(...),len), ejecuta cur.fill(0,len+P.chunk). Inicializar solo el intervalo nuevo ANTES de cur.set(chunkMasks(...),len), conservando el prefijo. Añadir pruebas.
2. El replay actualmente compara h3.transitionFrame con la PRIMERA transición desde el frame 1200; para fase 3 debe registrar y comparar específicamente 0x72:2->3. Mantener compatibilidad con cintas históricas.
3. No usar 0xe76 ni 0xc66/0xcf6 como contador de jefe sin validación de RAM/sprites en fase 3. La X se reinicia; no copiar XCAP ni geometría de fase 2.
4. La muerte del jefe NO cierra la fase. Después puede requerirse esperar/recoger una llave. Verificar transición RAM y fase 4 visible.

## Trabajo por etapas
- [x] P0 Preflight g6, cinta original y replay MATCH.
- [x] P1 Corrección mínima del explorador y tests. No se tocó el motor.
- [x] P2 Exploración determinista reanudable. El tramo de salida se resolvió con segmentos de 120 y 60 frames y una maniobra dirigida a la llave. No se usó ningún contador de vida del jefe sin validar ni se ponderó `H3_WB`.
- [x] P3 Obstáculos superados, llave recogida, transición `2→3` en frame 22029 e inicio jugable de la fase 4 visible en frame 22380.
- [x] P4 Cinta final sellada con `h3.goalFrame`, `h3.signal`, `h3.ramSha`, `h3.transitionFrom=2`, `h3.transitionFrame` y controles liberados. MP4 exportado desde frame 16980.
- [x] P5 Replay `MATCH`, paridad RGBA `PASS` y `H3_PHASE3_ACCEPTANCE=PASS`. ffprobe: H.264, 256×224, 5401 frames, 90,56 s. JSON: `ramVerified=true`, evento `2→3` en 22029.

## Reproducción de la continuación

La secuencia de comandos ejecutada (búsquedas `H3_SEED`, tres maniobras, sellado y gate) está ahora en [docs/go-explore/README.md §10](../go-explore/README.md#10-resultados-verificados).

La cinta final privada es `out/h3/explore/tape-fase3-completa-22380.json`. El vídeo y el JSON son `out/h3/video/tape-fase3-completa-22380-9feecfa4-16980-22380.{mp4,json}`. La búsqueda con `H3_WB=0` avanzó sin asumir que `0xe76` o los contadores de guardianes de la fase 2 describieran al jefe de esta fase. La llave se observó visualmente tras desaparecer el enemigo; la maniobra a la izquierda la recogió y activó la transición automática.

No modificar motor congelado, AOT, runtime, bundle, ROM o RAM; prohibido H3_POKE. Snapshots de laboratorio solo entre ramas. No subir roms/, out/, cfg/ ni bundles privados; navegador y MAME sin ventanas ni capturar el foco.

El vídeo final va a out/h3/video/ como artefacto LOCAL (no se crea desde GitHub). Comunicar ruta, tamaño, duración, conteo de frames, transición y evidencias. No confundir preparar scripts con completar la fase.
