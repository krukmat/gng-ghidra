# Go-Explore — consolidación de scripts y documentación

**Estado:** COMPLETADA (2026-11-02). Entrada canónica: [docs/go-explore/README.md](../go-explore/README.md).

## Objetivo y alcance

Trabajar autónomamente en `/Users/matias/gng-ghidra`. Consolidar el conocimiento sobre Go-Explore y la exploración H3 en un punto de entrada canónico, con instrucciones reproducibles y sin documentación operativa duplicada. La base al redactar esta tarea es `main`, commit `b2b9f6a`.

Leer los `AGENTS.md` aplicables y conservar todos los cambios locales. Revisar el estado real del repositorio antes de editar. Esta tarea es de consolidación: no iniciar V2–V4 ni volver a resolver fases completadas.

## Inventario inicial

Ampliar este inventario mediante búsquedas acotadas y referencias/imports. Distinguir el algoritmo Go-Explore de los buscadores, maniobras y herramientas auxiliares; no asumir que todos utilizan el mismo método.

| Grupo | Archivos |
| --- | --- |
| Explorador | `src/h3_explore.mjs`, `scripts/h3_explore.mjs`, `tests/test_h3_explore.mjs` |
| Búsqueda y maniobras | `scripts/h3_boss_search.mjs`, `scripts/h3_boss_maneuver.mjs` |
| Inspección y cobertura | `scripts/h3_boss_inspect.mjs`, `scripts/h3_boss_trace.mjs`, `scripts/h3_boss_coverage.mjs`, `scripts/h3_static_cover.mjs` |
| Cintas y cierre | `scripts/h3_tape.mjs`, `scripts/h3_finish_phase.mjs`, `scripts/h3_finalize_phase3.mjs` |
| Vídeo y aceptación | `scripts/h3_video.mjs`, `scripts/verify_h3_phase3.sh` |
| Handoffs | `docs/agents/h3-tas-probe-s1-task.md`, `docs/agents/h3-tas-probe-s2-task.md`, `docs/agents/h3-phase2-first-hit-task.md`, `docs/agents/h3-phase3-local-agent-kit.md`, `docs/agents/h3-phase3-bot-video-handoff.md` |
| Planes y evidencia | `docs/plan-contenido-h3-h4-2026-10-27.md`, `docs/plan-bot-control-jugabilidad-2026-11-01.md` |

## Tareas

- [x] Inventariar scripts, documentación, dependencias y consumidores; identificar instrucciones vigentes, duplicadas e históricas.
- [x] Crear `docs/go-explore/README.md` como entrada canónica. Incluir arquitectura, inventario enlazado, propósito de cada herramienta, interfaces, dependencias, variables de entorno y comandos comprobados contra el código. Si se necesitan documentos auxiliares, mantenerlos bajo `docs/go-explore/` y enlazarlos desde ese índice.
- [x] Documentar el flujo completo: reset o cinta semilla → exploración/búsqueda → cinta final → replay → vídeo y aceptación. Explicar determinismo, snapshots de laboratorio, criterios de búsqueda y limitaciones reales.
- [x] Registrar los resultados verificados de las fases 1–3, diferenciando la fase visible del valor RAM. Preservar comandos, hashes y evidencia existente. La fase 3 terminó con transición RAM `0x72:2→3` en frame `22029`, fase 4 visible en `22380` y aceptación `PASS`; contrastarlo con el handoff y las métricas locales si están disponibles.
- [x] Centralizar las instrucciones vigentes y sustituir duplicados por enlaces. Conservar la evidencia histórica en su documento de origen y marcar claramente su estado; no copiar análisis históricos extensos al índice.
- [x] Actualizar el índice principal de documentación existente para facilitar el acceso. Evitar crear índices paralelos que compitan entre sí.
- [x] Mantener inicialmente los scripts en sus rutas actuales. Refactorizar duplicación real solo si se preservan interfaces y reproducibilidad; actualizar todos los consumidores si algún cambio de ruta resulta necesario.
- [x] Verificar enlaces, rutas y ejemplos. Ejecutar las pruebas pertinentes únicamente si cambia comportamiento. Revisar el diff y hacer commit/push de los archivos seguros.

## Restricciones

- Respetar el handoff H3: no modificar motor congelado, AOT, runtime, bundles, ROM o RAM. Prohibido `H3_POKE`; snapshots de laboratorio solo entre ramas.
- No subir `roms/`, `out/`, `cfg/`, cintas, capturas, vídeos ni otros artefactos privados. Referenciarlos por ruta local cuando ayuden a reproducir resultados.
- No presentar contadores RAM sin validar como hechos; en particular, no atribuir salud del jefe de fase 3 a `0xe76`, `0xc66` o `0xcf6` sin evidencia.
- No ejecutar búsquedas largas ni regenerar vídeos por cambios exclusivamente documentales. Si una afirmación no puede comprobarse, señalarla como pendiente o histórica.
- Si se necesita navegador o MAME, mantenerlos sin ventanas ni capturar el foco.
- Consolidar, no acumular: evitar un nuevo resumen que deje activas las mismas instrucciones divergentes en varios sitios. Informar de fusiones, eliminaciones y renombres.

## Criterios de aceptación y entrega

- Un único punto de entrada explica qué ejecutar, con qué entradas y cómo verificar el resultado.
- Los scripts y documentos relevantes están clasificados y enlazados; los handoffs históricos remiten a las instrucciones vigentes.
- Los comandos y variables documentados coinciden con el código; los resultados históricos conservan su evidencia y sus límites.
- No hay cambios en artefactos privados ni en componentes congelados.
- Entregar enlace al índice canónico, resumen de consolidaciones y documentos históricos, verificaciones realizadas y commit publicado.

Reportar progreso con barra y tareas. Completar la consolidación; no limitarse a proponer un plan o elaborar un inventario.
