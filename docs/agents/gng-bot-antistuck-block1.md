# B1 — Diagnóstico del atasco y experimento mínimo (revisión remota)

**Fecha:** 2026-10-27 · **Base:** \`main@ff014ec4798a37c80a27af35d595c8c883fe3ee5\` · **Estado:** \`PARTIAL / BOT STOP\`.

**Alcance:** diagnóstico y diseño, sin partidas nuevas, sin cambios en motor/AOT/renderizador/servidor/bundles, sin RAM live ni publicación de artefactos privados. Esta revisión usa archivos versionados del repositorio y fuentes externas. **No** se ha accedido al Mac, a \`out/bot/\`, a sus imágenes ni a cuotas 5h/7d; no se han ejecutado tests ni replays. Las fuentes externas no certifican una táctica para \`gngb\`.

## 1. Tasks y dependencias

| ID | Dependencias | Estado | Resultado / siguiente acción |
| --- | --- | --- | --- |
| B1.0 Contexto y cuotas | — | PARTIAL | HEAD y restricciones verificados; cuota 5h/7d no accesible remotamente. No se inició trabajo costoso. |
| B1.1 Inventario de 253 intentos | B1.0 | PARTIAL | Cuatro familias y casos clave contrastados con checkpoint versionado; JSON privados pendientes de auditoría local. |
| B1.2 Etiquetado de imágenes | B1.1 | BLOCKED_LOCAL | Sin acceso a capturas: no se puede decidir si la muerte procede del enemigo, del agua o del timing. |
| B1.3 Métricas y etiquetas | B1.2 (para calibrar) | SPEC_READY | Especificación abajo; umbrales no calibrados ni testeados. |
| B1.4 Hipótesis y fuentes | B1.1 | PARTIAL | Tres hipótesis refutables y fuentes externas preliminares; falta contraste visual local y revisar el informe de Investigación avanzada. |
| B1.5 Experimento pareado | B1.3, B1.4 | DESIGN_READY_CONDITIONAL | Tres pares propuestos (uno holdout), sujetos a validación de detector y cuota. No ejecutados. |
| B1.6 Informe y gate | B1.5 | PARTIAL | Este informe documenta el STOP y el handoff local. |

## 2. Evidencia local auditada solo a nivel documental

Fuentes internas: [checkpoint G2](v3-b3-g2-explorer-task.md), [investigación local](gng-bot-antistuck-task.md), [tarea externa](gng-bot-external-research-task.md), [evaluador](../../bot/evaluation.mjs) y [buscador](../../bot/search.mjs).

| Caso / ruta privada (no abierta) | Dato documentado | Interpretación segura | Etiqueta visual |
| --- | --- | --- | --- |
| Baseline \`explorer-g4-2730-1606.json\` | Máximo x=1606, primera pérdida visible frame 2839, respawn ~3100–3200 | No hubo clear; instante de colisión anterior **desconocido** | \`DEATH=UNKNOWN\` hasta revisar imagen |
| \`out/bot/late-sweep/trial-6.json\` | Corte 2100, pico x=1700, pérdida frame 2881, x=451 al final (3600) | Pico condenado; no avance sostenido | \`THREAT/DEATH=UNKNOWN\` |
| \`out/bot/late-sweep/trial-67.json\` | Retirada/disparo desde 2340, x=1279 y 3 vidas hasta 5000; inmóvil desde ~2400 | \`PLATEAU\` inferido por posición documentada, no victoria | \`PLATEAU\` pendiente de confirmar por píxeles |
| 24 \`UNCOMPILED\` | 19 en 0xE79E y 5 en 0xC3A3; 20 sin decremento visible, 4 tras decremento | Censura dependiente de ruta, no resultado de gameplay | \`HALT\` conocido; causa/estado del personaje \`UNKNOWN\` |

Totales documentados: **253** candidatos desde reset, **229** \`FRAMES_DONE\`, **24** \`UNCOMPILED\`, **0** transiciones de fase demostradas. No se han recontado los informes privados; no se calculan tasas de éxito a partir de solo 229 completos. El byte 0x0052 es candidato no validado. Las variantes nuevas no heredan el gate histórico MAME/live.

**Observación de código:** \`compareEvaluations\` ordena primero por \`FRAMES_DONE\`, \`known\`, \`livesLost\` y \`finalWorld\`. Esta preferencia puede favorecer una retirada inmóvil frente a un pico que acaba en muerte. El ranking **no** demuestra éxito; \`survivalFrames\` se detiene en el decremento visible, no en el impacto.

## 3. Especificación de etiquetas y métricas (B1.3)

Unidad de evaluación: **vida**, dentro de partida/crédito y episodio reset→fin. Conservar \`frame\`, \`session\`, política, \`bundleHash\`, \`inputTapeHash\`, \`status\`, \`livesLost\`, confianza visual y resultado de censura. Separar los canales: (a) observación live por píxeles 256×224 y metadatos; (b) RAM **solo offline** para calibración/evaluación.

- \`ADVANCE\`: incremento de posición del personaje compensado por scroll, con confianza suficiente y **dentro de la misma vida**. Si no se puede reconstruir, \`worldProgress=UNKNOWN\`.
- \`PLATEAU\`: sin desplazamiento neto positivo en ventana móvil, **sin** confundir animación de sprite con movimiento. Umbral y ventana por calibrar con imágenes; provisionalmente explorar 120 frames y 8 px, nunca declarar validado.
- \`THREAT\`: enemigo/proyectil/terreno peligroso **visible**, localización y tendencia confiables; si no, \`UNKNOWN\`.
- \`DAMAGE\` ≠ \`DEATH\`; armadura perdida ≠ vida perdida. \`DEATH\` requiere evidencia visual inequívoca o confirmación posterior, anotando intervalo de incertidumbre anterior al decremento de HUD.
- \`RESPAWN\` requiere secuencia observada; \`positionResets > 256\` no basta.
- \`HALT\`: censura en frame/PC/banco. Mantenerlo en el denominador de intentos y como estado separado; no imputar vida, muerte ni victoria.
- \`STAGE_CLEAR\`: transición visual auténtica y reproducible en el motor congelado; 0x0052 y \`FRAMES_DONE\` no bastan.

**Gate futuro de progreso (provisional):** superar x=1700 y ganar al menos otros 64 px de progreso **neto** durante una ventana posterior de 120 frames, en la misma vida, sin \`DEATH\`, sin decremento ni plateau y con posición/scroll visualmente validados. Los números 64/120 son umbrales propuestos para refutar un pico breve, no parámetros calibrados; si no hay señal visual fiable, \`STOP\`.

## 4. Investigación externa preliminar (B1.4)

| Fuente y alcance | Evidencia relevante | Límite |
| --- | --- | --- |
| [Capcom Town, Ghosts 'n Goblins](https://captown.capcom.com/en/classic_games/2), ficha oficial | Identifica origen arcade (1985) y controles de movimiento/salto/ataque | La ficha interactiva es de versión doméstica; no prueba timings de \`gngb\` |
| [Unco Lober, guía Arcade, v1.1 (2014), STAGE 1](https://gamefaqs.gamespot.com/arcade/563979-ghosts-n-goblins/faqs/62989) | Describe Red Arremer antes del agua/plataforma móvil y distingue al jefe Unicorn; propone atraer la embestida, retirarse y cambiar dirección | Guía de jugador, no telemetría del motor; revisiones y patrones pueden diferir |
| [OpenCV, Template Matching](https://docs.opencv.org/4.x/d4/dc6/tutorial_py_template_matching.html) | \`matchTemplate\` localiza una plantilla dentro de una imagen | Animaciones/oclusiones y sprites parecidos generan ambigüedad; requiere templates privados |
| [OpenCV, phaseCorrelate](https://docs.opencv.org/4.x/d7/df3/group__imgproc__motion.html) | Estima traslación entre imágenes y devuelve respuesta de confianza | Fondo con parallax/animación/agua puede degradar el registro |
| [NIST, Assessing Product Reliability §8.1.3.1](https://www.itl.nist.gov/div898/handbook/toolaids/pff/apr.pdf) | Distingue fallo observado de tiempo censurado | La censura por \`UNCOMPILED\` puede depender de la ruta: no asumir independencia |

No se ha verificado identidad del enemigo ni causa local de muerte. La guía arcade es evidencia externa de **posible** orden de obstáculos, no certificación de la escena \`gngb\`.

### Hipótesis ordenadas

**H1 — Observación insuficiente: enemigo frente a agua/plataforma.** Hecho externo: guía arcade separa Red Arremer, agua y plataforma móvil. Inferencia: el pico y la muerte podrían proceder de obstáculos diferentes. Alternativa: colisión previa ya irreversible. **Refutación:** capturas previas al primer decremento muestran una causa inequívoca y consistente. **Cambio:** etiquetado visual con \`UNKNOWN\` y ROI de Arthur/fondo/amenaza; sin modificar controles todavía.

**H2 — Ataque/salto periódico altera la reacción del enemigo.** Hecho externo de jugador: la guía describe evasión del Arremer frente a disparos y oportunidades durante carga/descenso. Hipótesis local: macros continuas activan una trayectoria peligrosa. Alternativa: el problema es el salto sobre agua, no el enemigo. **Refutación:** capturas no muestran enemigo cercano o la reacción precede a los disparos. **Cambio candidato:** suprimir temporalmente disparo/salto ante una aproximación visual confirmada, retirada breve y reorientación, con límite estricto.

**H3 — Función de ranking favorece estancamiento.** Hecho local de código: pérdidas de vida y posición final se comparan antes del progreso sostenido. Hipótesis: escoger solo el mejor ranking selecciona políticas conservadoras sin avanzar. Alternativa: el ranking es correcto para ordenar diagnósticos, pero la política realmente no puede superar el obstáculo. **Refutación:** una política elegida por ranking sí muestra avance nuevo sostenido por vida. **Cambio futuro:** evaluar métricas por vida y penalizar plateau; no reescribir el buscador en B1.

## 5. Percepción mínima y siguiente experimento (B1.5)

**Detector propuesto, no implementado:** (1) \`matchTemplate\` de Arthur y enemigo con múltiples poses extraídas **solo localmente** de capturas autorizadas; devolver posición, segundo mejor candidato y confianza. (2) \`phaseCorrelate\` sobre ROI de fondo, excluyendo HUD, sprites y agua animada, para estimar scroll. Al perder confianza en cualquiera, emitir \`UNKNOWN\` y no disparar una táctica nueva. Antes de implementar, validar con cuatro clases privadas: movimiento, plateau, muerte/respawn y HALT. No subir plantillas ni imágenes.

**Único experimento posterior, CONDICIONAL a B1.2:** probar H2 si se confirma visualmente amenaza del Arremer; si no, STOP y reformular para la plataforma. Comparar baseline macro \`right_fire_jump\` (periodos actuales: fire 12, jump 44) contra la misma macro con **una sola** intervención visual: al detectar \`THREAT_APPROACH\` en observaciones consecutivas y con confianza calibrada, retirar salto/disparo durante 18 frames con \`left\`, invertir a \`right_fire\` durante 24 frames y volver al baseline. Abortar la intervención si aparece \`UNKNOWN\`, borde de agua, \`DAMAGE/DEATH\` o cambio de sesión. Duraciones **propuestas**, no validadas. No repetir disparadores sin límite: máximo una intervención por vida.

| Par | Corte desde reset | Horizonte | Perfil | Ajustes |
| --- | --- | --- | --- | --- |
| P1 | 2100 | 3600 | Desarrollo | Calibrar **solo** con datos previos y P1 |
| P2 | 2190 | 3600 | Desarrollo | Validación interna; congelar parámetros después |
| P3 | 2340 | 3600 | **Holdout** | Reservado: no ajustar usando P3 |

Todos los pares: mismo bundle g4, cinta de referencia y prefijo idéntico **dentro de cada par**, mismas vidas/créditos, mismo horizonte, desde reset. Sin seeds inventadas, snapshots, RAM live, clonación ni MAME como ejecutor. Guardar tapes, métricas y hashes en \`out/bot/\`; anotar \`UNCOMPILED\` por separado. P1/P2 no equivalen a réplicas estadísticas independientes si el motor es determinista. **Antes de correr:** comprobar cuotas 5h/7d y medir coste de una ejecución representativa para estimar el bloque; si no hay cuota, STOP.

## 6. Gate y handoff

**B1_RESEARCH_PARTIAL / BOT STOP.** Están documentados el inventario, las hipótesis, las métricas y un experimento condicional. **No** se cumple GO de ejecución porque faltan capturas privadas para B1.2, confianza de percepción, cuota 5h/7d y contraste final de Investigación avanzada.

**Handoff local mínimo:** abrir \`out/bot/late-sweep/trial-6.json\`, \`trial-67.json\`, baseline y un HALT por PC; anotar frames inmediatamente anteriores a 2839/2881, presencia y posición de Arthur/Arremer/agua/plataforma, daño y respawn. Verificar que los informes suman 253 y 24 censurados. Validar o descartar H2 **antes** de implementar un detector o ejecutar P1–P3. Si las imágenes son insuficientes, dejar \`UNKNOWN\` y mantener STOP.