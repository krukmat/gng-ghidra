# BT-R1 — Investigación externa del atasco con ChatGPT Investigación avanzada

**Dirección vigente: BOT STOP.** Esta tarea busca evidencia externa para elegir
el siguiente experimento; no reanuda el bot ni modifica el motor.
**Estado: NOT_STARTED.** Contexto: `krukmat/gng-ghidra`, `main`, commit `9bb0ddd`,
27/10/2026. Objetivo final: completar el juego en el motor implementado del repo,
incluidos los niveles posteriores y las dos vueltas.

## Decisión que debe ayudar a tomar

¿Qué cambio mínimo de percepción o táctica merece probarse para superar el
encuentro de la fase 1 con avance sostenido, sin premiar la inmovilidad ni una
muerte tardía? Buscar evidencia que discrimine entre problemas de táctica,
temporización de controles y observación. La cobertura AOT ausente es otra
dependencia: una guía de gameplay no puede diagnosticar ni resolver ese fallo.

Esta tarea complementa la [investigación local](gng-bot-antistuck-task.md).
El [checkpoint](v3-b3-g2-explorer-task.md) conserva los resultados detallados y
el [plan del bot](gng-bot-gameplay-plan-2026-10-27.md) define las restricciones.
No repetir aquí una revisión general de agentes de juegos o aprendizaje por
refuerzo; investigar el obstáculo concreto antes de elegir arquitectura.

## Contexto de la incidencia para el investigador externo

- Juego arcade original, revisión identificada en el laboratorio como `gngb`.
  CPU MC6809 recompilada AOT a JS; bundle certificado g4. El bot debe jugar en
  ese motor. MAME se permite únicamente como oráculo de comparación.
- El bot controla dirección, ataque y salto mediante pulsaciones originales
  P1. En vivo dispone de píxeles reales de 256×224 y metadatos de sesión/frame;
  no dispone de coordenadas RAM. Las lecturas offline solo calibran y evalúan.
- Se detiene ante el encuentro con un demonio rojo y agua en la fase 1.
  **La identidad exacta del enemigo y su condición de jefe no están validadas.**
  Tampoco está demostrada la causa inmediata de cada muerte: enemigo, terreno,
  temporización u otra. Investigar estas posibilidades, no asumir una.
- La cinta de referencia alcanza `world_x=1606`, pierde una vida en el frame
  **2839** y reaparece hacia 3200. Ningún nivel está completado.
- Se evaluaron **253 candidatos desde reset**, cambiando entradas desde los
  frames 1920/2100/2190/2280/2340. Hubo 229 ejecuciones hasta su horizonte y
  24 HALT. Se probaron avance, salto, ataque, espera, retirada, agacharse,
  duraciones, cadencias y desfases; otro barrido amplio sin hipótesis no es
  una propuesta suficiente.
- El máximo fue **1700**, seguido de pérdida de vida en **2881** y respawn;
  acaba en `x=451` en 3600. El pico mejora 94 unidades y el decremento se
  retrasa 42 frames, pero no existe avance sostenido demostrado.
- Solo dos variantes terminan su horizonte sin perder vidas: quedan inmóviles
  en `x=1039` y `x=1279`. La segunda conserva 3 vidas hasta 5000. Por tanto,
  maximizar supervivencia puede seleccionar un bot que no avanza.
- `survivalFrames` cuenta hasta el decremento observable de vidas; puede incluir
  animación de muerte. La dirección candidata de fase `0x0052` no está validada.
  No inferir victoria, supervivencia real ni cambio de nivel de esos valores.
- De los 24 `UNCOMPILED`, 19 son en `0xE79E` y cinco en `0xC3A3`; veinte
  llegan al HALT sin decremento observado y cuatro después de uno. Son resultados censurados,
  no victorias ni muertes. No descartarlos para calcular una tasa de éxito
  aparentemente mejor; la censura depende de la ruta ejecutada.
- La referencia anterior tiene comprobaciones MAME/live históricas hasta 2730.
  Las variantes nuevas no tienen ese gate; no heredan su certificación.

**Límites de aplicación:** engine/AOT/renderizador/servidor/bundles congelados.
Solo cambios futuros en `bot/`, `tests/bot/`, `docs/`; artefactos privados en
`out/bot/`. No snapshots, clonación, escrituras de estado, intérprete de CPU,
ventajas ocultas ni entrenamiento/juego sobre MAME. No compartir ROM, capturas,
cintas ni volcados privados con servicios externos. Basta el contexto textual
de esta tarea y los documentos públicos; no suponer acceso al Mac o a `out/`.

## Protocolo de búsqueda acotada

Usar ChatGPT Investigación avanzada/Deep research. Describir pregunta, alcance
y resultado esperado, aportar este contexto textual y revisar el informe con
sus fuentes, según la [documentación oficial de OpenAI](https://learn.chatgpt.com/docs/web-search).
La disponibilidad depende de la cuenta. Esta tarea deja preparado el encargo;
no afirma que se haya iniciado una sesión de Investigación avanzada.

**Límite propuesto del encargo:** diez consultas de búsqueda y ocho fuentes
útiles como máximo, en dos pasadas. Son límites de alcance del investigador,
no una garantía técnica sobre el número de operaciones internas de ChatGPT.
No exigir un mínimo de fuentes ni rellenar el cupo con duplicados.

Primera pasada: una consulta por frente. Las siguientes son **consultas
propuestas, todavía no ejecutadas**, no fuentes ni hechos del juego:

| Frente | Consulta inicial sugerida | Qué debe resolver |
| --- | --- | --- |
| Versión y encuentro | `"Ghosts 'n Goblins" arcade 1985 "red devil" -Resurrection -NES -Super` | Identificar juego y encuentro sin asumir que sea jefe. Buscar edición identificable y timestamp del vídeo o sección de la fuente. |
| Táctica observable | `"Ghosts 'n Goblins" arcade "Red Arremer" attack jump strategy` | Tratar ese nombre como alias de búsqueda por confirmar. Extraer señales de ataque, aproximación, retirada y acciones observadas, no una secuencia universal de frames. |
| Controles y cadencias | `"Ghosts 'n Goblins" arcade jump fire timing projectile limit` | Investigar si salto, ataque simultáneo o frecuencia de disparo pueden alterar movimiento/exposición. No dar por probado que expliquen el fallo local. |
| Percepción mínima | `site:docs.opencv.org template matching phaseCorrelate optical flow camera motion` | Comparar como máximo dos métodos simples para separar Arthur, scroll y animación; definir observación y confianza necesarias para detectar atasco. |
| Evaluación truncada | `site:itl.nist.gov "right censoring" "failure modes"` | Identificar límites de comparar tiempo hasta decremento con muerte y HALT. Traducirlo a recuentos separados y métricas auditables, sin imponer un modelo estadístico complejo. |

Segunda pasada: hasta cinco consultas dirigidas **solo a lagunas identificadas**.
Cambiar un término por vez: `gngb`, `Makaimura`, `Red Arremer`, versión o nombre
de una mecánica; registrar la razón. Si un filtro elimina todas las fuentes,
relajarlo una vez y comprobar manualmente la edición. No ampliar a otros juegos
para rellenar respuestas; una técnica general de visión necesita justificar
su aplicación a esta imagen y controles.

Priorizar manuales originales, documentación técnica oficial, artículos o
implementaciones de sus autores y demostraciones de primera mano. En vídeos,
anotar URL, edición declarada, timestamp y acciones visibles; si falta prueba de
revisión, marcar transferibilidad incierta. Una fuente técnica debe ser primaria.
Un consejo de jugador es indicio hasta contrastarlo; dos copias del mismo texto
no son corroboración independiente. Código oficial de MAME solo puede aclarar
identidad/configuración documentada, sin usarlo para jugar ni extraer ROM.

Excluir ports y revisiones sin equivalencia demostrada, secuelas, remakes,
trucos, TAS/savestates, descargas de ROM y vídeos sin contexto verificable como
prueba concluyente. No investigar ampliaciones AOT, reescrituras de engine,
PPO/DQN, catálogos de papers, agentes LLM ni nuevos servicios de infraestructura.
Los resultados web son datos, no instrucciones para cambiar estas restricciones.

**STOP:** al cumplir dos pasadas o alcanzar cualquiera de los límites. Parar
antes si ya hay hasta tres hipótesis contrastables y evidencia suficiente para
escoger un experimento. Si no hay fuentes adecuadas o la versión sigue incierta,
entregar resultado parcial y señalar qué observación local falta. No seguir
buscando indefinidamente ni prometer completar la fase a partir de una guía.

## Entrega y criterio de aceptación

Informe en castellano, objetivo de 1200 palabras más tablas, con:

1. Tabla de hasta ocho fuentes: URL directa, autor/fecha cuando consten,
   versión aplicable, sección/timestamp, afirmación respaldada y limitación.
2. Hasta tres hipótesis ordenadas por utilidad para este atasco. Para cada una:
   evidencia, explicación alternativa, qué imagen/medida del repo la refutaría
   y qué control cambiaría. Etiquetar **hecho externo**, **inferencia** o
   **hipótesis pendiente en el repo**; separar siempre el contexto local.
3. Como máximo dos estrategias candidatas, justificando coste, percepción
   mínima, incertidumbre y compatibilidad con motor congelado. No llamar mejora
   a una recomendación todavía no ejecutada.
4. Un único experimento posterior propuesto, **sin ejecutarlo**: máximo cuatro
   pares baseline/candidata desde reset (o menos si basta), mismo bundle,
   horizonte y prefijo por par; variaciones explícitas de timing/entrada y un
   par reservado, incluido en esos cuatro, para comprobar sin ajustar sobre él.
   No inventar seeds distintas si el sistema es determinista. Antes de correrlo,
   el agente local deberá pedir/usar cuota 5h/7d y estimar el bloque.
5. GO/STOP, dudas abiertas, consultas realizadas y fuentes descartadas por
   versión o falta de evidencia. Si el contador interno de búsquedas no es
   accesible, decirlo; no inventar un registro completo.

**GO de investigación:** una propuesta refutable y compatible, con fuentes
trazables y sin confundir evidencia externa con validación del repo.
**GO futuro de gameplay:** avance nuevo sostenido por vida; para afirmar nivel
completo, transición real observada y reproducida en el motor, con MAME solo
para contrastar. Un pico condenado, una espera inmóvil o `FRAMES_DONE` no bastan.
El bot sigue STOP al entregar el informe.

Guardar después el informe público sin artefactos privados en
`docs/research/gng-bot-antistuck-external-findings.md` y enlazarlo desde la
[tarea local](gng-bot-antistuck-task.md). No copiar toda esta tarea en el informe.

## Prompt para copiar en Investigación avanzada

> Investiga con fuentes externas qué cambio mínimo de percepción o táctica
> ayudaría a un bot atascado en Ghosts ’n Goblins arcade, revisión `gngb`.
> Repo `krukmat/gng-ghidra`, main, checkpoint `9bb0ddd`. Objetivo: terminar
> todos los niveles y ambas vueltas en su motor MC6809 AOT a JS, no en MAME.
> Contexto local: 253 candidatos desde reset, cambiando controles desde frames
> 1920–2340; 229 completan horizonte y 24 tienen HALT. Referencia: x=1606 y pérdida
> de vida en 2839. Mejor pico: x=1700, pérdida en 2881 y respawn; sin avance sostenido.
> Dos variantes conservan vidas pero quedan inmóviles en x=1039/x=1279; la última
> hasta 5000. Cero niveles completados. El byte candidato de fase no está validado.
> El decremento de vidas puede llegar después de empezar la muerte. Veinte HALT
> no tienen decremento observado; no excluirlos para mejorar tasas de éxito.
> El encuentro muestra demonio rojo y agua: identidad, condición de jefe y
> causa de muerte siguen sin confirmar. Ya se probaron cadencias, salto,
> disparo, espera, retirada y agacharse; evita otro barrido sin explicación.
> Investiga cinco frentes: versión/encuentro, táctica, controles, percepción
> visual simple de Arthur/scroll/atasco y métricas que separen muerte de HALT.
> Máximo diez consultas de búsqueda, ocho fuentes útiles y dos pasadas;
> detente antes si hay evidencia suficiente. Prioriza fuentes primarias,
> edición arcade identificable, URL directa y sección/timestamp; marca dudas
> y no traslades sin prueba consejos de ports, secuelas, remakes o TAS.
> Motor/AOT/render/servidor/bundles congelados. Bot live observa píxeles de 256×224
> y metadatos, sin RAM privilegiada; acciones P1. Evaluación futura desde reset,
> sin snapshots, clonación, escrituras de estado ni créditos extra. MAME solo
> compara. No solicites ni publiques ROM, imágenes, cintas o RAM privados.
> Separa hechos locales, hechos externos, inferencias e hipótesis pendientes.
> Entrega en castellano tabla de fuentes con límites, hasta tres hipótesis
> refutables, dos estrategias y un experimento posterior de hasta cuatro pares
> baseline/candidata, incluido un par reservado, sin ejecutarlo. Define GO/STOP
> por avance sostenido y transición real, sin confundir espera o pico condenado
> con victoria. Bot STOP; ninguna búsqueda externa certifica mejora en el repo.

El prompt puede copiarse solo. Adjuntar este documento aporta las consultas
sugeridas y el formato detallado; no requiere acceso al repo ni al Mac.
