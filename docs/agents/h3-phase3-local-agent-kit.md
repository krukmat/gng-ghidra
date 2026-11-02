# H3 fase 3 — handoff para agente local

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
- [ ] P0 Preflight g6, cinta original y replay MATCH.
- [ ] P1 Corrección mínima del explorador y tests. No tocar motor.
- [ ] P2 Exploración determinista reanudable. Segmentos ~60–120 frames en tramo seguro y 8–12 cerca de riesgos; registrar estado, progreso, vidas, armadura y checkpoints. Detectar vida del jefe mediante evidencia, no suposiciones. Evitar stalls sin límite.
- [ ] P3 Derrotar obstáculos, recoger llave si aparece, detectar frame exacto 2->3 y continuar hasta fase 4 visible.
- [ ] P4 Escribir cinta final con h3.goalFrame, h3.signal, h3.ramSha, h3.transitionFrame y liberación de controles; exportar con node scripts/h3_video.mjs export FINAL END 16980.
- [ ] P5 Ejecutar node scripts/h3_explore.mjs replay FINAL (MATCH); node scripts/h3_video.mjs check FINAL END (PASS); bash scripts/verify_h3_phase3.sh FINAL (PASS). ffprobe debe confirmar H.264, 256x224, END-16980+1 frames, JSON ramVerified=true y evento 2->3 en frame exacto. Solo entonces marcar [x] en el plan.

No modificar motor congelado, AOT, runtime, bundle, ROM o RAM; prohibido H3_POKE. Snapshots de laboratorio solo entre ramas. No subir roms/, out/, cfg/ ni bundles privados; navegador y MAME sin ventanas ni capturar el foco.

El vídeo final va a out/h3/video/ como artefacto LOCAL (no se crea desde GitHub). Comunicar ruta, tamaño, duración, conteo de frames, transición y evidencias. No confundir preparar scripts con completar la fase.
