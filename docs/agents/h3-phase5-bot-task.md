# H3 fase 5 — bot, cinta y vídeo

**Estado:** pendiente. **Referencia operativa única:** [docs/go-explore/README.md](../go-explore/README.md). Este encargo fija objetivo, semilla y criterios; consultar allí comandos, variables, métodos y límites.

## Objetivo
Trabajar en `/Users/matias/gng-ghidra`. Continuar la fase visible 5 desde la cinta final de la fase 4 hasta verificar **RAM `0x72:4→5`**, y continuar hasta mostrar el **inicio jugable de la fase 6**. Entregar cinta de solo entradas, `fase5.mp4` completo y JSON de métricas. No iniciar V2–V4.

## Semilla validada (evidencia README §10, 2026-11-02)

| Dato | Valor |
|---|---|
| Cinta | `out/h3/explore/tape-fase4-completa-28260.json` |
| SHA-256 canónico de la cinta | `ca3be0033ff46cbe28e2b10870b698369505725de352253b7ec183ded62926ac` |
| `goalFrame` y primer frame del vídeo | **28260** |
| `ramSha` | `182df0da9c2a2451bf157d088b42c528af6f4771fed00c43ac3984e66c0a61dd` |
| Estado RAM | phase=4, cp=0, X=6736, Y=575, scroll=6656, lives=4, armor=0 (equipada) |
| Bundle | g6 certificado, sin degradación |
| Gate previo | `H3_PHASE4_ACCEPTANCE=PASS`, RAM 3→4 en 27849 |

Leer primero los **AGENTS.md locales aplicables**, este encargo y el README. Hacer el preflight de §5: bundle, ROM, ffmpeg/ffprobe, cinta, SHA y **replay desde reset MATCH**. Si falla, no buscar. Las cuotas 5h/semanal no deben bloquear el encargo.

## Bloques de trabajo
- [ ] **P0 — Preflight** de semilla en 28260, RAM hash, g6, dependencias y controles liberados.
- [ ] **P1 — Exploración** con `H3_SEED`, fase RAM **4**, segmentos hasta 120 frames en abierto y de 60 o menores en peligro. Guardar checkpoints y ramificar de modo determinista. Evitar asumir XCAP/geometría anterior.
- [ ] **P2 — Cierre** observando RAM y sprites con inspect/trace acotados. No usar `H3_WB` ni contador de jefe supuesto sin validar dirección con **al menos dos ramas**. Revisar supervivencia ~120 frames tras fosos: `H3_LAST` puede seleccionar una ruta condenada. Tras matar jefe, buscar/esperar llave cuando corresponda; matar jefe no certifica fase.
- [ ] **P3 — Transición**: registrar primer frame exacto RAM **4→5** y continuar hasta ver fase 6 **jugable**.
- [ ] **P4 — Entrega**: sellar con `h3_finalize_phase.mjs` (fase visible 5, semilla 28260); gate `verify_h3_phase.sh` (fase 5); no modificar interfaces de fases 3–4. Vídeo desde 28260 **inclusive**.
- [ ] **P5 — Evidencia**: registrar **cada comando que contribuya a la cinta**, argumentos, variables `H3_*`, salidas y hashes en `out/h3/phase5/commands.log` usando `h3_run_logged.sh`. Solo tras gate PASS actualizar README §10 y marcar plan; commit/push de archivos seguros.

## Criterios de aceptación (README §11)
1. Cinta `out/h3/explore/tape-fase5-completa-<goalFrame>.json`, solo entradas, prefijo anterior al corte 28260 **idéntico** al original, sin pokes, con controles P1 liberados. Metadatos `h3.goalFrame`, `h3.signal`, `h3.ramSha`, `h3.transitionFrom=4`, `h3.transitionFrame`, `minLives` y `firstFatal`.
2. Replay `MATCH` desde reset, paridad visual `h3_video check=PASS`, transición exacta RAM 4→5, último frame `inGame=true` y `phase=5`.
3. `out/h3/video/fase5.{mp4,json}` **solo tras gate** `H3_PHASE5_ACCEPTANCE=PASS`; ffprobe H.264, 256×224 y conteo `goalFrame - 28260 + 1`. Métricas `ramVerified=true`, exactamente un evento `phase 4→5`, sin ocultar muertes, vidas ni armadura.
4. Reportar rutas locales, frame de transición, duración, frames, tamaño y hashes de cinta/RAM/MP4. Conservar logs y pasos reproducibles.

## Restricciones
Prohibido tocar motor congelado, AOT, runtime, bundle, ROM o RAM; **nunca `H3_POKE`**. Snapshots solo entre ramas. No subir `roms/`, `out/`, `cfg/`, `gng-ghidra/` ni cintas, capturas o vídeos. MAME/Playwright solo sin ventanas ni foco. Autoriza commit y push a `main` únicamente de código, tests y documentación seguros. Reportar con barra de progreso y checklist. No marcar cierre sin evidencia.
