# B1/B2 — Handoff local de evidencias y percepción (27/10/2026)

**Rama:** `main` · **Estado:** `PARTIAL / BOT STOP` · **Alcance:** `bot/`, `tests/bot/`, `docs/`. No se han ejecutado episodios nuevos, replays ni tests Node en la sesión remota. Las 18 comprobaciones ROM-free añadidas se han ejecutado con un harness JavaScript V8 aislado sobre el código real recuperado de GitHub (**18 PASS, 0 FAIL**); no sustituyen `node --test`.

## Entregables nuevos en main

| Task | Artefacto | Estado | Límite |
| --- | --- | --- | --- |
| B1.1 / B1.3 | [`bot/diagnostics.mjs`](../../bot/diagnostics.mjs) | IMPLEMENTED_UNVERIFIED_LOCAL | Clasifica `CENSORED_HALT`, `LIFE_LOSS`, `HORIZON_ONLY`, `UNKNOWN_TERMINATION`; `PLATEAU_CANDIDATE` solo con checkpoints conocidos de una vida |
| B1.1 / B1.2 | [`bot/diagnose.mjs`](../../bot/diagnose.mjs) | IMPLEMENTED_UNVERIFIED_LOCAL | Lee cuatro `report.json` privados, comprueba 253/229/24 y sugiere frames; **no abre imágenes ni juega** |
| BT-1 T1.1 | [`bot/perception/progress.mjs`](../../bot/perception/progress.mjs) | SYNTHETIC_ONLY | Integra `screenX + scrollDelta` de origen **visual**; exige `lifeKey` confirmado, confianza, frame y sesión; no conoce `world_x` absoluto |
| BT-1 T1.1 | [`bot/perception/template.mjs`](../../bot/perception/template.mjs) | SYNTHETIC_ONLY | Localiza plantilla RGBA con máscara alpha, ROI y margen frente a segundos candidatos; no contiene sprites, ROM ni plantillas reales |
| Regresión | `tests/bot/{diagnostics,progress,template}.test.mjs` | SYNTHETIC_PASS_V8 | 18 aserciones ejecutadas en V8; falta suite Node y corpus auténtico |

**No se ha implementado la táctica H2 ni se ha integrado un controlador en vivo.** La plantilla y el seguimiento son componentes puros, no detectores calibrados. Un `MATCH` o `ADVANCE_CANDIDATE` no equivale a enemigo identificado, nivel superado ni progreso por vida certificado.

## Pasos locales, en orden

1. Comprobar la disponibilidad de cuota 5h/7d y estimar coste de replay antes de ejecutar el motor. No publicar valores de ROM ni artefactos.
2. Ejecutar pruebas **ROM-free** y auditoría **sin motor**:

```bash
node --test tests/bot/diagnostics.test.mjs tests/bot/progress.test.mjs tests/bot/template.test.mjs
node bot/diagnose.mjs
```

3. Confirmar que `BOT_B1_AUDIT` indica `checkpointMatch:true`, `total:253`, `completed:229`, `censored:24`, `unresolved:0`. Si no, STOP y explicar discrepancia; no reinterpretar `FRAMES_DONE` como victoria.
4. Solo si la cuota lo permite, reproducir **cintas ya existentes** para obtener capturas privadas (nunca nuevos candidatos):

```bash
node bot/replay.mjs out/bot/late-sweep/trial-6.json 3600 2720,2760,2800,2840,2860,2880,2900 b1-peak
node bot/replay.mjs out/bot/late-sweep/trial-67.json 5000 2340,2400,2800,3600,5000 b1-plateau
node bot/replay.mjs out/v3/b3/explorer/explorer-g4-2730-1606.json 3600 2720,2760,2800,2840,2880,3200 b1-baseline
```

Si un replay no dispone de `roms/gng.zip`, g4 o frames conocidos, conservar el error y STOP. Los PNG/JSON resultantes deben permanecer en `out/bot/`, que está ignorado por Git.

5. Etiquetar alrededor de los frames 2839/2881 y en el plateau: `ARTHUR_VISIBLE`, `ENEMY_VISIBLE`, `WATER_VISIBLE`, `PLATFORM_VISIBLE`, `PROJECTILE_VISIBLE`, `DAMAGE`, `DEATH`, `RESPAWN`, `PLATEAU` o `UNKNOWN`. Distinguir **lo observado** de la hipótesis de causalidad. Para HALT, elegir una cinta por PC 0xE79E y 0xC3A3 del reporte y etiquetar solo frames disponibles antes del HALT.
6. Calibrar la detección de Arthur/scroll y la identidad del obstáculo sobre capturas locales; conservar ejemplos positivos y negativos **privados**. No inferir `lifeKey` de una simple caída de `world_x` ni de un byte de fase. Repetir tests en Node y añadir casos reales con fixtures sintéticos/derivados sin gráficos protegidos.
7. Si se identifica visualmente aproximación del Arremer y se cumplen las condiciones de confianza, autorizar un único cambio táctico H2 con máximo tres pares desde reset, uno holdout. Si la causa parece agua/plataforma o es `UNKNOWN`, **no** implementar H2; reformular la hipótesis.

## Gate

**GO a B2 táctica:** 253 intentos auditados, pérdida/plateau/amenaza distinguidos por capturas, tracker visual calibrado, tests Node PASS, cuota disponible y protocolo pareado con holdout congelado.

**STOP:** capturas no accesibles, señal de scroll/vida no confiable, `UNCOMPILED`, presupuesto insuficiente, dependencia de RAM live, necesidad de cambiar engine/AOT/render/servidor o inferencia de victoria a partir de picos.

**Siguiente dependencia real:** acceso local a `out/bot/` y al bundle g4. Ningún artefacto privado se ha copiado a GitHub. La investigación avanzada externa, si llega, es contexto adicional y no reemplaza la validación visual.


## Checkpoint local: auditor + tres replays (evidencia comunicada, 27/10/2026)

**Pruebas ROM-free Node:** 18/18 PASS, 0 FAIL (`duration_ms=43.570166`).
**Auditor:** 253 intentos, 229 `FRAMES_DONE`, 24 censurados,
0 no resueltos, 227 con pérdida de vida, 2 candidatos a plateau.
HALT por PC: `0xE79E=19` y `0xC3A3=5`.
`checkpointMatch=true`.

**Los tres replays locales terminaron `FRAMES_DONE` y escribieron capturas
privadas PNG; ninguna captura fue inspeccionada remotamente.**

| Caso / PNG privado | Pico | Vida perdida | Final / frame | Observación |
| --- | ---: | --- | ---: | --- |
| `b1-peak/frames.png` | 1700 | Frame 2881 | 451 / 3600 | `world=1700,y=26` entre 2800 y 3200, respawn visible solo por datos al 3300 |
| `b1-baseline/frames.png` | 1606 | Frame 2839 | 40 / 3600 | `world=1606,y=54` entre 2700 y 3100, cambio de posición al 3200 |
| `b1-plateau/frames.png` | **1318** | No | **1279 / 5000** | `world=1279,y=62` estable de 2400 a 5000, tres vidas conservadas |

**Corrección importante:** el plateau tiene `maxWorld=1318`, no 1279:
1279 es su posición final y el valor estabilizado. Ni ese máximo ni
`FRAMES_DONE` acreditan victoria. El decremento de vidas tampoco revela
el instante de colisión.

**Gate de imagen:** `STOP_VISUAL_VALIDATION_PENDING`. Los datos numéricos
no identifican la causa física de muerte ni distinguen Arremer, agua o salto.
Para cerrar B1.2 hay que inspeccionar las tres imágenes privadas generadas
(`out/bot/{b1-peak,b1-baseline,b1-plateau}/frames.png`) y etiquetar como
`UNKNOWN` lo no visible. **Sin nuevos barridos, sin editar engine.**


## B2: giro por hipótesis de caída al agua

Tras inspeccionar las capturas aportadas, el siguiente frente ya no es la
táctica contra el enemigo rojo, sino el salto al islote móvil. Se implementó
el [controlador B2 de cruce](gng-bot-water-crossing-b2.md) con tests ROM-free
y parada conservadora. La validación real permanece pendiente de calibración
visual y de fotografías pre-impacto; no se ha demostrado un aterrizaje.
