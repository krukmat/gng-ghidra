# Ruta crítica del port recompilado — R3.5 → R4 (22/10/2026)

## A0.5.B PASS real → A0.6 banco de ROM auténtico (22/10/2026)

**Nueva evidencia aportada por el operador:** `bash scripts/r3-local-regression.sh` **52/52 PASS**; `r3_video_board_integration.mjs` devuelve **`NATIVE_VRAM_IMAGE_MATCHED_STATIC_JS_BOARD_AND_TILE_DECODER`**. La board JS reproduce **4.096/4.096** bytes VRAM finales independientes del tap MAME, comprueba 2.048 registros de tile FG/BG y utiliza los 4.096 preestados MAME como *inputs individuales* (no CPU autónoma). **A0.5.B aceptado dentro de ese alcance; R4 aún no.**

**A0.6.1–A0.6.2 implementados en `main`, prueba Mac pendiente:**

- Fuente técnica [MAME `gng.cpp`](https://github.com/mamedev/mame/blob/master/src/mame/capcom/gng.cpp): ventana `0x4000–0x5fff`, registro selector `0x3e00`, `bankswitch_w`: `data==4 ? 4 : data&3`. Bancos 0–3: cuatro segmentos de 8 KiB de `gg5.bin`; banco 4: primeros 8 KiB de `gg4.bin`. `0x6000–0xffff` es ROM fija. Los bytes no se obtienen de internet.
- Nuevo `scripts/r3_bank_inventory.py`: usa `src/poc.py::read_rom` para autenticar el **ZIP original por CRC, tamaño y reset vector**, conserva `out/gngb-flat.bin` sin modificarlo, exige equivalencia byte a byte y crea `out/r3/banked-rom/private-banked-rom.bin` (5 × 8 KiB) exclusivamente bajo `out/r3` ignorado; no sobrescribe una imagen que difiera. Informa un recuento de PCs observados en `0x4000–0x5fff` y las entradas MAME vistas en `FRAME_SAMPLE` / `BANK_CONTROL_WRITE_SAMPLE`, **sin atribuir bancos a instrucciones**.
- Nuevo `src/gngb_banked_rom.mjs`: adaptador ROM solo lectura de cinco entradas, **sin selección inicial inventada**. `read8` falla hasta recibir un `selectFromControlWrite` explícito; se reproduce la selección para los 256 bytes posibles. Los bytes se copian y no hay intérprete MC6809 ni ROM exportada por el reporte.
- `tests/test_r3_bank_inventory.py` (6 casos) + `tests/test_gngb_banked_rom.mjs` (3 casos), incorporados a `scripts/r3-local-regression.sh`, sin GitHub Actions. **No se han ejecutado todavía contra el checkout real del operador; no declarar PASS prematuro.**

**Validación Mac, sin volver a ejecutar MAME:**

```bash
git pull --ff-only
bash scripts/r3-local-regression.sh
python3 scripts/r3_bank_inventory.py
```

Solo compartir el JSON final resumido. El inventario debe mantener `bank_entry_for_each_instruction_proven=false` y `complete_bank_switch_edges_proven=false` hasta observar un identificador de banco **en la misma frontera de cada preinstrucción nativa**, más la transición post-handler de `0x3e00`. Las muestras antiguas por frame/tap no bastan para recompilar 7.434 prestates bancarios con procedencia verificada.

**A0.6.3 (siguiente dependencia):** instrumentación MAME local de banco activo por preinstrucción y efecto post-handler, vinculados a ciclo/seq/PC, con trazas bajo `out`. La validación IRQ/SYNCACK real (R3.5.B2) sigue en paralelo. No lanzar MAME otra vez para A0.6.1; solo para A0.6.3 si la instrumentación se prepara primero.

---

## A0.4 PASS real → A0.5.B: VRAM nativa integrada con board y tiles (22/10/2026)

**Resultado Mac confirmado por el operador:** `bash scripts/r3-local-regression.sh` termina **47/47 PASS**; captura MAME opt-in finalizada con soft reset y 17.135 preestados. `r3_unmapped_read_policy.mjs` repite `MAME_UNMAPPED_POLICY_MATCHES_NATIVE_TAPS_AND_STATIC_LDA`; `r3_native_video_write_gate.mjs` devuelve **`NATIVE_VIDEO_WRITES_MATCH_GENERATED_STATIC_JS`**, `4096/4096` escrituras VRAM nativas y predichas coincidentes, **0** escrituras de vídeo adicionales, **0** divergencias de los 4096 checkpoints, mismo orden, dirección, valor y máscara; 0 writes VRAM antes del reset. **A0.4 PASS**, solamente en el alcance de estos cuatro sites de memoria, sin atribución individual CPU→tap ni equivalencia IRQ/SYNC/bancos.

**A0.5.B implementado sobre A0.5-LAB ya existente, sin reescribir renderer ni compilar otro motor:**

- `src/gngb_video_bridge.mjs`: reproduce los cuatro sites `STA/STB indexed` desde **preestados MAME independientes por instrucción** usando `board.stepStatic`, no inyecta los valores de MAME en el CPU JS. Requiere prueba A0.4 PASS recién recalculada por el CLI y verifica 4×1024 eventos; contrasta los **4096 bytes finales de VRAM** de la board con la imagen construida exclusivamente desde el tap nativo (full-byte, direcciones únicas y todas las 4096 posiciones escritas).
- Comprueba los **2048 registros de tile FG/BG** mediante los decodificadores ya existentes `readTile` y `board.tile`. No decodifica ROM gráfica ni afirma píxeles correctos; no produce un fotograma R4. Bloquea lectura de memoria no inicializada, divergencia de CPU, direcciones repetidas, máscara parcial, discrepancia byte a byte y procedencia de reset inválida.
- `scripts/r3_video_board_integration.mjs`: gate offline que revalida contra **los mismos archivos nativos locales** el arranque/sprites R3.3, SYNC y A0.4, genera solo JS estático privado en `out/r3` y emite un resumen sin bytes ROM/VRAM. **No reejecuta MAME**.
- `tests/test_gngb_video_bridge.mjs`: cinco tests ROM-free sintéticos sobre **4096 escrituras**, 2048 tiles, procedencia obligatoria y escenarios de corrupción. Probados localmente en sandbox de componentes con un compilador de prueba compatible (5/5); **la validación del checkout real en Mac sigue pendiente**. `scripts/r3-local-regression.sh` incluye ahora esas pruebas. **Sin GitHub Actions**.

**Ejecuta sobre los datos nativos que ya existen en tu Mac:**

```bash
git pull --ff-only
bash scripts/r3-local-regression.sh
node scripts/r3_video_board_integration.mjs
```

El último reporte esperado es `gng.a05.native-video-board-integration.v1` con estado `NATIVE_VRAM_IMAGE_MATCHED_STATIC_JS_BOARD_AND_TILE_DECODER`. Un PASS significará que el JS generado alimenta la VRAM de la board y los decodificadores de tiles con **4096 bytes equivalentes al tap MAME**, sin necesidad de copiar los bytes nativos al CPU. El CPU aún recibe **preestados MAME por instrucción**, por lo que **NO es autónomo desde reset**. R4, sprites DMA, política de bancos e IRQ/SYNCACK siguen pendientes.

**Siguiente bloque tras A0.5.B:** inventario del banco efectivo para los 7434 preestados observados fuera de ROM fija y señal nativa de wake/IRQ para continuidad de ejecución. No basta con ampliar más opcodes si esas dos dependencias no están resueltas.

---

## A0.5-LAB — Board RAM/VRAM minimal sobre el compilador existente (22/10/2026)

**Trabajo independiente completado en `main` mientras A0.4 espera captura real MAME.** No cambiamos de compilador, no introducimos intérprete de opcodes y **GitHub Actions ya está eliminado** (los tests se ejecutan localmente).

- `src/gngb_board_memory.mjs`: adaptador de memoria conservador y *fail-closed* para `0x0000–0x2fff`. Separa RAM principal, RAM de sprites, FG `0x2000–0x27ff` y BG `0x2800–0x2fff`, reutilizando directamente `src/video_memory.mjs`, `src/sprite_memory.mjs` y `checkedState` del compilador R3. Ninguna inicialización de RAM se presenta como un cold boot real: **leer antes de escribir falla**.
- `stepStatic(compiledStep,regs)`: ejecuta una instrucción JS **ya generada** por `emitStaticModule` con sinks `writeRamWord`/ `writeRamByte`; valida rango, byte, estado CPU y ejecuta commit atómico. Un error en el código emitido o en cualquier escritura **no muta la board**. No hay decodificador de instrucciones en runtime.
- `snapshotAddressSpace({requireVideoInitialized:true})` entrega **una copia** de los bytes FG/BG para el renderer existente; `tile(...)` decodifica con `readTile` original. Para sprites se expone exclusivamente copia de RAM CPU y se exige inicialización completa; **no se finge el buffer DMA** ni se reproduce la escritura a `0x3c00`.
- Lectura de `0x3c00` únicamente si se inyecta callback explícito con la política **B4 ya validada**; el módulo **no** codifica ni infiere su valor. Otros registros MMIO, lecturas/escrituras de ROM fija/bancaria y causalidad IRQ siguen bloqueados.
- `tests/test_gngb_board_memory.mjs`: 5 pruebas locales ROM-free: RAM sin inicializar, integración FG/BG, **4.096 stores sintéticos** desde los cuatro PCs compilados que inicializan 4.096 bytes VRAM (2.048 FG + 2.048 BG), 16-bit sprite word big-endian y rollback ante MMIO incorrecto/error del JS. Se probaron en el laboratorio local de desarrollo con sustitutos de las dependencias para verificar la mecánica, **no contra la ROM real ni el MAME privado del usuario**.
- `scripts/r3-local-regression.sh`: ejecuta la batería de tests Node de A0.2–A0.5 **localmente, sin GitHub Actions**, incluida la integración real de módulos dentro del checkout del Mac. No genera ni redistribuye ROM.

**Validaciones pendientes y orden:**

```bash
git pull --ff-only
bash scripts/r3-local-regression.sh
bash scripts/r3-video-write-capture.sh
```

El último comando inicia **una captura MAME** para A0.4, respalda antes los artefactos privados y valida el contraste de escrituras nativas. Si ese gate pasa, podremos conectar la evidencia de VRAM con el board mínimo y luego avanzar el estado de bancos y el origen real de IRQ/SYNCACK. A0.5-LAB **no es A0.4 PASS ni primer frame autónomo R4**.

---

## A0.4 — Contraste real ordenado de VRAM (22/10/2026)

**Evidencia Mac A0.3 aceptada en su alcance:** `INDEXED_REGISTER_CHECKPOINTS_MATCHED_BUS_UNVERIFIED` con **4.096/4.096** registros correctos, cero divergencias, cuatro `STA/STB indexed` con postincremento 1: `0x6041` (A,X+), `0x6043` (B,Y+), `0x6055` (B,X+), `0x6057` (A,Y+). Todas sus direcciones predichas corresponden a **VIDEO_RAM**. El nuevo perfil A0 muestra **9.689/17.135 = 56,55%** de *instrucciones muestreadas elegibles para emisión AOT*; restan **12** muestras de opcodes ROM fija sin compilar, **7.434** muestras de ROM bancaria sin procedencia. Esta cifra **no** certifica CPU/bus autónomo ni porcentaje de juego completo.

**A0.4 implementada en `main`, MAME real pendiente:**

- `r2-mame-probe.lua` con `GNG_A04_VIDEO_WRITE_TAP=1` añade **un único tap** de escritura del espacio de programa en `0x2000–0x2fff`. Guarda **dirección, byte, máscara, orden y época de reset**, con límite explícito **32.768** eventos y contador final. Ningún callback PC se utiliza como correlación de instrucción.
- `scripts/r3-video-write-capture.sh` arranca un único laboratorio MAME nativo, reutilizando el wrapper que **respalda toda la captura anterior** en `out/r3` y exige la comprobación B4 de lectura sin handler en la **misma** nueva captura antes del gate A0.4.
- `scripts/r3_native_video_write_gate.mjs` vuelve a validar en el mismo conjunto nativo R3.3 (sprite RAM) y los dos SYNC; ejecuta cada uno de los cuatro stores con **JS compilado y el preestado nativo inicial de esa instrucción**. Exige 1 byte VRAM por store, registro siguiente correcto y exactamente 1.024 ejecuciones de cada PC. Compara las **4.096 escrituras predichas** con un **segmento contiguo y único** de los eventos del tap de MAME después del reset, exigiendo igualdad de **dirección, dato, máscara y orden**.
- **Sin inflar el gate:** una coincidencia permite afirmar solo que el **segmento completo de 4.096 escrituras de VRAM** se observó idéntico en MAME. No se ha demostrado correlación de cada write tap con la instrucción exacta, cobertura exhaustiva de todos los accesos del bus, ni una simulación autónoma de la board. Se cuentan escrituras de VRAM adicionales que no se pueden atribuir al segmento. Sin captura completa, coincidencia única, secuencia correcta o 4.096 registros equivalentes, se bloquea.
- Tests ROM-free con 4.096 eventos sintéticos, orden/dirección/byte/máscara corruptos, epoch equivocado, truncamiento y protección de los resultados. **CI PASS** [Actions](https://github.com/krukmat/gng-ghidra/actions/runs/39809056078).

**Ejecutar en Mac una sola vez (necesita MAME porque la captura anterior no incluía los write taps VRAM):**

```bash
git pull --ff-only
bash scripts/r3-video-write-capture.sh
```

Compartir exclusivamente el JSON agregado final `gng.a0.native-video-byte-write-v1`, no los archivos `out/r2`, el módulo JS generado ni los eventos raw. Si `NATIVE_VIDEO_WRITES_MATCH_GENERATED_STATIC_JS` —y solo entonces— cerrar A0.4 en este alcance e iniciar A0.5 (board RAM/VRAM) y el inventario de bancos. **R4 sigue pendiente** por ejecución continua, banked ROM y causa IRQ/SYNCACK.

---

## A0.3 — STA/STB indexados: compilación estática y gate de registros (22/10/2026)

**Se conserva lo anterior:** del Mac, A0.2 comprobó **5.593/17.135 (32,64%)** muestras elegibles para generación AOT vs **1.393/17.135 (8,13%)** antes; el incremento se debe a `CMPX` inmediato, saltos cortos y familia unary A/B. **B5 real**: cinco pasos desde `0x601A` por NOP×3, DEC_B y BNE, finalizando en `SYNC 0x6016` sin divergencia. Se trata de **cobertura sobre la traza**, no 32,64% del juego ni IRQ validada.

**A0.3 implementado en `main`:**

- Extendida `compileAt` (sin nuevo compilador/intérprete) para `STA/STB` con **modo indexado de dos bytes**, factorando semántica de selector X/Y/U/S, offset firmado de 5 bits, `,R+`, `,R++`, `,-R`, `,--R`, `,R`, `B,R`, `A,R`, `D,R`. Se rechazan **indirectos y formatos de operandos adicionales** hasta auditar direcciones y lectura de punteros reales.
- `emitStaticModule` admite un sink separado `writeRamByte` (tercer argumento opcional); un store indexado **exige** ese sink, hace una sola escritura y actualiza N/Z/V como el 6809. La CPU generada nunca decodifica opcodes en runtime; la política de VRAM/RAM/MMIO pertenece al futuro runtime de board. Las escrituras `STD_X_POSTINC` del arranque siguen con el sink histórico `writeRamWord`.
- **No se ha falsificado equivalencia de bus:** el gate R3 antiguo **excluye** los nuevos stores de su prueba de solo registros/sprite; B5 se detiene en ellos, y A0 etiqueta esta categoría como `AOT_INDEXED_BYTE_WRITE_UNVERIFIED` aunque sea compilable.
- Nuevo `scripts/r3_indexed_store_gate.mjs`: sobre la misma ROM y captura real privada, revalida R3.3/sprite+SYNC, examina los cuatro sites de alta frecuencia `0x6041`, `0x6043`, `0x6055`, `0x6057`, identifica los **modos reales** sin imprimir postbytes, emite JS privado y compara los registros antes/después para cada ejecución observada. Resumen solo contiene nombres de modos, cantidades de escrituras predichas por **región de memoria**, recuentos de coincidencias/divergencias. **Cada ejecución se compara de manera aislada** desde su preestado MAME; no se afirma una secuencia de 4.096 stores de JS autónoma ni escrituras nativas verificadas.
- Tests ROM-free para 11 modos indexados directos, selección de registro X/Y/U/S, rechazos indirectos, ausencia de sinks y checkpoints contradictorios. **CI PASS** [Actions](https://github.com/krukmat/gng-ghidra/actions/runs/39807337724).

**Prueba local, SIN ejecutar MAME de nuevo:**

```bash
git pull --ff-only
node scripts/r3_indexed_store_gate.mjs
node scripts/r3_dynamic_coverage.mjs
```

Compartir **solo JSON agregado**. Resultado `INDEXED_REGISTER_CHECKPOINTS_MATCHED_BUS_UNVERIFIED` significa que el estado de CPU generado reproduce checkpoints para los stores indexados; **no significa** que MAME confirme los bytes escritos. Si `BLOCKED_UNSUPPORTED_REAL_INDEXED_POSTBYTE`, se agrega solo el modo realmente necesario; si `BLOCKED_GENERATED_INDEXED_REGISTER_DIVERGENCE`, se investiga la primera discrepancia. No introducir un valor o dirección de MAME como regla codificada.

**Siguiente paso A0.4:** después de conocer la región real de los 4×1.024 stores, añadir **taps nativos opcionales y acotados por rango** para comparar estrictamente dirección/byte/máscara y orden con la salida JS. Para llegar a R4 también siguen pendientes la ROM bancaria y el origen de IRQ/SYNCACK, que B5 no demuestra.

---

## A0.2 — Compilación de familias priorizadas por perfil real (22/10/2026)

**Perfil real aportado por operador:** 17.135 preestados / 62 PCs diferentes; 55 PCs de ROM fija y 7 en región bancaria/otros. Solo **1.393/17.135 = 8,13%** de las instrucciones de esta traza eran previamente elegibles para el código AOT actual, sin que esa cifra acreditara comportamiento JS ni porcentaje de juego. **7.434** preestados están en ROM bancaria no autenticada. De **8.308** muestras de ROM fija inicialmente sin compilación, **8.192** se acumulan en dos bucles (8 PCs, 1.024 hits cada uno) de `STA_INDEXED`, `STB_INDEXED`, `CMPX_IMM` y `SHORT_BRANCH`. El gate B5 llegó desde `0x6017` a `0x601D` con **3 NOP** y ninguna divergencia, encontrando una operación de familia `REG_UNARY` (el código exacto se descifra privadamente del ROM; no se infiere desde el nombre genérico de B5).

**Error corregido:** `r3_dynamic_coverage.mjs` clasificaba los PCs según `hits`, pero las filas agregadas por familia ya usaban `samples`. La ordenación en familias producía `NaN` y mantenía orden de inserción, colocando incorrectamente **104 hits por delante de familias de 2.048 hits**. Se añadió comparador independiente de prioridad `samples` descendente con desempate estable y test explícito de regresión.

**A0.2 implementado en `main`:** ampliación del **mismo** `r3_static_trace_probe.mjs` (`compileAt`), sin crear un nuevo compilador ni intérprete de opcodes. Se comparte la semántica de generación entre todos los PCs: 22 operaciones unarias válidas A/B (NEG, COM, LSR, ROR, ASR, ASL, ROL, DEC, INC, TST, CLR), `CMPX` inmediato 16 bit con NZVC y todos los 16 saltos relativos de 8 bits, incluyendo condiciones C/Z/N/V. Las posiciones reservadas de la familia unary siguen rechazadas. Los flags se ajustan a la semántica MC6809 usada por [MAME base6x09.lst](https://github.com/mamedev/mame/blob/master/src/devices/cpu/m6809/base6x09.lst), por ejemplo V no se modifica en LSR/ROR/ASR.

**Pruebas ROM-free:** 45.056 combinaciones de valor/CC/opcode para unary A/B, 4.096 condiciones de salto contra oráculo sintético de predicados, 72 casos `CMPX`, rechazo de opcodes reservados, regresión de prioridad y ausencia de intérprete en el código emitido. **CI PASS.** Estas pruebas no sustituyen contrastar CPU/bus con la ROM real. El perfil siguiente mostrará `AOT_STATIC_AVAILABLE` para los PCs presentes de dichas familias, pero **las 4.096 ejecuciones de CMPX/salto ahora elegibles NO significan que los dos bucles completos puedan correr**: aún faltan `STA/STB_INDEXED` y efectos de RAM/MMIO.

**Próxima ejecución del operador en Mac; sin volver a lanzar MAME:**

```bash
git pull --ff-only
node scripts/r3_dynamic_coverage.mjs
node scripts/r3_post_lda_frontier.mjs
```

Compartir solo los JSON agregados. A0.3 priorizará el postbyte/modo de direccionamiento de `STA/STB_INDEXED` y las escrituras nativas de ambos bucles, además de identificar el mapeo bancario de las **7.434** muestras sin procedencia de banco. B5 identifica la primera divergencia real si algún unary difiere; no se promociona CI sintética a PASS nativo. IRQ/SYNCACK siguen pendiente en paralelo y R4 no es jugable.

---

## A0 — Medir cobertura antes de ampliar opcodes (22/10/2026)

**Decisión de aceleración:** evolucionar **el mismo compilador R3**, sin migraciones ni reescrituras. La unidad de priorización será una **familia recurrente de opcodes / bloque candidato**, no una captura manual por PC. Ningún gate R0–R3.6.B4 se elimina.

**A0.1 (implementada, pendiente de validar con la ROM en Mac):** `scripts/r3_dynamic_coverage.mjs` procesa los mismos `17.135` preestados existentes, revalida **en el mismo run** la ROM, las escrituras de sprite RAM R3.3 y la frontera real SYNC/R3.5. Agrupa la frecuencia de PC por familias y la disponibilidad de generación desde `compileAt`, `compileLdaAt` y `compileSyncAt`. Separa ROM fija de ROM bancaria no autenticada y da prioridad a los opcodes sin soporte más frecuentemente observados; señala el primer PC/familia después de `0x601A`.

Se distinguen estrictamente **codegen available** (el compilador actual podría emitir ese opcode) de **behavior validated** (comparación nativa real por registros/bus/IRQ). La tasa ponderada por frecuencia corresponde **solo a las instrucciones muestreadas**, no al porcentaje del juego completo. Los pares de PCs vecinos son preestados observados, **no un CFG causal certificado**. No exporta bytes ROM, valores de memoria, registros, módulos privados ni un porcentaje engañoso de juego recompilado.

**A0.2 (siguiente task, depende del resultado Mac):** clasificar de los 10–12 hotspots más repetidos qué instrucciones comparten semántica MC6809 y qué hardware necesitan; comparar el coste incremental de implementar la familia completa frente a ampliar PCs específicos. No hacer refactor amplio antes de conocer datos.

**A0.3 (posterior):** factorizar de manera incremental semánticas duplicadas en el compilador existente y ejecutar por lotes los gates actuales. Los tests R3.2, R3.3, B4 y B5 permanecen obligatorios.

**Ejecución A0.1 en el Mac, sin nueva captura MAME ni cambios de ROM:**

```bash
git pull --ff-only
node --test tests/test_r3_dynamic_coverage.mjs
node scripts/r3_dynamic_coverage.mjs
```

Compartir únicamente el JSON agregado. Campos decisivos: `distinct_observed_pcs`, `aot_codegen_eligible_share_of_observed_samples`, `most_repeated_unsupported_families`, `highest_frequency_unsupported_pcs`, `post_lda_first_family`. El script produce el archivo privado `out/r3/dynamic-coverage/report.json`. **No se compromete cobertura funcional ni equivalencia IRQ.**

**En paralelo:** B5 mantiene su gate sin modificaciones: `node scripts/r3_post_lda_frontier.mjs`; R3.5.B2 mantiene pendiente captura nativa IRQ/SYNCACK, que no se sustituye por profiling.

---

## Estado y condiciones de verdad

Objetivo: ejecutar Ghosts 'n Goblins con **código MC6809 recompilado a JS**,
sin usar MAME ni intérprete MC6809 como runtime. La ROM original sigue privada.

| Hito | Estado y evidencia |
| --- | --- |
| R0 (replay nativo) | PASS: Blackbox MAME reproducible |
| R1 (renderer JS) | PASS: frames 1660 y 1700, 0/57.344 píxeles distintos cada uno |
| R2 (oráculo CPU integral) | PARTIAL: preestados y taps; no postestado/bus global |
| R3.2 (bloque inicial) | PASS acotado: 1.192/1.192 checkpoints admitidos, 389 pasos consecutivos de registros |
| R3.3 (RAM de sprites) | PASS acotado: 768/768 bytes nativos comparados en dos arranques |
| R3.4 (frontera) | PASS: primer PC sin compilar 0x6016 |
| R3.5.A (SYNC estático) | Código y ROM contrastados: entrada SYNC_WAIT; causa del wake NO verificada |
| R3.5.B1 | PASS real: reset diferenciado del wake de SYNC, causa de línea aún desconocida |
| R3.5.B2 (IRQ/SYNCACK nativo) | Instrumentación de fuente y parser PREPARADOS; sin binario compilado/captura real |
| R3.6.A (después de 0x6017) | PASS real: primer opcode = LDA extended, en 0x6017 |
| R3.6.B (continuación JS) | B4 PASS real: mapa MAME + 100 taps + LDA estático concuerdan; B5 escaneo post-0x601A implementado, validación Mac pendiente |
| R4 (primer frame calculado por JS) | PENDIENTE: memoria/MMIO y CPU entre VBLANK |

La primera época de SYNC acaba observando PC=0x6000 bajo el soft reset
controlado. La segunda observa PC=0x6017, con I/F enmascaradas. El segundo
resultado **no** demuestra por sí solo una señal de IRQ.

## R3.6.B4 PASS real → R3.6.B5 siguiente frontera tras LDA (22/10/2026)

**Validación nativa aportada por el operador:** `MAME_UNMAPPED_POLICY_MATCHES_NATIVE_TAPS_AND_STATIC_LDA`, tests 6/6. MAME reportó `space.map.unmap_value` directamente, **100/100** lecturas en la época posterior al soft reset iguales a esa política, exactamente **un valor distinto**, y el JS estático `LDA_EXT` en `0x6017` produjo el checkpoint nativo de `0x601A` con `first_divergence=null`. No se exportaron el valor ni bytes ROM. **R3.6.B4 aceptado dentro del alcance de lectura autónoma de `0x3C00`**, cuyo handler MAME es solo escritura para disparar DMA de sprites. No equivale a demostrar la causalidad del acceso por instrucción, la señal de IRQ o el runtime completo.

**R3.6.B5 implementado:** `scripts/r3_post_lda_frontier.mjs` identifica el siguiente PC y familia de instrucción tras `0x601A` a partir de la ROM/traza privadas existentes. El CLI **revalida primero B4 usando de nuevo la misma ROM, prestates, tap MMIO y política nativa**, nunca acepta un JSON PASS antiguo ni marcador provisional. Después genera JS estático para los opcodes que el compilador actual ya soporta (sin lecturas ni escrituras RAM adicionales) y mide un segmento continuo: un único preestado semilla en `0x6017` → ejecución JS de LDA con `readGngbUnmappedByte` nativo-certificado → checkpoints sucesivos de registros. Se detiene en la primera instrucción no compilada, efecto RAM sin prueba, divergencia o límite de 24 pasos; **no copia registros MAME en pasos intermedios**. El reporte agregado no incluye bytes ROM, operandos ni valores de registros.

**Sin nueva captura MAME:**

```bash
git pull --ff-only
node --test tests/test_r3_post_lda_frontier.mjs
node scripts/r3_post_lda_frontier.mjs
```

Compartir solo JSON agregado, en especial `status`, `first_unsupported`, `statically_compiled_steps_compared`, `first_divergence`. R3.5.B2 sigue pendiente de observación directa IRQ/SYNCACK; B5 no se permite presentar como equivalencia del wake de SYNC ni del bus completo. El siguiente paso B6 será traducir la primera instrucción real no soportada y medir el tramo.

---

## R3.6.B4 — Oráculo nativo de lectura sin handler para 0x3C00 (22/10/2026)

**B3 PASS acotado con evidencia Mac:** sintaxis y 6/6 tests locales correctos. El diagnóstico sobre la misma captura de 100 lecturas devuelve `UNIFORM_NATIVE_READS_REGISTER_CONSISTENT_BUS_CAUSE_UNVERIFIED`. Las 100 muestras posteriores al reset tienen valor idéntico, máscara de byte completa y cada valor observado reproduce el preestado de `LDA_EXT` en `0x6017→0x601A`. El mapa del driver identifica el operando ROM privado como **`0x3C00`: registro de escritura para disparar DMA de sprites**, sin `read` handler explícito. No se ha probado el valor de una lectura no mapeada ni la correlación causal de la instrucción.

**Fuente técnica independiente:** [MAME memory mappings](https://docs.mamedev.org/techspecs/memory.html) describe `map.unmap_value(...)` para lecturas sin handler; [MAME Lua Address map](https://docs.mamedev.org/luascript/ref-mem.html) expone el `space.map.unmap_value` **real de la máquina configurada**. [`gng_main_map`](https://github.com/mamedev/mame/blob/master/src/mame/capcom/gng.cpp) confirma `0x3C00` solo escritura. No deducimos 0x00 ni 0xFF sin observación del valor configurado.

**B4 implementado en `main`, verificación nativa pendiente:**

- `r2-mame-probe.lua`: con `GNG_R36_CAPTURE_UNMAP_POLICY=1` registra `R36_UNMAP_POLICY` directamente del mapa de programa MAME (opt-in, ancho 8 bits), separadamente del tap original. No cambia el valor leído ni instala un handler sustituto.
- `r3-unmapped-policy-capture.sh`: reutiliza la captura exacta, un soft reset y respaldo automático de evidencia anterior; una sola ejecución nativa. Evita el gate antiguo de muestra única que había rechazado correctamente las 100 lecturas.
- `r3_unmapped_read_policy.mjs`: revalida en la **misma captura** la ROM, los preestados CPU, las 768 escrituras sprite y SYNC; compara **cada uno** de los 100 bytes observados con la política que devuelve el mapa MAME. Solo entonces genera JS estático de bus **para lectura de la dirección exacta `0x3C00`** y lo usa como `readByte` del LDA generado, cotejando el checkpoint. El JS no usa el valor A del debugger ni el dato de una muestra seleccionada. Un acceso a otra dirección es error. La lectura NO ejecuta el DMA de sprites (efecto de escritura únicamente).
- `MAME_UNMAPPED_POLICY_MATCHES_NATIVE_TAPS_AND_STATIC_LDA` confirma **solo** la regla de lectura de ese registro en el modelo MAME y el resultado de esa instrucción con preestado inyectado. No comprueba la temporización, atribución precisa del tap a la instrucción, reanudación real de SYNC, IRQ, pila, ni autonomía continua hasta un frame. Nunca promocionar esto a R4.
- Tests ROM-free de política de lectura independiente, coincidencia de 100 muestras, pérdida de procedencia, duplicación de etiquetas, valores inconsistentes y límites del bus. CI incluye `node --check`.

**Ejecución Mac (una nueva captura MAME únicamente porque el TSV anterior NO registraba `space.map.unmap_value`):**

```bash
git pull --ff-only
node --test tests/test_r3_unmapped_read_policy.mjs
bash scripts/r3-unmapped-policy-capture.sh
```

Compartir solo `report.json` impreso, nunca ROM, los archivos `out/r2/` ni los módulos JS generados. La propiedad MAME de origen y la coincidencia de 100 muestras se informan como **booleanos**, sin volcar bytes privados al chat.

**Próximo hito B5:** localizar el primer PC real después de `0x601A`, ampliar el bloque estático según el CFG y al mismo tiempo certificar SYNC/IRQ con la instrumentación nativa preparada. El juego autónomo todavía no se ejecuta.

---

## R3.6.B3 — Diagnóstico offline de 100 lecturas nativas (22/10/2026)

**Captura real Mac R3.6.B2:** MAME terminó correctamente y conservó `17135` preestados; se registraron exactamente **100 lecturas** del operando MMIO de `LDA_EXT` en `0x6017`, todas **después del reset** y ninguna antes. El verificador rechazó `BLOCKED_AMBIGUOUS_NATIVE_MMIO_READ_SAMPLES`. **No es fallo del compilador ni prueba de divergencia CPU.** No seleccionar arbitrariamente un byte entre las 100 lecturas.

**Revisión del driver gngb:** [`gng_state::gng_main_map`](https://github.com/mamedev/mame/blob/master/src/mame/capcom/gng.cpp) tiene en `0x3800–0x3fff` mapeos explícitos **de escritura** (paleta extendida/base, sound latch, scroll, sprite DMA, main latch, bank select) y direcciones sin mapping; en ese rango **no declara un handler explícito de lectura**. Esto **no demuestra** que el resultado de la lectura sea constante ni cuál sea el valor de bus no mapeado.

**R3.6.B3 implementado:** `scripts/r3_mmio_read_diagnostics.mjs` relee **los mismos artefactos privados** `out/r2/mame-probe/`, revalida de forma independiente las 768 escrituras de sprites del boot y los dos SYNC nativos. Obtiene el operando de la ROM privada, clasifica el mapeo de escritura correspondiente, cuenta los valores distintos de las 100 lecturas y los tipos de máscara. Ejecuta la instrucción JS estática **para cada valor distinto** y compara con el preestado MAME de `0x601a`; no usa A como valor de entrada, no confía en el PC de callback Lua y no imprime valor alguno.

- Lecturas todas iguales y compatibles con el checkpoint: `UNIFORM_NATIVE_READS_REGISTER_CONSISTENT_BUS_CAUSE_UNVERIFIED`, **solo indicio de valor estable**. No implementa un literal constante como regla del hardware.
- Lecturas variables, máscaras parciales, sin muestras o inconsistentes: diagnóstico/bloqueo explícito, sin elegir el valor conveniente.
- Todos los estados conservan `native_bus_read_to_instruction_provenance_verified=false`, `autonomous_device_read_model_implemented=false` y `game_playable=false`. Los fixtures ROM-free deben pasar CI.

**Próximo paso en Mac, SIN ejecutar MAME de nuevo:**

```bash
git pull --ff-only
node scripts/r3_mmio_read_diagnostics.mjs
```

Compartir exclusivamente el resumen JSON. Luego decidir si instrumentar la regla de bus sin handler y su correlación CPU, o si los valores variables requieren modelar hardware. El gate de R4 sigue pendiente.

---

## R3.6.B2 — Lectura MMIO nativa acotada (22/10/2026)

**Hallazgo real aportado por el operador:** el JS estático de `LDA extended` en `0x6017` quedó bloqueado con `BLOCKED_UNVERIFIED_MEMORY_READ`; el operando pertenece a la ventana `0x3800..0x3fff`, y el siguiente preestado real de MAME está en `0x601a` (seq 779). Esta ventana incluye más dispositivos que la paleta: según `gng_main_map` del driver MAME, `0x3800..0x39ff` es paleta, `0x3a00` audio latch, `0x3c00` disparo DMA y `0x3e00` selección de banco; por tanto la etiqueta `PALETTE_OR_MMIO` es una clasificación **gruesa**, no una afirmación sobre el dispositivo leído. No se ha demostrado el dato devuelto por el bus.

**Implementado**:

- `scripts/r2-mame-probe.lua` añade `GNG_R36_TARGET_READ_ADDRESS` (opt-in). En el tap de lecturas de programa que ya existía, guarda únicamente las lecturas de **esa dirección exacta**, el byte retornado y la máscara de byte, con secuencia, época separada por el reset observado y contador de truncamiento (máximo 4096). El PC visible dentro del callback es **orientativo**, no etiqueta fiable de instrucción.
- `scripts/r3-mmio-read-capture.sh` obtiene la dirección **exclusivamente** de la ROM privada ya validada y el opcode `0xB6` en `0x6017`, comprueba que esté en `0x3800..0x3fff`, respalda `out/r2/mame-probe/` bajo `out/r3/probe-before-r36-mmio.*`, ejecuta un único laboratorio MAME con soft reset y sprite taps, y lanza el diferencial. No imprime dirección ni byte.
- `scripts/r3_mmio_read_gate.mjs` revalida la prueba de escrituras de sprites **en la misma captura**, el SYNC de ambos boots, y los preestados reales de `0x6017` y `0x601a`. Exige lectura nativa única en la segunda época y máscara `255`; ejecuta el LDA compilado usando el byte **leído desde el tap MAME**, nunca el registro A resultante. Compara PC y registros y solo si coinciden devuelve `SINGLE_NATIVE_READ_CONSISTENT_NOT_INSTRUCTION_CORRELATED`.
- Si la lectura está ausente, duplicada, truncada o diverge, se devuelve error/estado bloqueado; **sin forzar un valor**. Incluso con coincidencia la lectura no está vinculada causalmente a la instrucción y **no existe todavía** modelo autónomo del dispositivo MMIO. No declarar R3.6.B ni R4 PASS.
- Tests ROM-free sobre consistencia, lecturas múltiples, máscaras, truncamiento, fuente exacta y preestados adulterados. [CI PASS](https://github.com/krukmat/gng-ghidra/actions/runs/39770466913).

**Prueba local siguiente (esta vez sí ejecuta MAME; no requiere Ghidra ni binario instrumentado):**

```bash
git pull --ff-only
bash scripts/r3-mmio-read-capture.sh
```

Compartir solo JSON resumido `status`, `native_samples_after_reset`, `generated_js_checkpoints_compared` y `first_divergence`. **No compartir** ROM, módulo generado, TSV de lecturas ni trace. Si el MMIO devuelve un valor variable, el siguiente trabajo es identificar el dispositivo concreto y su semántica, no grabar un valor de una captura en el runtime.

---
## R3.6.B1 — primera instrucción post-SYNC traducida (22/10/2026)

El operador confirmó **R3.5.B1** `RESET_BOUNDARY_CONFIRMED_MASKED_WAKE_CAUSE_NOT_OBSERVED` y **R3.6.A** `POST_SYNC_OPCODE_FRONTIER_IDENTIFIED`: primer PC post-SYNC = `0x6017` e instrucción `LDA extended`, precedida por espera `SYNC` con IRQ/FIRQ enmascaradas. La causa efectiva del wake continúa sin certificarse.

**Implementado en `main`:** `scripts/r3_lda_extended_gate.mjs` valida byte opcode `0xB6` en PC `0x6017` dentro de la imagen 64KiB privada, y genera un módulo estático `executeLdaExt` (sin decoder) cuyo operando extendido queda embebido de los bytes auténticos. La ejecución exige una función `readByte` explícita y actualiza A, N/Z/V y PC según MC6809; rechaza PC/callback/valor incorrectos. No copia nunca el registro A de MAME como dato leído.

**Modelo de procedencia de memoria:**

- Si lee ROM fija `0x6000..0xffff`, el valor se obtiene de la propia imagen validada.
- Si lee sprite RAM `0x1e00..0x1fff` **y** la dirección fue escrita en el bucle inicial, se reconstruye del historial del JavaScript que ya pasó R3.3 (192 palabras por boot, comparadas como 768 bytes nativos en total). No se presupone valor para el resto.
- Si lee RAM de trabajo desconocida, video RAM, MMIO de entrada/paleta u otra región dinámica o ROM bancaria, se devuelve `BLOCKED_UNVERIFIED_MEMORY_READ` hasta observar directamente la dirección y valor en MAME con una captura específica; no se inventa memoria.
- Solo si existe un preestado nativo posterior se coteja el resultado JS de una instrucción contra PC/A/B/X/Y/U/S/DP/CC; no se presume que la línea que despertó SYNC fue una IRQ.

Tests ROM-free cubren N/Z/V, lectura fija, sprite RAM validada, rechazo de MMIO/otros bancos/RAM no inicializada y ausencia de fake reads. [CI PASS](https://github.com/krukmat/gng-ghidra/actions/runs/39766056369). **Validación con ROM y pretrace reales aún pendiente en el Mac**.

**Siguiente ejecución sin MAME adicional:**

```bash
git pull --ff-only
node scripts/r3_lda_extended_gate.mjs
```

Reportar el JSON `operand_region`, `status`, `native_next_pc`, `generated_js_step_compared`. El script no imprime ni exporta el operando crudo o bytes ROM; todo lo derivado queda en `out/r3/lda-extended/` privado. Un resultado `BLOCKED_UNVERIFIED_MEMORY_READ` identifica exactamente la necesidad de instrumentar la siguiente lectura; es un bloqueo esperado, no una divergencia de CPU.

**Próximos gates:** captar valor MMIO/RAM dinámico real si hace falta; ampliar el siguiente bloque de instrucciones después de `0x601a`; certificar `SYNC` wake con el binario MAME instrumentado por B2 para conseguir ruta continua real. R4 no está cerrado.

---
## Bloque crítico A — avanzar en el ROM con la evidencia actual

**A1. Reset vs SYNC (B1)**

- A1.1 Revalidar las dos épocas ROM + CPU + escrituras de RAM.
- A1.2 Exigir SOFT_RESET_REQUESTED → RESET_NOTIFICATION, y no atribuir el
  primer salto a IRQ.

**A2. Encuesta post-SYNC (R3.6.A; depende de A1 y R3.3)**

- A2.1 Identificar el opcode soportado o la primera instrucción ausente
  a partir del PC nativo real 0x6017; no usar bytes ni registros inventados.
- A2.2 Generar un resumen seguro de PC/familia; no afirmar que JS haya
  superado SYNC ni que exista aceptación IRQ.

**Ejecución inmediata en Mac, sin nuevo MAME:**

~~~bash
git pull --ff-only
node scripts/r3_sync_reset_causality.mjs
node scripts/r3_post_sync_frontier.mjs
~~~

Compartir SOLO los dos JSON resumidos. No subir ROM, los archivos en
out/r2/mame-probe, los módulos generados ni eventos de bus.

**Gate para R3.6.B:** conocer el primer opcode real posterior a 0x6017;
implementarlo con semántica MC6809 y comprobar registros, RAM y MMIO según
corresponda antes de conectar el siguiente bloque continuo.

## Bloque crítico B — evidencia de IRQ/SYNCACK nativa

**B1. Fuente MAME instrumentada (implementada como generador, no compilada)**

- B1.1 En un árbol fuente MAME local **separado**, ejecutar:

~~~bash
python3 scripts/r3_prepare_native_mame_hook.py \
  --mame-source /ruta/a/mame-src
~~~

El script exige los anchors actuales del núcleo y escribe **copias** de
m6809.cpp y base6x09.lst bajo out/r3/native-mame-overlay/src/... .
No modifica la instalación Homebrew, el repo original ni el binario. Si
la revisión MAME no coincide, bloquea el proceso.

- B1.2 Aplicar las copias a un *worktree experimental* de MAME, compilar
  y conservar el hash del binario. No automatizamos una compilación pesada
  en este proyecto sin fuente/build disponibles. El núcleo instrumentado
  registra CPU_RESET, LINE_DELIVERED, SYNC_ENTER, SYNC_EXIT, IRQ_ENTRY y
  VECTOR_FETCH con contador de ciclos. Las llamadas del núcleo registran
  señales **reales** en vez de reconstruirlas desde el PC. Los callbacks
  estándar de MAME y el juego no se sustituyen.

**B2. Oráculo y comparación (preparado, validación real pendiente)**

- B2.1 Con el binario compilado realmente desde el código parcheado,
  ejecutar en el Mac:

~~~bash
GNG_R3_MAME_BIN=/ruta/al/mame-instrumentado \
  bash scripts/r3-native-irq-verify.sh
~~~

Se rechazan binarios no indicados explícitamente o sin el marcador
instrumentado. El wrapper respalda out/r2/mame-probe antes de ejecutar,
usa -oslog dentro de la captura privada y vuelve a analizar preestados
y escrituras de sprites. **La presencia del marcador en el ejecutable
no autentica la compilación**.

- B2.2 El analizador r3_native_irq_report.mjs exige una afirmación de
  línea IRQ/FIRQ/NMI observada entre SYNC_ENTER y SYNC_EXIT, junto con
  el nivel real de las líneas en la salida. Sin ese evento, no confirma
  la causalidad. Distingue señal enmascarada de IRQ_ENTRY/VECTOR_FETCH;
  no declara equivalencia de pila/vector ni de JS. Todos los datos crudos
  se mantienen en out/ privado.

**Gate B2:** muestra directamente la entrega de IRQ, la salida de SYNC,
y cuando haya entrada a handler, la aceptación y vector. Hasta observarlo,
R3.5.B2 = PENDING aunque todos los tests sintéticos sean PASS.

## Bloque crítico C — primer frame autónomo (R3.6.B → R4)

- C1. Extender recompilación estática para el siguiente bloque real,
  trabajando por CFG/PC y contratos de memoria (no opcodes arbitrarios).
- C2. Modelo de bus mínimo del juego: RAM, MMIO de scroll/paleta,
  bank select, DMA de sprites y reloj de VBLANK; comparar efectos nativos.
- C3. Conectar con renderer R1, **sin cargar un frame MAME como entrada**.
- C4. Comparar hash de frame y estado con el oráculo y rechazar la
  primera divergencia. Aceptar R4 solo con al menos un frame producido
  por runtime JS original en forma autónoma.

### Reglas operativas

1. No confundir CI ROM-free con PASS de hardware MAME real.
2. No admitir eventos generados manualmente como captura nativa.
3. No compartir código ROM-derived ni datasets de CPU y memoria.
4. No instalar un intérprete 6809 en el runtime final para eludir R3.
5. Si el compilador alcanza un límite hardware, modelar y certificar
   solo la capacidad que se necesita para llegar a R4.
