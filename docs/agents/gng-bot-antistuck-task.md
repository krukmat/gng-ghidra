# Investigación del atasco del bot

**Dirección vigente (27/10/2026): BOT STOP.** El objetivo sigue siendo terminar
el juego completo **en el motor implementado del repo**, incluidos los niveles
posteriores y las dos vueltas. Esta task prepara una estrategia verificable
para reanudar; **no ejecuta nuevas partidas ni búsquedas en este bloque**.

**Ejecución: NOT_STARTED.** Rama de referencia: `main`; checkpoint anterior:
`d93a100`. El checkpoint nuevo es el commit que incorpora esta task y las
herramientas `bot/`; consultar `git log -1 --format=%h -- bot/search.mjs`.
Los resultados nuevos no pertenecen a `d93a100`.

## Alcance y fuentes

- Engine, AOT, renderizador, servidor y bundles certificados **congelados**.
  Cambios permitidos: `bot/`, `tests/bot/` y `docs/`; artefactos privados:
  `out/bot/`. ROM, imágenes, cintas y volcados no se publican.
- Acciones exclusivamente mediante controles P1 originales. Evaluaciones
  posteriores desde reset, sin snapshots, clonación, escrituras de memoria,
  inyección de estado ni créditos para fingir supervivencia.
- MAME sirve exclusivamente para comparar resultados; nunca es el motor de
  búsqueda ni juega por el bot. Un `UNCOMPILED` es una dependencia externa:
  guardar la cinta y detener esa rama, sin ampliar AOT aquí.
- Usar píxeles para decisiones del bot. Las lecturas offline existentes de
  `onFrame` sirven para calibración y evaluación, sin introducir acceso RAM
  privilegiado en vivo ni nuevas APIs del engine.
- Al empezar otra sesión, pedir y esperar porcentajes disponibles de 5h y 7d
  según `AGENTS.md`; acotar el bloque y estimar ambos consumos antes de trabajo
  costoso.

Contexto del repo:
[entrada general](gng-100-playable-entrypoint.md),
[explorador y gates E0–E4](v3-b3-g2-explorer-task.md),
[plan de bot con motor congelado](gng-bot-gameplay-plan-2026-10-27.md) e
[informe V3.B3](../v3-b3-playable-2026-10-26.md).
Herramientas actuales: [acciones](../../bot/actions.mjs),
[métricas](../../bot/evaluation.mjs),
[evaluación offline](../../bot/engine-evaluation.mjs) y
[búsqueda acotada](../../bot/search.mjs).
Tests ROM-free: [acciones](../../tests/bot/actions.test.mjs) y
[evaluación](../../tests/bot/evaluation.test.mjs).

## Evidencia de partida

Los informes privados de `early-sweep`, `late-sweep`, `early-tactics` y
`jump-cadence` bajo `out/bot/` reúnen **253 intentos: 229 completan su horizonte
y 24 llegan a HALT**. Completar el horizonte solo significa `FRAMES_DONE`.

- Máximo de primera vida: `world_x=1700`, variante 6 de `late-sweep`, corte
  2100. Pierde vida en el frame **2881**, reaparece y termina en `x=451` en
  3600. Frente al baseline (`x=1606`, pérdida en 2839), son **94 unidades de
  pico y 42 frames hasta el decremento**, sin avance sostenido certificado.
- Solo dos variantes completan 3600 sin decremento: quedan en `x=1279` y
  `x=1039`. La primera se reprodujo hasta 5000 con tres vidas, inmóvil.
  Más espera no equivale a progreso.
- No hay niveles completados ni transición real demostrada. `0x0052` sigue
  siendo **candidato sin validar**, no un contador de fase fiable; no registrar
  cero niveles como si se hubiese validado ese byte.
- De 24 HALT, **20 ocurren antes del primer decremento observable**: 19 en
  `0xE79E` y uno en `0xC3A3`. Los cuatro restantes, también en `0xC3A3`, ocurren
  después de una pérdida. Son observaciones censuradas; tres vidas antes del
  HALT no prueban que la rama sea viable ni que Arthur siga vivo.
- `survivalFrames` mide hasta el decremento de vidas, que puede llegar después
  de la colisión mortal. `positionResets` detecta caídas de posición mayores
  que 256; no demuestra por sí solo muerte ni cambio de nivel. No comparar
  supervivencias brutas con distintos `startFrame`.

## Pregunta y matriz de investigación

Determinar qué información o cambio táctico falta antes de volver a muestrear
muchas cintas. Priorizar **percepción y explicación del fracaso**, sin imponer
FSM, planner, aprendizaje u otra arquitectura compleja antes de justificarla.

| Estrategia | Hipótesis que debe comprobarse | Prueba propuesta | GO / STOP |
| --- | --- | --- | --- |
| Separar avance, supervivencia y atasco | Una política puede conservar vidas quedándose quieta; un pico puede pertenecer a una muerte ya iniciada. | Etiquetar imágenes privadas existentes de avance, plateau, daño, muerte antes del decremento y respawn; alinear frames y métricas. Proponer estado desconocido cuando falte evidencia. | GO: criterio auditable que distingue esos casos. STOP: usar solo máximo x, tiempo o byte de fase como victoria. |
| Ataque y salto con fase temporal | Cambiar cadencia o desfase puede alterar la exposición a una amenaza; repetir macros sin observar no explica el fallo. | Analizar entradas y frames alrededor del encuentro. Contrastar las cadencias ya probadas y formular pocas combinaciones nuevas con motivo visual concreto. | GO: cada variante tiene disparador, duración, resultado esperado y condición de aborto. STOP: otra rejilla amplia sin hipótesis o percepción fiable. |
| Replanificar ante amenaza, obstáculo o agua | Mantener derecha/salto puede seguir una acción peligrosa después de cambiar la escena. | Especificar señales visuales mínimas y confianza para frenar, atacar, saltar, retirarse o cambiar aproximación. Usar capturas existentes; identificar qué falta sin inventar detectores precisos. | GO: decisiones comprobables sobre ejemplos y límites de observación. STOP: depender de RAM live, geometría no validada o modificar engine. |
| Cambiar táctica al estancarse | La diversidad útil cambia aproximación y temporización, en lugar de reiniciar el mismo fracaso. | Definir ventana de falta de avance, un máximo de cambios y una alternativa concreta; registrar identidad de política y ruta observada. | GO: escape acotado que conserva la separación por vida. STOP: premiar respawn, score o retroceso repetido como avance. |
| Rollback de política y comparación pareada | Una variante peor debe descartarse sin arrastrar sus parámetros a la siguiente evaluación. | Versionar parámetros y volver a la política anterior entre episodios desde reset. Fijar perfiles train/holdout, mismo horizonte y política de créditos. | GO: comparación reproducible y presupuesto explícito. STOP: restaurar estado del juego, mezclar horizontes o ajustar usando el holdout. |

El rollback se refiere **solo a código o parámetros de política**. Nunca se
restaura una vida ni un estado de juego. La búsqueda de rutas debe partir de
reset y contabilizar cada vida por separado.

## Primer bloque acotado: investigar sin ejecutar partidas

1. Auditar los cuatro informes existentes y seleccionar pocos ejemplos
   representativos: pico 1700 condenado, plateau 1279, muerte/respawn y HALT
   antes del decremento. Inspeccionar solo las imágenes privadas ya disponibles.
2. Escribir hipótesis ordenadas por evidencia, coste y posibilidad de refutación.
   Proponer el detector visual mínimo para distinguir plateau, peligro y muerte;
   marcar como `UNKNOWN` cualquier etiqueta no comprobada.
3. Preparar un protocolo posterior pequeño: baseline y candidata pareados desde
   reset, mismos perfiles, horizonte y cuotas; reservar condiciones holdout sin
   usarlas para ajustar. Indicar cantidad máxima de episodios, tiempo de pared
   y coste estimado en 5h/7d antes de ejecutar. No llamar tasa de éxito a una
   única cinta determinista ni exigir muchas seeds sin demostrar qué varían.
4. Entregar una propuesta revisable en `docs/agents/` con matriz cumplimentada,
   ejemplos referenciados por identificador/frame, riesgos y un único siguiente
   experimento acotado. Referencias y anotaciones privadas bajo `out/bot/`;
   documentos públicos sin ROM, imágenes, cintas ni RAM.

**Aceptación de este bloque investigativo:** hipótesis justificadas, ejemplos
auditables, señales desconocidas explícitas y protocolo limitado por cuota.
El bot permanece STOP al terminar; no declarar mejora de gameplay sin ejecutar
su prueba. Si se implementa después, hacerlo solo en las rutas permitidas y
añadir tests ROM-free de percepción/decisión que cubran el fallo real.

**Gate de una reanudación posterior:** medir progreso espacial nuevo sostenido
por vida junto con estabilidad, daño/muerte y pérdida de vidas. Para afirmar
fase completada, exigir una **transición real observada**, reproducible en el
mismo bundle y contrastada con MAME únicamente como oráculo. Un plateau,
`FRAMES_DONE`, un pico seguido de muerte o `0x0052` no satisfacen ese gate.
Si no hay más progreso dentro del bloque acotado, detener el bot y registrar
STOP; si falta cobertura, conservar la rama como censurada y dependencia
externa. Ningún resultado de fase 1 acredita el juego entero ni las dos vueltas.

## Prompt breve para retomar la investigación

> Repo `krukmat/gng-ghidra`, rama `main`. Pide primero cuota disponible 5h/7d
> según `AGENTS.md` y espera. Lee `docs/agents/gng-bot-antistuck-task.md`, la
> entrada general y el checkpoint del explorador. Bot STOP: objetivo completo
> en el motor del repo, niveles posteriores y dos vueltas. Hay 253 intentos,
> 24 HALT y ningún nivel demostrado; x1700 acaba en muerte, x1279 es plateau.
> Investiga con informes y capturas privadas existentes cómo separar avance,
> atasco y muerte anterior al decremento; prioriza percepción visual y cambios
> tácticos justificados antes de otro muestreo amplio. Entrega hipótesis y un
> siguiente experimento pareado, pequeño y con holdout, sin ejecutar partidas
> ahora. Engine/AOT/render/servidor/bundles congelados; solo bot/, tests/bot/,
> docs/ y out/bot/ privado. Acciones P1, episodios desde reset, sin snapshots,
> clonación ni escrituras de memoria. MAME solo compara, nunca juega. Respeta
> GO/STOP; publica commits solo con autorización y reporta en castellano breve.
