# Evaluación del bot — 27/10/2026

**Base examinada:** `main`, HEAD `5744b97`.
**Dirección actual:** transferencia del prefijo corregida y validada hasta frame 2720; circuito visual offline conectado y embarque candidato conseguido. Falta estabilizar el seguimiento sobre la plataforma y ejecutar la salida a la otra orilla. El motor permanece congelado; el juego completo sigue pendiente.
**Secuencia propuesta:** [P0: sincronización](#p0--reproducción-y-controles) → [P1: circuito visual](#p1--observación-decisión-y-acción-conectadas) → [P2: habilidad jugable](#p2--superar-el-obstáculo-actual) → [P3: juego completo](#p3--escalar-al-juego-completo).

Se mantienen los límites del [plan vigente del bot](gng-bot-gameplay-plan-2026-10-27.md): engine/AOT/renderer/servidor/bundles congelados, decisiones por píxeles, acciones por controles originales y episodios desde reset. El laboratorio solo aporta calibración y evaluación de lectura. La evaluación inicial del HEAD de referencia se conserva abajo; los cambios y pruebas posteriores se distinguen en este estado actualizado.

## Estado del controlador visual conectado

`node bot/run-water.mjs` ejecuta desde reset un prefijo normal hasta 2672 y conecta `visual-episode` → `water-observation` → `water-skill`. La política recibe solo píxeles, frame y sesión. Las coordenadas/vidas RAM se registran exclusivamente para evaluar; no llegan a la decisión. La salida privada incluye tape normal, métricas, trazas y capturas de cambios de fase.

En el último ensayo hasta frame 3100: **máximo x=1776, final x=1719, tres vidas y cero pérdidas**. Supera el pico histórico x=1700; las etiquetas muestran altura de plataforma y transporte horizontal después del salto. Aun así el resultado correcto es **`NOT_CONFIRMED`**: pasa a `BOARDING` en 2849 y termina en `STOP/BOARDING_NOT_CENTERED` en 2870 por pérdida de geometría bajo el personaje. No está certificado el apoyo estable ni el cruce completo. Evidencia: `out/bot/water-skill-2026-10-27T13-25-30-102Z/report.json`, `tape.json` y capturas.

Se corrigieron causas concretas, sin barrido masivo: (1) una pareja de entradas demuestra salto vertical al pulsar derecha+salto simultáneos desde reposo y avance horizontal con cuatro frames de carrera; (2) el detector conserva plataformas cerca de la orilla y fragmentos verdes bajo oclusión; (3) el observador estima apoyo mediante historial y grupos visibles de píxeles de los pies. Las extensiones de plataforma quedan marcadas `extentEstimated`, con evidencia actual; nunca se inventan derrota, vida o estado jugable. La clasificación de apoyo sigue siendo experimental.

**112/112 tests PASS**, sintaxis y whitespace correctos. P0 está verificado para el prefijo live; P1/P2 son parciales. La habilidad nueva solo se ha ejecutado offline sobre g4: falta comprobar su control reactivo live, condiciones reservadas, MAME para la nueva trayectoria y la salida a la otra orilla. El siguiente cambio debe resolver el tracking durante el embarque; aumentar intentos o relajar el criterio de éxito ocultaría ese fallo.

## Corrección comprobada

`bot/live/practice-playback.mjs` envía ahora los eventos tras snapshot F, en lugar de F−1. `bot/practice-water.mjs` comprueba el estado tras enviar el grupo de botones y mide el retraso de despacho respecto a F. Esta medida sigue sin sustituir la lectura CPU de `/tape`.

La pareja causal desde reset mostró que adelantar los inputs un frame reproduce el fallo: pérdida en 2173 y cementerio con dos vidas en 2720; la cinta original conserva tres vidas y llega al agua. Después del cambio, un arranque live hasta 2720 produjo **214/214 cambios de puerto idénticos al offline, con cero ciclos de diferencia y el mismo hash de record+known**. El replay independiente de la tape efectiva dio `PASS_SAME_FRAME_HASH`. Duración live: 48 s. Evidencia privada: `out/bot/sync-audit/{comparison,report,live-tape,expected-changes}.json` y `live-replay.txt`.

Los **91/91 tests** actuales pasan, incluida la regresión que impide enviar un evento un frame antes. Se verificó también sintaxis y ausencia de errores de whitespace. Esto certifica la transferencia del prefijo en la ejecución probada, no el cruce, el handoff con recorder/UI ni robustez ante otras cargas.

## Resultado actual comprobado

En el HEAD examinado inicialmente todavía no había política visual autónoma conectada. La nueva entrega anterior conecta un controlador offline experimental; sigue sin haber una fase completada demostrada.

| Área | Evidencia | Lectura correcta |
| --- | --- | --- |
| Búsqueda offline | 253 candidatos: 229 `FRAMES_DONE`, 24 `UNCOMPILED` | Llegar al horizonte no demuestra progreso ni victoria. |
| Intentos que llegan al horizonte | 227 con pérdida de vidas, 2 sin pérdida | Los dos sin pérdida son retiradas/plateaus; conservar vidas quieto no supera el obstáculo. |
| Mejor pico de primera vida | x=1700, pérdida registrada en 2881, posición final 451 en 3600 | Frente al baseline x=1606/pérdida en 2839: +94 unidades de pico y +42 frames hasta el decremento, sin avance sostenido certificado. |
| HALT | 19 en `0xE79E`, 5 en `0xC3A3` | Son ejecuciones censuradas. Veinte no habían registrado decremento; cuatro sí. Falta diagnosticar cada causa. |
| Última práctica local | Frame objetivo 2720, 214 eventos enviados, `lateMax=0`, `handoff=false` | Termina por escena divergente; no entrega un checkpoint útil. |
| Tests del bot ejecutados en esta revisión | Node v22.23.0, `node --test tests/bot/*.test.mjs`: 112/112 PASS en el estado actual | Verifican contratos y casos sintéticos; no acreditan por sí solos la habilidad nueva. |

Los totales se contrastaron directamente con los cuatro informes privados y con `node bot/diagnose.mjs`. El desglose histórico está en [B2](gng-bot-antistuck-block2.md). No hubo cambios candidatos de fase en esos informes; el byte candidato sigue sin validar como contador de fase.

La práctica más reciente queda documentada en `out/bot/practice-water-2026-10-27T12-36-30-905Z/`. Inspeccioné sus dos PNG: el live muestra cementerio con escalera, marcador 900 y tiempo 1:57; la referencia muestra agua, marcador 2100 y tiempo 1:36. No es una discrepancia visual de un solo frame. El witness obtiene ~70,6% de coincidencia global, pero no detecta orilla ni isla en live. El gate geométrico hace bien en rechazarlo: el fondo compartido vuelve insuficiente esa coincidencia global.

## Por qué se estanca

### 1. La cinta solicitada y los controles efectivos tienen distinta fase

Comparé `out/bot/late-sweep/trial-6.json` con `out/bot/gameplay-2026-10-27T12-36-36-903Z/input-tape-session-1.json`. Reconstruí cambios de bytes por puerto mediante el contrato existente y los emparejé por orden y valor con las lecturas reales de CPU.

`offsetFrames = (ciclo de lectura live − ciclo del evento fuente) / 25152`

- Coin previsto en frame 560: primera lectura activa en 559,0487.
- Start previsto en 640: lectura en 639,0488.
- Derecha prevista en 1200: lectura en 1199,0492.
- Coinciden los valores y el orden de las cuatro transiciones SYSTEM y 207 P1 consecutivas. Sus offsets están entre −0,95130 y −0,95018 frames. La siguiente diferencia P1 corresponde a la liberación del handoff.

`bot/live/practice-playback.mjs:37` dispara en `event.frame - 1`; `bot/practice-water.mjs:247` calcula el lag respecto a ese mismo adelanto, usando además el frame leído antes de los POST. Por eso `lateMax=0` no certifica equivalencia temporal con el plan offline. El runner antiguo también emplea ese adelanto: no se atribuye aquí a una regresión recién introducida.

**Diagnóstico confirmado para el prefijo probado:** la pareja causal reproduce el modo de fallo con el adelanto y la alineación corregida recupera tanto los controles efectivos como el hash exacto de la trayectoria prevista. Quedan fuera de esa prueba las otras cintas y las cargas de recorder/UI.

Hay dos pruebas diferentes: reproducir `/tape` con el mismo hash final demuestra que el motor repite los inputs efectivos; demostrar que esos inputs efectivos equivalen a la cinta prevista exige otra comparación. La certificación histórica de una cinta no se extiende a esta variante.

### 2. Los componentes aún no forman un jugador

`bot/live/pixel-observer.mjs:39–47` devuelve siempre `gameplay: STOP_UNCALIBRATED`, apoyo desconocido y derrota del enemigo desconocida. No produce el contrato de las políticas: vida, escena jugable, pies, apoyo y confidencias.

`createWaterController`, `createBossWaterJourney` y `dispatchVerifiedP1` solo se utilizan desde tests dentro del código examinado. No hay un runner que conecte observación, decisión y ejecución. `boss-water-journey.mjs:41–42` delega a `EXISTING_BOSS_COMBAT`, pero no implementa ni invoca tal combate.

El siguiente avance debe ser una entrega vertical que juegue un tramo. Más módulos aislados y más tests sintéticos no resuelven esa conexión.

### 3. La búsqueda favorece soluciones que se quedan quietas

`bot/evaluation.mjs:78–80` prioriza vidas perdidas antes que posición. Esto protege frente a picos condenados, pero también hace ganar a un plateau sin muertes frente a una variante que explora más y muere. Además, `finalWorld` puede proceder de una vida posterior; no es necesariamente el resultado de la primera vida cuyo máximo se registra.

`bot/search.mjs` busca macros temporales sobre una cinta fuente, con RNG fijo. No reacciona a enemigos o terreno, ni separa condiciones de ajuste y comprobación. `plans.slice(0,limit)` también puede consumir el cupo en los primeros cortes generados. Es una herramienta para descubrir maniobras; no equivale a una política que aprende a jugar.

### 4. La percepción todavía depende del ejemplo local

El detector de Arthur busca su aspecto sin armadura y el observer lo limita a X=96..165. El terreno usa colores y filas concretas de fase 1. Falta medir continuidad y errores con armadura, salto, daño, muerte, oclusiones y cambios de escena.

El gate de derrota exige una animación que ningún detector actual produce. Tampoco está demostrado que derrotar a ese enemigo sea condición necesaria para cruzar. Conviene decidir con evidencia de amenaza y geometría; imponer una derrota no observada como requisito universal puede bloquear una ruta viable. No se propone fingir esa derrota.

La política del agua proyecta velocidad constante y duración de vuelo fija. Ambos parámetros necesitan calibración en píxeles, margen de error y comprobación de aterrizaje. Un frame incierto provoca STOP persistente: hacen falta recuperación acotada del seguimiento y límites temporales, manteniendo STOP definitivo para fallos de sesión o motor.

### 5. Hay problemas de control que conviene resolver al integrar

- Los controles simultáneos se envían mediante POST secuenciales; la atomicidad del contrato offline no se puede asumir en live. Hay que comprobar combinaciones realmente leídas por CPU.
- `safe-dispatch.mjs` valida sesión, pero no la antigüedad de la observación. Rechazar una decisión tampoco libera necesariamente botones mantenidos por una decisión anterior. Añadir vencimiento de macros y una salida que ejecute la liberación.
- La verificación del handoff exporta dos PNG con ffmpeg y solicita la tape antes de congelar el proceso. El motor puede avanzar entre la imagen verificada y SIGSTOP. Si se conserva la práctica manual, posponer exportaciones y verificar el estado realmente congelado.

Estos ajustes deben tener un alcance acotado. La mayoría de los últimos 30 commits se concentra en grabación/demo/handoff/pausa/evidencias/tests. Son herramientas útiles; el siguiente bloque debe medirse por una nueva capacidad de juego.

## Próximas entregas propuestas

### P0 — Reproducción y controles

**PASS para la ejecución hasta 2720 descrita arriba.** Se compararon fuente, tape efectiva y hash del prefijo con los lectores existentes, sin añadir APIs al engine. Para otras cintas/cargas, repetir este contraste; separar adelanto, retraso, cambio de orden y combinación intermedia.

**Criterio:** identificar la primera divergencia, demostrar qué corrige el ancla temporal y obtener un prefijo live reproducible antes del obstáculo. Si HTTP no permite transferir una cinta con suficiente precisión, declararlo y usar corrección visual; no prometer igualdad de ciclos que la interfaz no garantiza.

### P1 — Observación, decisión y acción conectadas

**PARTIAL:** circuito offline implementado en los cuatro componentes citados arriba; faltan calibración reservada y ejecución reactiva live.

Crear un contrato común de observación y un único runner. Empezar en modo sombra: registra la decisión sin actuar, sus datos faltantes y la edad de la imagen. Calibrar un corpus privado pequeño con Arthur armado/desarmado, apoyo/vuelo, escena jugable, muerte/respawn y terreno. Mantener datos reservados para comprobar sin ajustar sobre ellos.

**Criterio:** los campos consumidos por la habilidad tienen productores medidos, la secuencia real puede recorrer sus estados y las pérdidas breves de seguimiento se recuperan sin dejar botones indefinidamente pulsados. Registrar por qué se bloquea cada decisión.

### P2 — Superar el obstáculo actual

**PARTIAL:** alcanza la plataforma y supera el pico anterior sin perder vidas en el ensayo actual; reconocimiento estable, salida y robustez siguen pendientes.

Implementar UNA habilidad: aproximación segura, espera de plataforma, salto, aterrizaje confirmado y salida a tierra. Resolver la amenaza cercana mediante combate o evitación según evidencia. Activarla por geometría y estado observados, no por llegar al frame 2720.

**Calibración real disponible:** una pasada adicional de lectura analizó 401 frames (2400–2800). El detector de piel encontró al personaje en todos hasta 2757; después lo pierde durante la caída. Cinco saltos ordinarios observados tardan 34 frames desde la primera elevación hasta el retorno (35 desde el frame previo) y recorren 37–38 px; la velocidad media de aproximación medida tanto por etiquetas offline como por píxeles relativos a la orilla es 1,08475 px/frame. No sustituir estos datos por los valores sintéticos de los tests ni trasladar RAM a decisiones live.

Para el primer experimento elegiría el prefijo hasta 2672: tres vidas, altura de suelo candidata y 32 px entre el extremo del cuerpo y la orilla. Desde allí aproximarse con observación y parar antes del borde, esperar una intercepción alcanzable y saltar. En 2710 quedan solo 2 px entre centro detectado y borde; en 2712 el centro ya lo supera. Ninguna de esas etiquetas acredita por sí sola apoyo ni derrota del enemigo. Evidencia privada: `out/bot/water-calibration/{frames,summary}.json`.

Si se dispone de un jugador que supere el tramo, aprovechar una demostración grabada para medir saltos y extraer acciones. Después recoger correcciones en las situaciones donde falle el bot. La propuesta se inspira en la agregación de ejemplos de DAgger; todavía no supone que ese algoritmo vaya a mejorar este repo ni requiere entrenar una red. [Fuente primaria: Ross, Gordon y Bagnell, 2011](https://proceedings.mlr.press/v15/ross11a.html).

**Prueba posterior acotada:** como máximo cuatro pares baseline/candidata desde reset, mismo bundle, horizonte y política de vidas/créditos. Variaciones explícitas de aproximación o timing; un par reservado, sin ajuste sobre él. No contar repeticiones deterministas como seeds independientes. Antes de ejecutarla, estimar coste según cuota y tiempo medido por episodio.

**Criterio:** cruzar y confirmar ambos apoyos, continuar hacia una zona nueva durante una ventana posterior predefinida, sin muerte durante la maniobra. Informar resultados de los cuatro pares, incluidos HALT y pérdidas. Una prueba tan pequeña selecciona el próximo paso; no certifica una tasa de éxito general.

Cambiar la evaluación a hitos nuevos sostenidos por vida, éxito de la habilidad, tiempo sin progreso y daño/muertes. Comparar progreso y coste conjuntamente; no poner quietud por delante de cualquier exploración. Separar resultados de vida, partida y episodio. Un HALT es censura técnica, no muerte ni éxito.

### P3 — Escalar al juego completo

Construir un supervisor que elija habilidades reutilizables: avanzar, atacar, esquivar, saltar, esperar plataforma, subir/bajar y recuperar seguimiento. Añadir reconocimiento de pantallas, transiciones, vidas y final. Identificar fase/vuelta mediante señales validadas, no con el byte candidato actual.

Certificar segmentos, luego fase 1 desde reset, fases posteriores y finalmente la partida continua y las dos vueltas que fija el objetivo del repo. Incluir recuperación tras daño y respawn: una ruta perfecta memorizada no cubre esas situaciones.

La capacidad del bot y la cobertura del motor necesitan seguimiento separado. Las fases posteriores no tienen ejecución real validada y ya hay 24 HALT en las variantes actuales. Ante un destino sin cubrir, conservar tape y diagnóstico para el workstream de engine; el bot no debe intentar arreglarlo ni ocultarlo. Con el engine congelado se puede avanzar en habilidad, pero todavía no se puede garantizar que permita terminar todo el juego.

La optimización de parámetros o el aprendizaje se justifican después de tener observación y evaluación estables. No recomiendo iniciar ahora PPO/DQN, un planner grande ni otro barrido masivo: los bloqueos comprobados anteriores impedirían interpretar sus resultados.

## Alcance y límites de esta evaluación

Se revisaron código, historial reciente, informes privados y capturas auténticas; tres auditorías contrastaron políticas, evidencia e integración. Se ejecutaron diagnóstico, comparaciones causales, arranque live corregido y replay, calibración visual, cinco intentos tácticos dirigidos y los 112 tests ROM-free. La tape del último intento reproduce exactamente hash y métricas mediante el evaluador independiente. Se modificaron únicamente componentes del bot, tests y este informe; engine, ROM, bundles y notas persistentes permanecen intactos. El directorio anidado `gng-ghidra/`, ya sin seguimiento al empezar, quedó fuera de la revisión.

El prefijo probado ya es reproducible y existe avance espacial nuevo en el ensayo del controlador visual. El siguiente resultado útil es confirmar el embarque, salir a la orilla final y mantener el avance; ninguna fase ni partida completa están certificadas.
