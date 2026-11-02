# Handoff: bot y vídeo de la fase 3

## Objetivo y criterio de cierre

Programar una continuación reproducible del bot desde el inicio de la tercera fase hasta completarla. Entregar una cinta de entradas, MP4 y JSON con métricas que muestren el recorrido completo de esa fase, su conclusión y el inicio visible de la cuarta. No cerrar con un clip parcial o solo con la muerte del jefe: verificar la transición RAM `0x72` de **2 a 3**.

Trabajar en el mismo workspace `/Users/matias/gng-ghidra`. Los artefactos privados de `out/`, el bundle g6 y la ROM son locales; no se distribuyen con git. Si falta la cinta o el bundle, comprobar su disponibilidad antes de iniciar búsquedas.

Leer las instrucciones AGENTS suministradas por el operador y `docs/plan-bot-control-jugabilidad-2026-11-01.md`. Al empezar, pedir los porcentajes restantes de 5 h y semanal si no se han dado ambos y esperar; estimar el trabajo en ambas unidades. Mantener actualizaciones breves y marcar las casillas al cerrar cada tarea. No empezar V2–V4 por este encargo.

## Punto de partida comprobado

- Cinta: `out/h3/explore/tape-fase2-completa-16980.json`.
- Bundle certificado: g6. Cinta SHA-256: `1b77dd6ba5e2798428edb97318b66c106f6bd297fc1fbf15ecffe248df65ccf5`.
- Frame final/objetivo: **16980**. RAM SHA-256: `825a13d0af28a906b43942f46d2f8088d225691fa4466b658b7983f7fbffa004`.
- Estado: `phase=2`, `cp=0`, `x=80`, `y=574`, `scroll=0`, `lives=4`, `armor=0` (armadura puesta).
- La segunda fase terminó en frame **16566**. Replay desde reset: `MATCH`, sin frame fatal, mínimo 3 vidas. La cinta contiene únicamente entradas y no usa pokes.
- Evidencia anterior: `out/h3/video/fase2.mp4` y `fase2.json`, frames 5950–16980, 11031 frames, 184,97 s. Último frame: inicio de la fase 3. RGBA final idéntico al renderer empaquetado de la app.

Verificar primero:

```sh
node scripts/h3_explore.mjs replay out/h3/explore/tape-fase2-completa-16980.json
```

## Implementación y herramientas

Extender las herramientas existentes o añadir un controlador pequeño para la fase 3. Debe aceptar la cinta inicial, preservar su prefijo, guardar continuaciones reanudables y producir el resultado sin depender de instrucciones manuales no registradas. Identificar los obstáculos reales mediante RAM, inspección visual y búsquedas acotadas.

- `scripts/h3_explore.mjs`: exploración con `--from`, verificación de prefijo y replay con huella RAM.
- `scripts/h3_boss_search.mjs`: búsqueda desde `H3_SEED`; objetivo de avance `phase !== fase-inicial`. Pesos `H3_WX`, `H3_WY`, `H3_WU`, `H3_WS`, `H3_WA`, `H3_WB`; ancho, horizonte y retroceso configurables. `H3_WU` premia bajar Y respecto del inicio. X vuelve a 80 en esta fase: no trasladar límites ni geometría de la fase anterior.
- `H3_BOSS_LIFE` permite leer una o varias direcciones de vida. **Localizarlas y validarlas para esta fase**; `0xe76` no es un contador universal. `0xc66,0xcf6` fueron los guardianes de la fase 2 y no están validados aquí. Omitir `H3_POKE`.
- La búsqueda requiere un prefijo con controles liberados al comenzar; la cinta de arranque los tiene liberados. Al ramificar más adelante, usar un límite de segmento liberado o el manejo de reemplazo de `h3_boss_maneuver.mjs`.
- `scripts/h3_boss_maneuver.mjs`: hasta tres rutas desde un prefijo, horizonte máximo 240 frames. Acciones y cadencia en `src/h3_lab_maneuver.mjs`; `idle` es la pausa. Corrige controles retenidos y guarda `frames=END+1` para incluir la liberación final. Las cintas quedan en `out/h3/boss/f2/` por el nombre histórico del directorio.
- `scripts/h3_boss_inspect.mjs`: etiquetas y sprites en frames concretos. Filtrar su salida; evitar imprimir todas las estructuras.
- `scripts/h3_boss_trace.mjs`: diagnóstico de RAM en ventanas de hasta 122 frames, sin cambiar el motor.
- `scripts/h3_video.mjs check <cinta> <frame>` compara RGBA con la app. `export <cinta> <fin> <inicio>` reproduce el prefijo y exporta solo el tramo solicitado.
- `scripts/h3_finish_phase.mjs` está especializado en el primer jefe. No asumir que detecta el jefe o la llave de la fase 3.

La fase 2 se resolvió con búsquedas gruesas para avanzar, segmentos de 8–12 frames junto a peligros y un objetivo de vida del jefe en el combate. Tras derrotar a los guardianes hubo que esperar a que apareciera la llave y volver a recogerla: priorizar X dejó al bot esperando en el extremo derecho. Programar también el cierre de la fase y su espera de transición.

## Validación y entregables

1. Cinta final de solo entradas, con `h3.goalFrame`, señal final y `h3.ramSha` para permitir un replay independiente `MATCH`. Preservar exactamente el prefijo hasta frame 16980. No sobrescribir la cinta inicial.
2. Detectar el frame exacto de transición `0x72: 2→3` y continuar hasta mostrar el inicio de la cuarta fase. Registrar muertes, vidas y armadura con precisión; si las hay, no ocultarlas en el vídeo.
3. Ejecutar replay desde reset y paridad RGBA en un frame real. Exportar el vídeo completo de la fase 3 empezando en **16980**, compartiendo ese frame con el vídeo anterior:

   ```sh
   node scripts/h3_video.mjs check <cinta-final.json> <frame-final>
   node scripts/h3_video.mjs export <cinta-final.json> <frame-final> 16980
   ```

4. Comprobar con `ffprobe` duración, resolución y número de frames; confirmar el evento de fase y `ramVerified: true` en las métricas. Guardar MP4/JSON en `out/h3/video/` y entregar enlaces locales. Marcar la tarea de fase 3 en el plan solo con estos criterios cumplidos.

## Restricciones

No modificar el motor congelado, AOT, runtime ni bundles. No hacer pokes, trucos ni cambios de RAM para superar la fase. No subir ROM, `out/`, `cfg/` ni `gng-ghidra/` a git. Las pruebas de navegador son sin ventana; MAME, si llega a ser necesario y autorizado por las instrucciones aplicables, también sin ventana ni tomar el foco. No hacer commit ni push salvo petición del operador.
