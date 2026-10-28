# Plan de contenido — de H3 a H4 (fases, jefes, dos vueltas y final)

**Fecha:** 2026-10-27 · **Rama:** `main` · **Estado:** pasos 1–2 GO; paso 5 GO (g6); verificación de jefes por búsqueda diferida (§8); barrido de cobertura de jefes: 0 % UNCOMPILED en lo alcanzado, sin g7. En fase 2 el avance real se detiene en la columna de X≈5450; X=5464 solo se alcanza lanzado por un impacto fatal (causa demostrada en H3-F2). No hay señal de jefe ni de puerta funcional. Paso 3 (grabación del operador) pasa a opcional: una sonda TAS desde reset certifica igual (§1, decisión 28/10/2026).

**Siguiente acción:** H3-S2 de la [tarea H3-S1](agents/h3-tas-probe-s1-task.md): localizar la vida del cíclope comparando la RAM antes y después de cada golpe (GO: `0x72` pasa de 0 a 1). La corrección de la poda de `h3_boss_search.mjs` pasa a §8: la sustituye el corte en el impacto del explorador.

> **H3-S1 GO (28/10/2026).** [h3_explore.mjs](../scripts/h3_explore.mjs) (Go-Explore, g6, semilla 1) llega a la arena del cíclope desde reset, sin pokes ni escrituras de estado y sin perder vidas: frame 5348, fase 0, checkpoint 1, X=3458, scroll=3072, 3 vidas, sin armadura. Métricas: 10.848 ramas, 3.218 celdas, 2.325 cortes, 1.182.308 frames, 64,4 s de reloj (~18.000 fps); X máxima 3458, scroll máximo 3072. Validación: etiquetas RAM correctas sobre `explorer-g4-2730-1606.json`; misma semilla → mismas celdas (`b2e505b4…`) y misma cinta (`f5cbb0c7…`); replay independiente desde reset, sin restore, dos veces: MATCH de hash de RAM (`8ad5a998…`) y señal, sin frame fatal. Cinta privada en `out/h3/explore/tape-s1-5348-arena.json`. Falta la paridad MAME (S3).

> **Avance 27/10/2026.** Herramienta: [h3_tape.mjs](../scripts/h3_tape.mjs) + [h3_tape_recorder.lua](../scripts/h3_tape_recorder.lua) + [h3_tape_convert.mjs](../src/h3_tape_convert.mjs).
> **Paso 1 GO:** `titleCoinStart` inyectada y convertida → 4/4 eventos idénticos; 2.012 lecturas reales de CPU iguales a lo anotado.
> **Paso 2 GO:** guardar en 1300, camino descartado, cargar en 1400 → la cinta solo contiene el camino final; replay desde reset con hash de RAM idéntico en todos los frames; oráculo MAME vs AOT g4 `PASS_ALL_FRAMES_MATCH` en 1300–1500. MAME no restaura las entradas al cargar: el registrador entrega a la CPU lo anotado en el resto del frame guardado (verificado por la ida y vuelta).
> Las ejecuciones automáticas de MAME corren sin ventana, foco ni teclado del operador.
**Marco:** [G0–G7 / H0–H6](plan-100pct-jugable-2026-10-26.md) · **Bot:** [BT-0→BT-6](agents/gng-bot-gameplay-plan-2026-10-27.md) · **Entrada:** [ENTRYPOINT](agents/gng-100-playable-entrypoint.md).
**Objetivo:** desde reset, con controles originales y sin `UNCOMPILED`, recorrer todas las fases y jefes de las dos vueltas y llegar al final verdadero, con paridad MAME en puntos de control (G3/G4 → H3/H4).

## 0. Punto de partida

- Bundle vigente g4 (`B3_GENERATION=4`), idéntico byte a byte a MAME 0.288 `gngb` en 9 cintas.
- Contenido verificado: fase 1 de la primera vuelta, del cementerio a x≈1905 pasado el agua. Ahí g4 se detiene: `UNCOMPILED` en pc `0xAFFC`, frame 3132 ([Resultado M2](agents/gng-bot-gameplay-plan-2026-10-27.md#resultado-m2-2026-10-27)).
- El descubrimiento AOT depende de cintas ([v3_b3_discover.mjs](../scripts/v3_b3_discover.mjs)): en una sola pasada compila todo lo que una cinta ejecuta, y nada más. Hasta hoy las cintas que llegan más lejos salen del bot, que avanza obstáculo a obstáculo.
- No hay detector de fase validado (el byte candidato no se ha contrastado) ni mapa verificado de fases y jefes del set `gngb`.

## 1. Decisiones (27/10/2026)

| Tema | Decisión | Consecuencia |
|---|---|---|
| Ejecución | **Operador:** secuencial, sin paralelizar | Un paso a la vez y un solo agente (§6) |
| Fuente de cintas | **Operador:** se aceptan grabaciones de MAME, propias y `.inp` de terceros | Las cintas humanas, no el bot, abren el código de cada fase |
| Descubrimiento desde estados de MAME | No crítico; contingencia (§7) | Toda compilación nace de cintas desde reset |
| Bot | **Operador (27/10, revisado):** sin gate del bot; el contenido se completa sin su verificación | El bot sale de la ruta crítica (§5) |
| Compilación del contenido | **Operador:** crear todo ya, sin esperar cintas ni bot | La cobertura estática (paso 5) pasa de diferida a activa; las cintas humanas certifican después |
| Sonda TAS | **Operador (28/10/2026):** una sonda TAS certifica igual que una cinta humana | Requisitos: cinta generada offline desde reset; solo entradas de puerto, sin pokes ni escrituras de estado; doble replay idéntico; paridad MAME en la entrada de fase, el jefe y la transición. La cinta humana pasa a opcional |

## 2. Estructura

```
Pasos 1–2 (GO) → Paso 5: cobertura estática → Paso 3: sonda TAS o cinta humana → Paso 4 → F-1 … F-6 → F-L2 → C6

F-N:  MOTOR (sonda TAS o cinta humana → residuo dinámico + certificación) → REGLAS → CIERRE
```

- Cada paso empieza solo con GO del anterior. Ante STOP la secuencia se detiene, se informa del bloqueo y se replanifica antes de seguir gastando.
- El operador puede grabar por delante (no consume tokens); la certificación es estrictamente secuencial.

## 3. Pasos previos (una vez, en orden)

**Paso 1 — Validar el registrador Lua**
- Registrador en MAME `gngb` que anota por frame los campos de entrada que ya usa [v3_b3_oracle.lua](../scripts/v3_b3_oracle.lua) y un hash de RAM. Conversor a eventos `gng.v3.b3.playable.v1` con la calibración inversa del oráculo (shift −1).
- Reproducir `titleCoinStart` en MAME con el registrador y convertir.
- **GO:** eventos idénticos a los originales. **STOP:** cualquier diferencia; no se construye nada más sobre este pipeline.

**Paso 2 — Grabación con rebobinado e ida y vuelta**
- Teclas para guardar y cargar estado; al cargar, el registro de inputs y hashes se trunca al frame del estado. El resultado es una cinta desde reset; los estados solo sirven para grabar.
- Ida y vuelta fail-closed sobre una grabación corta con al menos un rebobinado: reproducir la cinta desde reset en MAME debe dar los mismos hashes; después, en AOT.
- **GO:** ida y vuelta exacta con rebobinado. **STOP:** cualquier desincronización.

**Paso 3 — El operador graba la fase 1**
- Desde reset hasta entrar en la fase 2, con una muerte con respawn hecha a propósito y no rebobinada. Un game over con continue, una vez, en esta u otra cinta corta.
- Puede seguir grabando más fases.
- Ida y vuelta del paso 2 sobre la grabación completa.
- **Privacidad:** las cintas propias son solo inputs y pueden versionarse como las actuales; los hashes de RAM quedan en `out/`.
- **GO:** cinta convertida y verificada.

**Paso 4 — Detectores**
- Variable de fase validada contra MAME en las transiciones de la cinta (intro → fase 1, fase 1 → 2), con captura del cambio de escena; ídem muerte, respawn y game over.
- Solo evalúan; nunca alimentan decisiones del bot. El mapa de fases y jefes se completa en cada F-N, no por adelantado.
- **GO:** detector correcto en ambas transiciones. **STOP:** el valor no distingue fases o cambia en otros contextos.

**Paso 5 — Cobertura estática del ROM completo (activo; no necesita cintas)**
- **5.0** Validación barata primero: comprobar si el recorrido estático habría encontrado los PCs que ya provocaron HALT (`bank 3:0x519D`, `0xEC83`, `0xAFFC`, `0xE79E`, `0xC3A3`). Si no encuentra la mayoría (saltos calculados), se replanifica antes de seguir.
  - **Resultado (27/10/2026): GO.** El flujo directo puro solo encuentra 1 de 5. [scripts/h3_static_cover.mjs](../scripts/h3_static_cover.mjs) añade dos patrones: los inmediatos `LDX/LDY/LDU/LDD #` de los bloques alcanzados como semillas (continuaciones tipo `LDY #$607D; JMP $54FF`) y hasta 64 punteros consecutivos en la dirección del inmediato (tablas `LDU #tabla; JMP [B,U]`). Si la tabla está en la ventana de banco y se lee desde código fijo, se prueba en los 5 bancos. Con eso encuentra **5/5** y cubre 4786 de las 4805 funciones de g4 (faltan 3 fijas; el resto son overlays de RAM). Coste: unos 9965 bloques, el doble que g4, por la sobreaproximación.
- **5.1** Medir: código alcanzable estáticamente por banco (vectores reset/IRQ, semillas de g4, las 241 tablas de [v3_b3_jump_tables.mjs](../src/v3_b3_jump_tables.mjs), código copiado a RAM) frente a bloques compilados. Da el dato real de código traducido.
- **5.2** Compilar todo lo alcanzable en una generación nueva; listar cada salto indirecto no resuelto con su ubicación.
- **5.3** Certificar con las reglas habituales (cintas previas idénticas, doble replay, sin fallback).
  - **Resultado 5.1–5.3 (27/10/2026): GO, g5 certificada.**
    - **Cierre estático:** 9965 bloques (6502 fijos; por banco 393/511/711/1136/712). Hay 473 salidas indirectas; quedan cubiertas por las tablas y por el modo multientrada.
    - **Bundle:** g5 tiene 10028 funciones y 37977 entradas. `program.mjs` ocupa 27 MB (g4: 6,6 MB).
    - **Certificación:** B2-D sin cambios, las 9 cintas B3 con doble replay idénticas a g4 y MAME `sustainB` coincide en los frames 2000/12000/23990.
    - **Runtime:** g5 empaqueta el runtime certificado de B2-D. El tap de audio de `src/gngb_runtime.mjs` necesita su propia certificación.
    - **Siguiente:** atajo de laboratorio para empezar en la fase N (escritura en la RAM igual en MAME y AOT) y avanzar F-2…F-6 sin cinta humana.
  - **Atajo de fase (27/10/2026): GO.**
    - **Variable:** la fase es el byte `0x0072` (empieza en 0; 6 = sala de Astaroth). `0x0052` queda descartado: es una copia de un DIP, vale 1 desde el arranque.
    - **Cómo se encontró:** barrido de 723 bytes, sumando 1 durante la muerte (frames 1830–2700 de `titleCoinStart`) y midiendo el cambio en la VRAM de fondo.
    - **Herramienta:** [src/h3_lab_poke.mjs](../src/h3_lab_poke.mjs) con `H3_POKE=from:to:addr:value`. Es solo de laboratorio y se aplica igual en el oráculo MAME y en el AOT (`v3_b3_oracle`, `v3_b3_witness`).
    - **Hueco encontrado:** la fase 3 paraba en `UNCOMPILED 0xDFC7`. Venía de una tabla del banco 4 que empieza con un puntero nulo; ahora el cierre salta los nulos y cubre el 100 % de las funciones de ROM de g5.
    - **g6:** 10089 funciones y 38084 entradas, certificada; las 9 cintas son idénticas a g5.
    - **Paridad MAME:** valores 1–6 (fases 2–7), 4 frames cada uno (2600/3300/4500/5900): 24/24 MATCH, sin bytes omitidos.
    - **Límite:** prueba que cada fase carga y corre igual que MAME con Arthur casi inmóvil. No prueba jefes, vuelta 2 ni el final verdadero.
  - **Corrección de la vuelta (27/10/2026):** el arranque de `titleCoinStart` ya tiene `0x0071=1` (MAME y AOT); tras el atajo a fase 7 pasa a `2`. Por tanto, el ensayo anterior con `0x0071=1` no certificaba la segunda vuelta. `0x007F=1` también era una intervención adicional, no el valor de arranque (`0`). Quedan por probar los jefes y la vuelta 2 auténtica.
  - **Ensayo anterior con `0x0071=1` y `0x007F=1` (27/10/2026):**
    - **Variables, leídas del código:**
      - `0x0071` es la vuelta: 0x7446 hace `LDB #1; STB $7F; STB $71; CLR $72`.
      - El avance de fase está en 0x754B y vuelve a 0 después de la 6.
      - En 0x7378 se decide según `$71`.
      - 0x7364 envía a la fase 5 (`LDB #4; STB $72`).
    - **Paridad MAME con `0x0071=1` (+`0x007F=1`):** valores de fase 0–5, 24/24 MATCH; son estados artificiales, no evidencia de vuelta 2.
    - **Valor 6 con `0x0071=1`:** salta a 0xCC08, a mitad de `LDB #$3F`, y ejecuta `SWI`, que el AOT no soporta. MAME coincide byte a byte hasta el frame 2538, así que el juego original toma el mismo camino. El estado fabricado es incoherente; no es un defecto del port.
    - **Pendiente:** la sala final de la vuelta 2 y el final verdadero solo se prueban por un camino legítimo (cinta o estado completo); `SWI` queda anotado para fidelidad total.
  - **Barrido de jefes con g6 (27/10/2026): parcial; sin hueco AOT.**
    - `0x00A0–A1` (X) y `0x00A2–A3` (Y) se reescriben cada frame desde el objeto de Arthur: `0x0506–07` y `0x0509–0A`. El poke útil para posicionarlo en el respawn (frames 2175–2200 de `titleCoinStart`) es sobre el objeto. En el cementerio, saltar solo X deja el cursor de apariciones `0x006A` en 0 y no activa al demonio; en la cinta que llega caminando a X=1606, sube a 21. Un poke de `0x006A=16` y `0x007E=16` junto con X=1300 sí muestra al demonio rojo, seguido de lanzas, movimiento y enemigos, con paridad MAME.
    - Cinta privada de entrada `out/h3_boss_right.json`: `titleCoinStart` más derecha desde frame 2180, disparo 3 frames cada 12 y salto 8 cada 95. Solo los inputs son sintéticos; el AOT y MAME reciben idénticos pokes. La cinta de inputs del explorador `out/v3/b3/explorer/explorer-g4-2730-1606.json`, sin poke, aporta el encuentro por recorrido normal de la fase 1.

      | Fase (`0x72`) | Escena observada con `v3_b3_witness` | Oráculo g6/MAME |
      |---|---|---|
      | 1 (`0`) | Demonio rojo con la cinta legítima; también aparece con X=1300 y cursores 16 durante disparos | 4/4 frames legítimos (2400–2730) y 6/6 con atajo (2300–2800), todos MATCH, 0 bytes omitidos |
      | 2 (`1`) | X=3720, Y=500: torre, Arthur cae a plataforma inferior; jefe no localizado | 3/3 (2210/2300/2400) MATCH, 0 omitidos |
      | 3 (`2`) | X=3300, Y=574, cursores 16: cueva con murciélagos; jefe no localizado | 3/3 MATCH, 0 omitidos |
      | 4 (`3`) | X=6300, Y=591, cursores 16: cueva vertical; jefe no localizado | 3/3 MATCH, 0 omitidos |
      | 5 (`4`) | X=7380, Y=1500, cursores 16: torre con enemigos; jefe no localizado | 3/3 MATCH, 0 omitidos |
      | 6 (`5`) | X=7560, Y=2336: Arthur toca a un enemigo grande; no consta que sea el jefe ni su derrota | 5/5 (2210–2600) MATCH con disparos, 0 omitidos |
      | Sala final (`6`) | Astaroth visible en 2350–2700; el atajo pasa a `0x71=2` sin acreditar una victoria | 7/7 (2200–2700) MATCH, 0 omitidos |

  - **Revisión del barrido y verificación de jefes diferida (27/10/2026):**
    - **Corrección:** `0x0068–0x006B` es la puntuación BCD (se suma con `DAA` en el banco 3, 0x5402, y se compara con el récord en `0x00D0`) y `0x007E` es un contador (+0x15 en 0xEBFA); ninguno es un cursor de apariciones. Los pokes `0x006A`/`0x007E` del barrido anterior no dan estados coherentes, y el «demonio rojo» de la fase 1 es un Red Arremer, no el jefe. La tabla anterior **no** contiene ningún combate de jefe.
    - **Estado coherente disponible:** `0x0081` es el checkpoint de la fase (0 = inicio, 1 = mitad). 0xED64 lo pone a 1 cuando la X de Arthur (`0x009C`) supera `0xED88[fase]` = 1792, 4608, 1024, 4864, 6656, 7424, 7936; la reaparición (0x6D25, tabla 0x6CE9) reconstruye la mitad de la fase. `H3_POKE=1840:2120:114:N,1840:2120:129:1` sobre `titleCoinStart` sitúa a Arthur a mitad de las fases 1–6 (`N`=0–5) por ese mismo código; la sala de Astaroth (`N`=6) no tiene checkpoint.
    - **Armadura:** `0x00AC`=1 sin armadura; la reaparición lo pone a 0.
    - **Avance:** [scripts/h3_boss_search.mjs](../scripts/h3_boss_search.mjs) (búsqueda en haz; éxito = `0x72` avanza) llega desde la mitad de la fase 1 hasta el cíclope ante la puerta (scroll fijo en 3072) sin `UNCOMPILED`; ningún jefe derrotado ni comparado con MAME. La herramienta no está validada tras corregir la armadura a `0x00AC`.
    - **Decisión del operador:** la verificación de jefes queda diferida hasta después de la implementación completa (§8). Los jefes se certifican con la cinta humana en F-N.
    - **Límite:** 34/34 puntos de control de estas escenas coinciden, sin `UNCOMPILED`/`UNSUPPORTED`; no se modifica el cierre ni se crea g7. Solo hay combate visible del demonio de la fase 1. En la cueva de la fase 3, un barrido adicional de `0x006A`/`0x007E` por 0, 4, 8, 12, 16, 20, 24, 28, 32, 40, 48 y 64 con X=3300 tampoco mostró jefe. Falta encontrar estados coherentes junto a los jefes de las fases 2–6, derrotarlos y recorrer la segunda vuelta por una ruta legítima. Los saltos directos a X muy avanzada omiten el curso de apariciones; los saltos verticales pueden dejar a Arthur cayendo. La coincidencia de bytes en esos estados no certifica un jefe.
  - **Barrido de cobertura de jefes con g6 (27/10/2026): 0 % UNCOMPILED en todo lo alcanzado; sin g7.**
    - **Método:** [scripts/h3_boss_search.mjs](../scripts/h3_boss_search.mjs) desde `titleCoinStart` + atajo; haz de 8, 32 y 96 hasta el frame 9000. Se añadieron `cp` (`$81`) al estado, contadores `branches`/`halts` y el peso de subida `H3_WU`.
    - **Inicio de fase validado:** `H3_POKE=1840:2120:114:N` da `$72`=N y `$81`=0 para N=0–5. La X difiere de la de mitad de fase, salvo en N=4 (6736 frente a 6784) y en N=5, donde inicio y mitad son idénticos (X=7472, Y=1615).
    - **Métrica:** % de ramas evaluadas que acaban en `H3_BOSS_HALT`. Infla el volumen, porque casi todas las ramas reejecutan el mismo código; no mide bloques nuevos (ver «Cobertura real»).

      | Fase (`0x72`) | Arranques | Ramas | HALT | Alcance real |
      |---|---|---|---|---|
      | 1 (`0`) | inicio, mitad ×2 | 56 154 | 0 (0 %) | Arena del cíclope (scroll 3073), sostenida del frame ~3700 al 9000; sin victoria |
      | 2 (`1`) | inicio, mitad ×2 | 52 374 | 0 (0 %) | Estancado en X≈5449 (scroll 5066); jefe no alcanzado |
      | 3 (`2`) | inicio, mitad ×3 | 51 298 | 0 (0 %) | `0x72` 2→3 en el frame 5680 (haz 32); no comparado con MAME |
      | 4 (`3`) | inicio, mitad ×2 | 63 126 | 0 (0 %) | Scroll fijo en 6144 hasta el frame 9000; posible arena, jefe sin confirmar |
      | 5 (`4`) | inicio, mitad ×4 | 24 556 + 1 cortado | 0 (0 %) | Subiendo muere hacia el frame 2980; bajando (`H3_WY`) llega a Y≈1172 vivo en el frame 5800 (cortado) |
      | 6 (`5`) | inicio, mitad ×2 | 5 390 | 0 (0 %) | Muere en menos de 700 frames; jefe no alcanzado |
      | Sala final (`6`) | `114:6` | 47 292 | 0 (0 %) | En la sala hasta el frame 9000 (scroll 7936, `0x71`=2); puntuación 0, sin combate acreditado |

    - **Total:** 300 190 ramas, 0 `UNCOMPILED`/`UNSUPPORTED`. No hay residuo, así que no se crea g7. Ningún jefe consta como derrotado ni comparado con MAME.
    - **Límite:** el resultado esperado ya era 0, porque g6 cubre el 100 % de las funciones de ROM más el modo multientrada. Ensanchar el haz (8→96) no cambió el alcance en las fases 5–6: el cuello de botella es la poda por muerte, no el ancho. Faltan los jefes de las fases 2, 5 y 6 y el combate con Astaroth.
    - **Vuelta atrás, fase 2 (27/10/2026): GO acotado.** [h3_boss_search.mjs](../scripts/h3_boss_search.mjs) admite ahora `H3_STEP`, `H3_BACKTRACK` (segmentos) y `H3_BACKTRACK_LIMIT`; sin esas variables conserva el haz anterior. La validación barata (`H3_POKE=1840:2120:114:1`, frames 2200–2800, segmentos de 60) reprodujo byte a byte la cinta previa: SHA-256 de archivo `3ba7a6a3e16fb69dfae6a5455b4356e71a55b5cdcc0d15e749e126dfa5e941a2` y hash interno `223d890dc6b5ff1a7298520268ffdb7ad8afb306dc1230fc389c2707ec67c078`. **Lección durable:** acortar `H3_STEP` cambia la cadencia de acciones; mantener 60 como control y usar 15–20 solo ante un obstáculo concreto. Aquí 20/8/12 agotó alternativas en X=4348 (6 retrocesos); 60/4/16 hizo 13 retrocesos y llegó a **X=5460, scroll=5076**, frente al límite anterior X≈5449/scroll 5066: cumple el GO pedido. Alcanzó `END=9000` con `$72`=1, 17 892 ramas, 0 HALT y sin avance de fase. **No es señal de jefe ni acredita un combate.** No se usó MAME ni se crea g7.
    - **Señal alrededor de X=5449–5464 (27/10/2026): meseta de avance; causa, jefe y puerta NO probados.** La repetición exacta con `H3_POKE=1840:2120:114:1`, `K=60`, `H3_BACKTRACK=4`, límite 16 y `H3_LAST=1` confirmó una sutileza: el haz a `END=9000` sí mostró X=5460, pero su cabeza final descendía de otra rama y la cinta guardada solo reproducía un máximo de 5450. Se repitió el mismo control hasta `END=7300`; `out/h3/boss/search-p1-7300.json` (privada) conserva la rama correcta: 85 segmentos, 14 756 ramas, 13 retrocesos, 0 HALT, hash interno `cff7bc275bb34fb56238c4274a8ac327ac58510f96764fcc32c8c48239cbdc73`, SHA-256 de archivo `fd42392a7c2ec4e5b29896566798eb3499fdea0f6204026fa92038a6b83d0350`.
      - [h3_boss_inspect.mjs](../scripts/h3_boss_inspect.mjs) la reproduce sobre g6 con `FRAMES_DONE`: X=5460/Y=142/scroll=5076 en el frame 7300 y máximo X=5464/scroll=5080 desde el 7304 hasta el final inspeccionado (7599). `$72` permanece en 1 y `$81` en 1. En la cola sin nuevas entradas, las vidas bajan de 2 a 1 en el frame 7500.
      - Desde el frame 4300 hasta el 7000 se mantiene en X=5449–5450/scroll=5066 pese a que 43 de los últimos 50 segmentos son acciones hacia la derecha. El montaje AOT muestra una columna vertical de mampostería en esa posición. La meseta posterior en X=5464 coincide con estados de impacto/muerte, por lo que no prueba una colisión física con la columna. Se corrige la conclusión anterior de bloqueo físico.
      - Se ve una puerta como elemento arquitectónico a la izquierda, y la cinta larga muestra transitoriamente en el frame 7900 un personaje rojo de 2×2 sprites entrando por el borde. No hay interacción con la puerta, objeto persistente atribuible a jefe, cambio de fase, llave, apertura ni cruce. Por tanto no se afirma puerta funcional, combate ni jefe. Solo AOT, sin MAME y sin g7.
    - **Sondeo de salto y ataque desde la cinta (27/10/2026).** Se corrigió el filtro de muerte de [h3_boss_search.mjs](../scripts/h3_boss_search.mjs): la máscara anterior cubría `0x9c5c`, pero no `0x9c64`, aunque ambos estaban documentados como estados de impacto sin armadura. Los resultados anteriores siguen siendo observaciones de sus cintas, no garantía de supervivencia. Desde el frame 7060 (X=5449, fase 1, 2 vidas y sin armadura), se probaron segmentos de 23 frames con 14 acciones, incluidos salto y disparo, haz 8, retroceso 2 y límite 3. Hasta el frame 7428: 1848 ramas, 1 retroceso, 0 HALT; con peso de subida 2 hasta 7451: 1960 ramas, 1 retroceso, 0 HALT. Ninguna búsqueda avanzó de fase. Es un sondeo acotado, no una prueba de que no exista paso.
      - La repetición hasta 7290 guardó `out/h3/boss/search-p1-7290.json` (privada), 1022 ramas y 0 HALT: X=5464/Y=79/scroll=5080, 2 vidas y fase 1. Hash interno `dcbab2a62f43d8b999ab186960a6ca76e84028cdc13f129ed3480b0cf3874d49`, SHA-256 de archivo `bdd0129156f01e2e5aba963fdce20924a5b911566dc178d979a8be22cb6b156d`. En la cola sin entradas, el frame 7300 ya muestra `0x9c64` con armadura ausente y en el 7500 queda una vida. Una prueba desde el frame 7291 confirmó que el filtro corregido poda las 14 acciones en ese estado. No identifica qué causó el impacto ni acredita jefe, puerta o combate.
    - **Primer impacto en fase 2 (H3-F2, 27/10/2026): causa demostrada; mejora local, sin avance.** Traza AOT causal y maniobras dirigidas sobre g6, sin MAME ni g7; bundle y runtime intactos.
      - **Herramientas:**
        - [h3_boss_trace.mjs](../scripts/h3_boss_trace.mjs) ([h3_lab_trace.mjs](../src/h3_lab_trace.mjs)) envuelve en memoria la tabla de bloques y `$.wk`/`$.rd`/`$.rk`. Registra entradas de bloque, escrituras y lecturas acotadas. Después repite la ventana sin registro desde el estado guardado y exige el mismo hash.
        - [h3_boss_maneuver.mjs](../scripts/h3_boss_maneuver.mjs) ([h3_lab_maneuver.mjs](../src/h3_lab_maneuver.mjs)) ejecuta hasta tres maniobras P1 desde un prefijo guardado, con la cinta propia como control.
        - Tests: `tests/test_h3_lab_trace.mjs` y `tests/test_h3_lab_maneuver.mjs`.
      - **Convención y neutralidad:**
        - El registro *i* es la RAM en el ciclo *i*·25152−1, o justo antes de la primera escritura en ese ciclo o después. `onFrame` corre tras esa captura y antes del poke; en todas las filas la RAM viva coincide con el registro y `$.frame`+1 = *i*.
        - Trazas 7240–7301 y 7180–7301, esta última con la ampliación de 60 frames. Fueron tres replays desde reset; el tercero lo autorizó el operador.
        - El hash con registro es igual al hash sin registro (`a0485a0a…` y `31962c18…`). Coinciden 24/24 filas del inspector y el tramo 7240–7301 es idéntico byte a byte entre ambas trazas.
      - **Cadena causal:**
        1. Un emisor crea objetos de tipo 3 (tabla `0x13C0`, 6×0x20) en su propia X y con su Y −8: su X está en `0x0EB6` y el código es 0xD228–0xD242. Aparecieron en X=5444 en 7176 y 7226, y en la ventana caen además dos con X=5458. Caen 2 px por frame y atraviesan el suelo.
        2. La rutina 0xF530–0xF5A1 compara al jugador (`0x0500`) con cada objeto cuando `0x00AD`=0 y está activo el bit 0 de `0x0500`. Hay impacto si −6 ≤ dX ≤ 6 y −8 ≤ dY ≤ 8 (tipo 3, tabla ROM 0xF5A2); con `0x051F` activo el rango vertical es −8…2. Si el tipo no es 0, 0xF586–0xF596 escribe:
           - `0x0500`: 1→2;
           - modo y subestado (`0x0503`/`0x0504`): 3/0;
           - `0x00AE`: dX;
           - estado del objeto: 1→2.
        3. En X=5449, la gota de 5444 queda a dX=−5. El `right_jump` de 7221 (`button2` en 7222–7227) pone el modo 2 desde 7223 (0x9221) y eleva a Arthur hasta la gota: impacto en 7233 con dY=7; en 7232 el dY era 11.
        4. Sin armadura (`0x00AC`=1 desde antes de 7180), el modo 3 pasa por 0x9AF9 → 0x9C39 (tabla 0x9C42) y recorre los subestados 1–5. El subestado 4 arma `0x0520`=20 en 7272 (0x9C0D). Al vencer, en 7291, 0x98FE escribe `0x9c60` (tabla 0x9C54, indexada por `0x051E`) y 0x9093 lo avanza a `0x9c64`. Las vidas pasan de 2 a 1 en 7451.
      - **Consecuencias:**
        - `0x9c64` llega 52–58 frames después del impacto.
        - X=5464 es el lanzamiento del impacto, no un avance: en el aire, Y sube hasta 143 y cruza X=5450 en 7245, a Y≈140.
        - La búsqueda conservó la rama porque la poda esperaba a `0x9c64` y la métrica premia la X.
        - El «GO acotado» de X=5460 (Y=142 en 7300, vida perdida en 7500) sigue el mismo patrón, aunque esa cinta no se trazó.
      - **Maniobras:** prefijo 7220, segmentos de 23 frames, horizonte 7221–7460, 1,6 s en total. El control reproduce 81/81 registros de la traza.

        | Variante | Condición que cambia | Resultado | Previsto |
        |---|---|---|---|
        | `sin-salto`: derecha ×3 | dY: sin salto | Impacto en 7247 en X=5449; `0x9c64` en 7299; pierde una vida en 7459 | 7247 |
        | `retirada`: izquierda 23 frames | dX fuera de ±6 | Sin impacto en 240 frames; X=5425, 2 vidas: **mejora local** | sin impacto |
        | `retirada-salto`: izquierda, salto con carrera, derecha ×8 | Saltar entre dos gotas desde fuera de su alcance | Se bloquea en X=5450 a Y≈112 (ápice 118); la gota siguiente impacta en 7299 | ~7298 |

        Ninguna variante supera X=5464, así que **no hay avance**. Las cintas privadas son `out/h3/boss/f2/maneuver-7220-*.json`, con SHA-256 de archivo `7a9d72b2…`, `bec8d6ae…` y `c419396d…`.
      - **Límite:** con derecha sostenida, X no pasa de 5450 ni en el suelo ni con salto con carrera; solo el lanzamiento la cruza, a Y≈140. Falta trazar la colisión con el fondo y saber cómo se supera la columna legítimamente. No hay jefe, combate ni puerta funcional demostrados.
    - **Cobertura real (27/10/2026):** [scripts/h3_boss_coverage.mjs](../scripts/h3_boss_coverage.mjs) envuelve en memoria `blocks.get` de `program.mjs` (cuenta claves distintas con función) antes de `labCreateBoard`; bundle y runtime intactos. Validación barata con B2-D `lateStart` (1500 frames): 897 bloques en dos ejecuciones con el mismo conjunto, hash de frames estable e idéntico al de la ejecución sin envolver. Las cintas certificadas (5 B2-D + 9 B3) ejecutan 1491 bloques de 38 084 en g6 (3,92 %). Resultado en `out/h3/boss/coverage.json` (sin commit).

      | Cinta | Fin (fase, scroll) | Bloques | Nuevos vs certificadas | % de g6 | Banco |
      |---|---|---|---|---|---|
      | `search-p0-4840` (cíclope) | 0, 3073 | 1535 | 297 | 0,78 % | fijo 297 |
      | `search-p2-5680` (`$72` 2→3) | 3, 3584 | 1800 | 551 | 1,45 % | fijo 550, b3 1 |
      | `search-p3-4720` (fase 4) | 3, 6144 | 1633 | 402 | 1,06 % | fijo 399, b3 3 |
      | `search-p6-7000` (Astaroth) | 6, 7936 | 1283 | 136 | 0,36 % | fijo 136 |
      | **Unión** | — | — | **981** | **2,58 %** | fijo 978, b3 3 |

    - **Rutinas de jefe:** no se pueden atribuir. El repo no tiene un mapa de rutinas de jefe (ni nombres de funciones fuera del banco 4). Dato sin interpretar: `0xAFFC` (candidata M2.4) está entre los bloques nuevos de `search-p0-4840`. `0xE79E` y `0xC3A3` no aparecen.
    - **Siguiente:** recomendación para los jefes: una cinta humana por tramo. Para atribuir bloques a jefes hace falta antes un mapa de rutinas del banco fijo.
- [ExportFunctionGraph.java](../ghidra_scripts/ExportFunctionGraph.java) solo analiza el banco 4: ampliar o recorrer con el decodificador del compilador AOT.
- **GO:** alcanzable compilado, residuo listado, cintas previas idénticas. **STOP:** cambio de hash en una cinta certificada.

## 4. Ciclo por fase (F-N)

Para cada fase de la primera vuelta. F-(N+1) no empieza sin cerrar F-N. Para N≥2 el operador debe haber grabado hasta el final de la fase N.

| Paso | Contenido | GO |
|---|---|---|
| **F-N.1 Motor** | Sonda TAS o cinta humana desde reset hasta el final de la fase N → descubrimiento offline del residuo dinámico (lo que el paso 5 no alcanzó) → generación nueva certificada solo si hubo residuo (las anteriores no se tocan). En F-1 entra además la cinta de la candidata M2.4 (`0xAFFC`) | Replay desde reset hasta la transición N→N+1 sin `UNCOMPILED`; paridad MAME en entrada de fase, jefe y transición |
| **F-N.2 Reglas** | Muerte con respawn en la fase; game over con continue una vez en todo el plan | Detectores del paso 4 confirman el evento y MAME coincide |
| **F-N.3 Cierre** | Checkpoint breve en `docs/`: generación, cintas, evidencia, mapa de la fase y coste consumido | — |

Los HALT antiguos `0xE79E` y `0xC3A3` se comprueban en el paso 5.0.

**F-L2 — Segunda vuelta y final:** F-N.1 y F-N.2 por fase con cinta humana. **GO H4:** final verdadero desde reset y paridad MAME en la pantalla final.

**C6 — En vivo:** partida en el navegador sobre las fases certificadas. Si la juega un humano, cierra también G2.3.

## 5. Gate del bot por fase (B-N) — RETIRADO

**Retirado por decisión del operador (27/10/2026):** el contenido se completa sin verificación del bot. El bot queda fuera de la ruta crítica, como demostración independiente opcional. **28/10/2026:** el bot visual de `bot/` sigue aparcado; su objetivo es otro (jugar en vivo solo con píxeles) y la sonda TAS (H3-S1) no lo reanuda. Los criterios siguientes se conservan solo como referencia por si se reactiva.

1. **Arranque:** inicio de la fase N mediante prefijo desde reset tomado de la cinta humana (como el prefijo actual hasta 2672). El bot no rejuega fases anteriores.
2. **Motor del gate:** el episodio del gate corre sobre una generación congelada y certificada, sin compilación bajo demanda.
3. **Decisión** solo por píxeles, frame y sesión; RAM solo para evaluar; controles originales.
4. **Éxito:** llega a la transición N→N+1 (detector del paso 4) sin game over; las vidas perdidas se reportan.
5. **Generalización:** completa la fase en el caso de desarrollo y en al menos un caso reservado (otro prefijo o timing) sobre el que no se ajustó.

**Desarrollo (aprobado por el operador, 27/10/2026):** mientras se desarrolla B-N, los episodios offline usan la generación vigente con compilación bajo demanda offline ([v3_b3_ondemand.mjs](../src/v3_b3_ondemand.mjs), el mismo mecanismo del descubrimiento, cuya equivalencia con el bundle congelado ya certifica cada generación). Un `UNCOMPILED` no detiene el trabajo: las semillas nuevas se acumulan, entran en una sola generación al cerrar B-N y el episodio del gate se repite sobre ella.

B-1 equivale a BT-6 del [plan del bot](agents/gng-bot-gameplay-plan-2026-10-27.md) y empieza repitiendo M2.4 sin cambios sobre g5. Faltan el resto del recorrido, enemigos y jefe de la fase 1. Cada fase nueva exige recalibrar la percepción (terreno, paleta, enemigos).

Por defecto el gate cubre las fases de la primera vuelta; la segunda repite fases ya superadas por el bot y se certifica con cinta humana. Si el operador quiere el bot también ahí, se añade B-L2.

## 6. Ejecución y coste

**Política de ejecución:**
- Un solo agente y un paso a la vez; sin subagentes, workflows ni tareas en paralelo.
- Validación barata justo antes del paso que depende de ella, no por adelantado.
- Comandos largos (replays, barridos, certificaciones) en una sola llamada que imprima un resumen, sin volcar salidas completas.
- Al cerrar cada paso, informe breve (GO/STOP, evidencia, coste). Antes de un paso caro (paso 5, F-N.1), confirmar con el operador el presupuesto disponible.
- MAME automático siempre sin ventana, foco ni teclado del operador.

Coste estimado (muy aproximado; recalibrar tras el paso 2):

| Paso | Ventana 5h | Semanal |
|---|---|---|
| 1 Registrador | 5–10% | ~1–2% |
| 2 Rebobinado + ida y vuelta | 25–40% | ~4–6% |
| 3 Verificación de la grabación (el operador juega) | ~5% | ~1% |
| 4 Detectores | 10–20% | ~2–3% |
| 5 Cobertura estática | ~1 ventana | ~10–15% |
| F-N.1 + F-N.2, por fase | 15–30% (menos residuo tras el paso 5) | ~2–5% |
| F-L2 (segunda vuelta + final) | 1–2 ventanas | ~10–25% |
| C6 en vivo | 10–20% | ~2–3% |

**Total:** unas 3–6 ventanas de 5h sin el bot (antes 9–23). Pasos 1–2 ya consumidos.

## 7. Riesgos y contingencias

- **Estados de MAME no deterministas al rebobinar** → los detecta la ida y vuelta (pasos 2 y 3).
- **El operador no avanza una sección ni con rebobinado** → contingencia: descubrimiento offline desde estados de MAME, solo para compilar y nunca como evidencia; requiere plan y validación propios.
- **Sin sonda TAS o cinta humana no hay certificación:** el paso 5 compila, pero ninguna fase cuenta como completada hasta F-N.1 con cinta y paridad MAME.

## 8. Diferido (solo con disparador)

- **`.inp` de terceros:** no se buscan. Si el operador aporta uno de `gngb` que se reproduce en la versión de MAME disponible, se procesa con el pipeline del paso 1 y sus conversiones quedan en `out/`; si set o versión no coinciden, se descarta.

- **Corrección de la poda de `h3_boss_search.mjs`** (antes «siguiente acción del paso 5»): cortar en el impacto (modo 3 en `0x0503` sin armadura) y no premiar la X ganada en ese modo. Sustituida (28/10/2026) por el corte en el impacto del explorador de H3-S1; solo se retoma si se reactiva la búsqueda en haz.

- **Verificación de jefes por búsqueda (laboratorio):** diferida por el operador (27/10/2026) hasta después de la implementación completa. Retomar desde la revisión del paso 5 (checkpoint `0x0081`, armadura `0x00AC`, [h3_boss_search.mjs](../scripts/h3_boss_search.mjs)).

## 9. Fuera de alcance

Audio (G5), 2P/DIPs/paridad visual amplia (G6), sesiones largas y build entregable (G7).
