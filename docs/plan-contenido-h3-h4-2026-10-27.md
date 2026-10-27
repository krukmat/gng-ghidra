# Plan de contenido — de H3 a H4 (fases, jefes, dos vueltas y final)

**Fecha:** 2026-10-27 · **Rama:** `main` · **Estado:** pasos 1–2 GO; en curso: paso 5 (cobertura estática). Paso 3 (grabación del operador) pendiente: no bloquea la compilación, solo la certificación.

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

## 2. Estructura

```
Pasos 1–2 (GO) → Paso 5: cobertura estática → Paso 3: cinta humana → Paso 4 → F-1 … F-6 → F-L2 → C6

F-N:  MOTOR (cinta humana → residuo dinámico + certificación) → REGLAS → CIERRE
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

    - **Límite:** 34/34 puntos de control de estas escenas coinciden, sin `UNCOMPILED`/`UNSUPPORTED`; no se modifica el cierre ni se crea g7. Solo hay combate visible del demonio de la fase 1. En la cueva de la fase 3, un barrido adicional de `0x006A`/`0x007E` por 0, 4, 8, 12, 16, 20, 24, 28, 32, 40, 48 y 64 con X=3300 tampoco mostró jefe. Falta encontrar estados coherentes junto a los jefes de las fases 2–6, derrotarlos y recorrer la segunda vuelta por una ruta legítima. Los saltos directos a X muy avanzada omiten el curso de apariciones; los saltos verticales pueden dejar a Arthur cayendo. La coincidencia de bytes en esos estados no certifica un jefe.
- [ExportFunctionGraph.java](../ghidra_scripts/ExportFunctionGraph.java) solo analiza el banco 4: ampliar o recorrer con el decodificador del compilador AOT.
- **GO:** alcanzable compilado, residuo listado, cintas previas idénticas. **STOP:** cambio de hash en una cinta certificada.

## 4. Ciclo por fase (F-N)

Para cada fase de la primera vuelta. F-(N+1) no empieza sin cerrar F-N. Para N≥2 el operador debe haber grabado hasta el final de la fase N.

| Paso | Contenido | GO |
|---|---|---|
| **F-N.1 Motor** | Cinta humana desde reset hasta el final de la fase N → descubrimiento offline del residuo dinámico (lo que el paso 5 no alcanzó) → generación nueva certificada solo si hubo residuo (las anteriores no se tocan). En F-1 entra además la cinta de la candidata M2.4 (`0xAFFC`) | Replay desde reset hasta la transición N→N+1 sin `UNCOMPILED`; paridad MAME en entrada de fase, jefe y transición |
| **F-N.2 Reglas** | Muerte con respawn en la fase; game over con continue una vez en todo el plan | Detectores del paso 4 confirman el evento y MAME coincide |
| **F-N.3 Cierre** | Checkpoint breve en `docs/`: generación, cintas, evidencia, mapa de la fase y coste consumido | — |

Los HALT antiguos `0xE79E` y `0xC3A3` se comprueban en el paso 5.0.

**F-L2 — Segunda vuelta y final:** F-N.1 y F-N.2 por fase con cinta humana. **GO H4:** final verdadero desde reset y paridad MAME en la pantalla final.

**C6 — En vivo:** partida en el navegador sobre las fases certificadas. Si la juega un humano, cierra también G2.3.

## 5. Gate del bot por fase (B-N) — RETIRADO

**Retirado por decisión del operador (27/10/2026):** el contenido se completa sin verificación del bot. El bot queda fuera de la ruta crítica, como demostración independiente opcional. Los criterios siguientes se conservan solo como referencia por si se reactiva.

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
- **Sin cinta humana no hay certificación:** el paso 5 compila, pero ninguna fase cuenta como completada hasta F-N.1 con cinta y paridad MAME.

## 8. Diferido (solo con disparador)

- **`.inp` de terceros:** no se buscan. Si el operador aporta uno de `gngb` que se reproduce en la versión de MAME disponible, se procesa con el pipeline del paso 1 y sus conversiones quedan en `out/`; si set o versión no coinciden, se descarta.

## 9. Fuera de alcance

Audio (G5), 2P/DIPs/paridad visual amplia (G6), sesiones largas y build entregable (G7).
