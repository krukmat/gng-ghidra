# Plan operativo v2 — del fotograma real al juego recompilado

**Fecha de revisión:** 2026-10-22  
**Fuente de verdad de tareas:** [issues R0–R6](https://github.com/krukmat/gng-ghidra/issues?q=is%3Aissue+is%3Aopen) y este documento.  
**Historial de visores V0–V1.3:** [roadmap anterior](roadmap.md); **contrato técnico R0:** [frame-oracle.md](frame-oracle.md).

## 1. Objetivo y cambio de estrategia

Entregar *Ghosts 'n Goblins* ejecutando **lógica original MC6809 recompilada a JS/TS**, sin un intérprete de opcodes MC6809 como motor del producto. La ROM sigue siendo privada, en el Mac del operador. MAME o un núcleo MC6809 independiente pueden usarse **exclusivamente como oráculo de laboratorio**.

**Se congela la expansión de rutinas aisladas del pipeline Ghidra P-code → IR → JS.** No se elimina el trabajo realizado ni se descarta Ghidra: el pipeline existente sigue como referencia y Ghidra ayuda a descubrir bloques, CFG y bancos. Se evalúa una **vía alternativa de recompilación directa instrucción 6809 → bloques JS** contra el mismo oráculo. La elección final dependerá de evidencia diferencial, no de preferencias arquitectónicas.

La prioridad ya no es producir más escenas de diagnóstico. **V1.2 fue rechazado visualmente**: su collage determinista de tiles auténticos no es un nivel real. Ningún fixture se podrá presentar como fotograma ejecutado.

## Reparación A0.6.3: recuperación offline de captura existente (22/10/2026)

Tras la captura real, MAME exit=0, 17.135 preestados, B4 MMIO `PASS` y A0.4 VRAM **4096/4096 PASS**. La suite ROM-free tuvo 58/60: dos errores causados por un fixture bancario con una transición `NOP` imposible. Corregido a `LDA → JMP` con transición entre bancos fuera del segmento bancario.

A0.6.3 falló `A063_TRACE_MARKERS_NOT_SAME_INSTRUCTION`. **No prueba un problema de ROM ni de banco**: el parser anterior suponía campos de firma exactamente de dos dígitos y un único formato de línea. El parser nuevo acepta anchos hexadecimales variables dentro del rango byte y emite diagnóstico **de formas, sin datos ROM/CPU** cuando la misma línea no contiene ambos marcadores. No se permite correlacionar a ciegas marcadores de líneas distintas. **A0.6.3/A0.6.4 siguen pendientes de gate real.**

```bash
git pull --ff-only
bash scripts/r3-local-regression.sh
bash scripts/r3-banked-critical-path.sh
```

Este último proceso usa solamente la captura ya generada. Si falla, compartir solo su JSON diagnóstico `gng.a06.bank-trace-shape-diagnostic.v1` y la línea de error. **No repetir MAME** hasta ver la forma real de la traza. No GitHub Actions.

---

## Ruta crítica ejecutada: A0.6.3 → A0.6.4 (22/10/2026)

**A0.6.1–A0.6.2 cerradas con evidencia real Mac:** 55 tests Node y 6 Python PASS; 5 imágenes de banco CRC auténticas (40.960 B), 7.434 prestates bancarios/7 PCs distintos; banco inicial observado 0 y un control write a `0x3e00` hacia banco 3. No convertir muestras por frame en atribución de banco por instrucción.

**Implementado en `main` sin GitHub Actions y sin rehacer el compilador:**

- **A0.6.3:** `r3_bank_provenance.py` identifica una pareja de offsets donde los 5 bancos ROM se diferencian. `r2-mame-probe.sh` incorpora opcionalmente ambos valores en la **misma instrucción** del debugger que PC + registros mediante accesos `b@` (sin efectos secundarios). El parser exige 1:1 PC/seq/firma y compara con bytes autenticados. Los datos completos permanecen privados. Se emite witness privado por prestate y manifiesto SHA256 vinculado a los archivos de esa captura; se separan cambios de reset de transiciones normales y se identifica qué cambio viene después de un STB/STA ROM-attested a `0x3e00`. La captura nativa aún NO está verificada.
- **A0.6.4:** `compileAt(...,{banked:true})` permite codegen AOT **solo si** el caller le proporciona la imagen concreta del banco, con límite 0x5fff y rechazo default de PCs bancarios. `r3_banked_static_gate.mjs` exige A0.6.3 + manifiesto de la misma traza, revalida sprites/SYNC del mismo run y genera módulos JS privados independientes por banco, comparando instrucciones sin efectos RAM desde cada preestado MAME. Informa familias sin soporte y divergencias, no CPU autónoma ni MMIO/IRQ equivalentes.
- Tests sintéticos nuevos Python y Node para ambigüedad, truncamiento, procedencia, selector, mismo PC con distintos bancos y límite de imagen. Añadidos a `r3-local-regression.sh`. **Sin GitHub Actions.**

```bash
git pull --ff-only
bash scripts/r3-local-regression.sh
bash scripts/r3-bank-provenance-capture.sh
```

El tercero realiza **una nueva captura MAME**, con backup privado del R2 anterior y gates B4/A0.4, y después genera informes agregados A0.6.3 y A0.6.4. Para repetir solo el análisis: `bash scripts/r3-banked-critical-path.sh` (sin MAME). Comparte solo los JSON, nunca `out/` ni firmas/bytes ROM.

**No se puede completar R4 con el acceso actual al Mac:** las evidencias bancarias por instrucción y señal IRQ/SYNCACK requieren ejecución nativa del operador; R3.5.B2 sigue siendo dependencia paralela. A0.6.4 está implementado, no certificado con datos reales.

---

## A0.5.B real PASS → A0.6 private five-bank ROM (22/10/2026)

**Último resultado Mac:** regresión local 52/52 PASS y `r3_video_board_integration.mjs`: `NATIVE_VRAM_IMAGE_MATCHED_STATIC_JS_BOARD_AND_TILE_DECODER`, con 4096 bytes RAM de vídeo finales idénticos al tap independiente MAME y 2048 registros de tile decodificados sin divergencia. **A0.5.B aceptado**, con preestados MAME por instrucción; todavía no equivale a fotograma ni a CPU autónoma desde reset.

**A0.6.1–A0.6.2 implementados** en el repositorio actual: `scripts/r3_bank_inventory.py` usa la autenticación ROM previa del ZIP `roms/gng.zip` (CRC, tamaño, vector reset) y conserva el `out/gngb-flat.bin` ya verificado; extrae una imagen privada de **5 bancos × 8 KiB** exclusivamente bajo `out/r3/banked-rom/`. Entradas 0–3: cuatro porciones de `gg5.bin`; entrada 4: primera porción de `gg4.bin`. Contrato `gngb`: ventana CPU `0x4000–0x5fff`, escritura de selección en `0x3e00`, `data===4 ? 4 : data&3` (MAME `gng.cpp`). `src/gngb_banked_rom.mjs` implementa solo lectura de ROM e identifica banco inicial como **desconocido hasta que se seleccione explícitamente**; no usa un intérprete ni supone que un tap en `0x3e00` ya procesó su handler.

El inventario cuenta PCs de la traza y observa bancos por frame/escritura, pero **no atribuye automáticamente un banco a cada PC**. Las 7434 muestras en `0x4000–0x5fff` siguen sin demostrar identidad de ROM por instrucción ni transición post-handler. No se proclama recompilación de esos bancos con datos de frame. Se añaden 9 tests ROM-free (6 Python + 3 Node) al runner local; **GitHub Actions sigue eliminado**.

```bash
git pull --ff-only
bash scripts/r3-local-regression.sh
python3 scripts/r3_bank_inventory.py
```

Compartir solo el reporte JSON. **A0.6.3**: instrumentar identificador de banco activo en la frontera de cada preinstrucción y transición real post-`bankswitch_w`, enlazado con secuencia/PC; requerirá una captura nativa *solo después* de preparar esa instrumentación. IRQ/SYNCACK (R3.5.B2) permanece en paralelo. Ver [ruta crítica](r3-critical-path.md).

---

## A0.4 PASS real; A0.5.B native VRAM → board → renderer tile decoder (22/10/2026)

El operador completó **47/47 tests locales**, nueva captura MAME y el gate A0.4 con `NATIVE_VIDEO_WRITES_MATCH_GENERATED_STATIC_JS`: 4096 escrituras generadas y 4096 nativas, misma dirección, byte, máscara y orden, **0** eventos extra, **4096** registros coincidentes, sin divergencia. B4 (lectura no mapeada) sigue PASS. Esto valida la secuencia de VRAM dentro del laboratorio, pero **no la CPU autónoma desde reset**.

**Nuevo A0.5.B implementado:** `src/gngb_video_bridge.mjs` y `scripts/r3_video_board_integration.mjs`. Revalidan R3.3/SYNC/A0.4 con la misma captura, ejecutan los cuatro sites ya compilados mediante el **adaptador RAM/VRAM existente**, y contrastan la imagen final de 4096 bytes con la de MAME, además de 2048 decodificaciones de tiles mediante `readTile`/ `board.tile`. Se exigen direcciones únicas, máscara completa, cobertura total y registros CPU correctos; ninguna ROM o valor de imagen privado sale en reportes. **Se reutiliza el renderer, no hay intérprete MC6809 ni Github Actions**.

Prueba ROM-free sintética A0.5.B: 5/5 PASSED en el laboratorio parcial local; pendiente la ejecución integrada en el Mac:

```bash
git pull --ff-only
bash scripts/r3-local-regression.sh
node scripts/r3_video_board_integration.mjs
```

El último comando **no arranca MAME** ni cambia los archivos de captura originales. Su PASS es un puente RAM→tile decoder, **no R4**. Próximo bloque: procedencia y selección de ROM bancaria para 7.434 preestados y causa IRQ/SYNCACK independiente. Ver [ruta crítica](r3-critical-path.md).

---

## A0.5-LAB — Board RAM/VRAM mínimo, sin CI remota (22/10/2026)

**Se conserva el compilador estático R3 y toda la evidencia R0–A0.3.** El nuevo módulo `src/gngb_board_memory.mjs` integra los sinks byte/word con RAM principal, sprite RAM y FG/BG; reutiliza `video_memory.mjs` / `sprite_memory.mjs`. Exige que cada byte haya sido escrito antes de permitir leerlo, genera copias aisladas para el renderer, y rechaza ROM bancaria, MMIO sin modelar y escritura DMA no certificada. Las escrituras de instrucciones generadas tienen commit atómico. No asume cold boot ni interrupciones.

`tests/test_gngb_board_memory.mjs` verifica localmente la mecánica de una secuencia **sintética** de 4.096 escrituras y las condiciones de bloqueo; no acredita buses MAME ni juego autónomo. No hay GitHub Actions en el repositorio; para revisar todos los módulos con el checkout real se añadió:

```bash
git pull --ff-only
bash scripts/r3-local-regression.sh
```

**A0.4 continúa pendiente**: `bash scripts/r3-video-write-capture.sh` corre MAME una vez y compara dirección, byte, máscara y orden de las escrituras nativas. Después: board basado en evidencia real, ROM bancaria e IRQ/SYNCACK. Ver [ruta crítica](r3-critical-path.md).

---

## A0.4 — Video RAM write equivalence gate (22/10/2026)

A0.3 real Mac: `4.096/4.096` checkpoints nativos iguales para `STA/STB indexed` (X+/Y+), todas las escrituras **predichas** apuntan a VRAM; sin divergencia. El perfil AOT sube a `9.689/17.135 = 56,55%` **de las instrucciones observadas**, frente a 8,13% al inicio de A0, pero la ROM bancaria (7.434) y los accesos de bus nativos siguen pendientes. Restan 12 muestras de ROM fija sin codegen.

**Implementado:** tap MAME opt-in de escritura VRAM 0x2000–0x2fff (byte/máscara/orden/epoch, límite 32768), wrapper de una sola ejecución que preserva las capturas anteriores y revalida B4, y `r3_native_video_write_gate.mjs`. Compara un **segmento único y ordenado de 4.096 escrituras** generado por JS desde cada preestado con eventos reales MAME, sin publicar direcciones/bytes. Se rechazan secuencias incompletas, truncadas, sin orden, duplicadas o diferentes; no se asume correlación precisa tap/instrucción, IRQ o juego autónomo. Tests ROM-free y CI PASS.

```bash
git pull --ff-only
bash scripts/r3-video-write-capture.sh
```

**Siguiente tras gate nativo:** integrar VRAM al board runtime y avanzar bancos; IRQ/SYNCACK sigue en paralelo. **No marcar R4 completo.** Ver [ruta crítica](r3-critical-path.md).

---

## A0.3 — Compilador indexado y comparador de 4 sites (22/10/2026)

**Resultado real operador:** A0 subió de 1.393/17.135 (8,13%) a 5.593/17.135 (32,64%) muestras elegibles tras A0.2. B5 verificó 5 pasos de NOP×3, DEC_B y BNE, regresando a SYNC `0x6016` sin divergencia; causa del wake todavía desconocida. Las 4.096 muestras sin soporte más repetidas son `STA/STB_INDEXED` en `0x6041`, `0x6043`, `0x6055` y `0x6057`.

**A0.3 implementado, CI ROM-free PASS:** `compileAt` admite modos indexados directos de dos bytes; `emitStaticModule` genera una única escritura byte a un sink de memoria explícito sin runtime intérprete. Indirectos y offsets con bytes extras se rechazan hasta completar evidencia del ROM. Nuevo `r3_indexed_store_gate.mjs` revalida prueba R3.3 + SYNC y compara **solo registros** para esos cuatro PCs contra preestados nativos, con resumen de modo e impactos predichos por región. No compara todavía taps nativos de memoria. Los gates viejos y B5 no se promocionan automáticamente a PASS de bus.

```bash
git pull --ff-only
node scripts/r3_indexed_store_gate.mjs
node scripts/r3_dynamic_coverage.mjs
```

**A0.4:** examinar la región de escritura observada y preparar un tap independiente MAME para certificar dirección/byte/máscara. **En paralelo:** causa nativa de IRQ/SYNCACK y cobertura de bancos `0x4000–0x5FFF`. La cifra de elegibilidad AOT no es progreso integral del juego. Ver [ruta crítica](r3-critical-path.md).

---

## A0.2 — Primer lote del compilador guiado por la cobertura REAL (22/10/2026)

El operador obtuvo 17.135 preestados / 62 PCs; solo 1.393 (8,13%) elegibles previamente para AOT (sin prueba de runtime), 8.308 muestras ROM fija no soportadas y 7.434 muestras en ROM bancaria no autenticada. **8.192 de las 8.308** se concentran en dos bucles de 8 PCs que combinan escritura indexada A/B, CMPX inmediato y saltos cortos. B5 confirmó tres NOP en `0x601A–0x601C`, deteniéndose en una operación unary en `0x601D`, sin divergencia.

**Implementado en `main`:** corrección de ranking de familias (error `.hits` frente a `.samples` que anteponía 104 hits a 2.048); compilación estática reutilizable de 22 operaciones unary A/B, CMPX inmediato y 16 saltos cortos en `r3_static_trace_probe.mjs`. Pruebas exhaustivas sobre semántica ROM-free y regresiones, CI PASS. Todo el trabajo de R0–R3 y B4 se conserva; no se crea un intérprete.

**Validación real pendiente:**

```bash
git pull --ff-only
node scripts/r3_dynamic_coverage.mjs
node scripts/r3_post_lda_frontier.mjs
```

Solo resultados agregados. A0.3: implementar variantes de `STA/STB_INDEXED` basadas en el **postbyte real**, certificando sus escrituras, y estudiar ROM bancaria para no confundir 7.434 muestras de banco con fijo. Seguir con instrumentación IRQ/SYNCACK en paralelo. Ver [ruta crítica](r3-critical-path.md).

---

## A0 — Aceleración incremental por cobertura (22/10/2026)

**No se descarta ni reemplaza R0–R3.6.** Se añade un profiler a la **implementación actual** para priorizar familias de instrucciones y construir lotes de bloques. Se prohíbe confundir cobertura de PCs muestreados con porcentaje de juego recompilado.

- **A0.1 (implementada, CI ROM-free PASS):** `scripts/r3_dynamic_coverage.mjs` revalida prueba real R3.3 de RAM sprites, doble SYNC y reset desde los archivos privados del Mac; calcula frecuencias de PC, categorías AOT del compilador existente, ROM bancaria no autenticada y familias/opcodes pendientes. Emite `out/r3/dynamic-coverage/report.json` sin bytes ROM, registros ni código generado.
- **A0.2 (pendiente del JSON real):** seleccionar familias con mejor rendimiento potencial (frecuencia + diversidad de PC), en lugar de modificar a ciegas `compileAt`.
- **A0.3 (pendiente):** refactor incremental de semántica común y validación diferencial por lotes, conservando gates actuales.
- **B5:** el gate existente `r3_post_lda_frontier.mjs` se mantiene como prueba separada de continuación desde `0x601A`; su validación real no ha llegado aún.
- **IRQ/SYNCACK:** permanece el bloque R3.5.B2 con la instrumentación nativa existente, sin declarar equivalencia solo por perfiles.

```bash
git pull --ff-only
node --test tests/test_r3_dynamic_coverage.mjs
node scripts/r3_dynamic_coverage.mjs
```

Solo reportar JSON agregado. No hace falta capturar MAME otra vez. Detalles y límites: [ruta crítica](r3-critical-path.md).

---

## R3.6.B4 real PASS; R3.6.B5 post-LDA frontier (22/10/2026)

**Operador Mac:** `MAME_UNMAPPED_POLICY_MATCHES_NATIVE_TAPS_AND_STATIC_LDA` para `LDA_EXT` PC `0x6017`, operando `0x3C00`; 100 lecturas reales, todas iguales al `space.map.unmap_value` obtenido independientemente del mapa MAME; el JS estático reproduce registros del checkpoint `0x601A` (`first_divergence=null`). B4 **validado en alcance acotado**. El wake IRQ/SYNC, causalidad CPU bus y R4 siguen pendientes.

Nuevo `r3_post_lda_frontier.mjs`: revalida todos los artefactos privados B4 actuales, genera JS estático para los opcodes conocidos después de `0x601A` y coteja registros de pasos sucesivos desde una sola semilla de CPU. Para efectos de RAM no certificados o instrucciones sin compilar, detiene la ejecución en lugar de inventar memoria, sin declararla jugable.

```bash
git pull --ff-only
node --test tests/test_r3_post_lda_frontier.mjs
node scripts/r3_post_lda_frontier.mjs
```

Compartir únicamente JSON agregado. Ver [ruta crítica](r3-critical-path.md).

---

## R3.6.B4 — Política nativa de lectura sin handler, PC 0x6017 (22/10/2026)

**B3 Mac confirmado:** 6/6 tests, `UNIFORM_NATIVE_READS_REGISTER_CONSISTENT_BUS_CAUSE_UNVERIFIED`; 100/100 lecturas iguales tras reset, compatibles con preestado `0x601A`. Operando de `LDA extended` = **0x3C00**, que `gng_main_map` solo mapea para **escribir y disparar DMA**, sin handler CPU de lectura. No inferimos el byte por repetición.

**B4:** sonda Lua opcional lee la **configuración `space.map.unmap_value`** de MAME (independiente del tap y del registro A); se exigen todas las lecturas de la dirección exacta iguales a esa política antes de generar un `readGngbUnmappedByte` estático para 0x3C00. El JS de lectura nunca dispara DMA. Aun con todos los checks, IRQ/SYNC wake, causalidad fetch/read y bus completo siguen PENDIENTES.

```bash
git pull --ff-only
node --test tests/test_r3_unmapped_read_policy.mjs
bash scripts/r3-unmapped-policy-capture.sh
```

Una nueva captura MAME es necesaria porque el TSV anterior no recogía la propiedad de configuración del mapa. Se realiza backup bajo `out/r3/`. Compartir solo JSON resumido. Ver [ruta crítica](r3-critical-path.md).

---

## R3.6.B3 — Diagnóstico de 100 lecturas repetidas (22/10/2026)

La ejecución nativa real tuvo **100 lecturas exactas** del operando de `LDA extended` en `0x6017`, todas posteriores al reset, `pretrace=17135` y `BLOCKED_AMBIGUOUS_NATIVE_MMIO_READ_SAMPLES`. Se ha confirmado que el mapeo `gngb` declara handlers de escritura en el rango, pero no de lectura explícita; sin valor de bus independiente todavía.

`scripts/r3_mmio_read_diagnostics.mjs` analiza **todas** las muestras de la última captura privada, comprueba uniformidad, máscaras, subregión del driver y congruencia con el checkpoint de `0x601a` usando JS estático, sin escoger arbitrariamente ninguna muestra y sin afirmar semántica de hardware. Tests ROM-free incorporados a CI.

```bash
git pull --ff-only
node scripts/r3_mmio_read_diagnostics.mjs
```

Si las 100 lecturas coinciden, es un **diagnóstico de estabilidad**, no un modelo del bus; la regla de retorno del dispositivo y la vinculación a PC `0x6017` siguen pendientes de certificar. Ver [ruta crítica](r3-critical-path.md).

---

## R3.6.B2 — Targeted MMIO read, bloqueo real tras 0x6017 (22/10/2026)

El operador confirmó `BLOCKED_UNVERIFIED_MEMORY_READ` en `LDA extended` PC `0x6017`: operand region `PALETTE_OR_MMIO` (`0x3800..0x3fff`), siguiente preestado PC `0x601a`. No hay divergencia demostrada. Esta región incluye mapeos de paleta, audio, DMA y banco, por lo que no hay que asumir el dispositivo.

Implementados: tap MAME opt-in de **la dirección exacta ROM-derived** con época de reset, byte/máscara y contador; wrapper con respaldo previo; comparador JS vs dato de tap y registros de MAME para un único evento en la segunda época, tras revalidar sprites y SYNC. Por limitaciones de Lua, el PC visto en la lectura es una sugerencia, no vinculación causal, y el PASS de coincidencia se limita a `SINGLE_NATIVE_READ_CONSISTENT_NOT_INSTRUCTION_CORRELATED`. CI ROM-free PASS.

```bash
git pull --ff-only
bash scripts/r3-mmio-read-capture.sh
```

Requiere un único MAME nativo adicional con tap exacto. Solo compartir el resumen JSON, nunca datos privados. Si hay duplicados, cero lecturas o divergencia, diagnosticar con cautela; no inventar byte MMIO ni afirmar R4. Ver [contrato](r3-critical-path.md).

---
## Ruta crítica R3.6.B1 — LDA extended post-SYNC (22/10/2026)

El operador aportó B1 real `RESET_BOUNDARY_CONFIRMED_MASKED_WAKE_CAUSE_NOT_OBSERVED` y R3.6.A real `POST_SYNC_OPCODE_FRONTIER_IDENTIFIED` en PC `0x6017`, opcode `LDA_EXT`. Esta selección resuelve la incertidumbre de qué traducir, **no** la causalidad IRQ.

Nuevo `scripts/r3_lda_extended_gate.mjs`: compila un `LDA extended` específico desde ROM fija en PC `0x6017`; genera JS estático con lector `readByte` obligatorio y actualiza A/N/Z/V/PC. Solo admite valores independientes: ROM fija o bytes de sprite RAM escritos en R3.3 y verificados con taps de MAME en dos boots. Desconocidos de RAM, MMIO, vídeo o banco se bloquean, sin usar MAME A como read-value. Pruebas ROM-free CI PASS; la comparación nativa posterior está pendiente.

```bash
git pull --ff-only
node scripts/r3_lda_extended_gate.mjs
```

Compartir solo JSON agregado (`status`, `operand_region`, `native_next_pc`, `generated_js_step_compared`). Si `BLOCKED_UNVERIFIED_MEMORY_READ`, hay que instrumentar exactamente esa lectura; si hay `MATCHED_...`, se valida un **solo paso LDA** con fuente conocida, pero no la salida de SYNC ni el bus completo. Ver [ruta crítica](r3-critical-path.md).

---
## Ruta crítica activa — 22/10/2026: R3.5.B1/B2 y R3.6.A

Plan detallado, dependencias y gates: [Ruta crítica R3→R4](r3-critical-path.md). Esta actualización prevalece sobre los bloques históricos posteriores.

**Implementado en main:** inspección offline del primer opcode real tras 0x6017 (`scripts/r3_post_sync_frontier.mjs`); generación no destructiva de overlay nativo MC6809 con eventos IRQ/SYNCACK/RESET/VECTOR (`scripts/r3_prepare_native_mame_hook.py`); parser estricto (`scripts/r3_native_irq_report.mjs`); launcher opt-in para binario MAME instrumentado (`scripts/r3-native-irq-verify.sh`). Hay pruebas ROM-free, pero **no** binario MAME instrumentado compilado ni evidencia IRQ directa aún.

**Validación inmediata sobre Mac, reutilizando capturas existentes:**

```bash
git pull --ff-only
node scripts/r3_sync_reset_causality.mjs
node scripts/r3_post_sync_frontier.mjs
```

Compartir solo JSON agregado. Después implementar el siguiente bloque JS real. En paralelo, obtener fuente MAME en un worktree separado y compilar la instrumentación para B2. R4 (primer frame generado autónomamente por JS) sigue PENDIENTE.

---
## R3.5.B1 — Causalidad reset vs SYNC delimitada (22/10/2026)

R3.5.A produjo dos preestados auténticos de `SYNC` en `0x6016`: primero seguido por `0x6000` durante una ejecución con soft reset explícito, segundo seguido por `0x6017` con IRQ/FIRQ enmascaradas. No hay evidencia de señal IRQ efectiva. Fuente GNG: VBLANK conecta al IRQ del CPU en `gng.cpp`, **eso no prueba** que la señal se afirmara en el instante observado.

Se implementó `r3_sync_reset_causality.mjs`: revalida ROM+pretrace+taps y orden de `SOFT_RESET_REQUESTED`/`RESET_NOTIFICATION`; clasifica los dos casos por separado y mantiene estado `RESET_BOUNDARY_CONFIRMED_MASKED_WAKE_CAUSE_NOT_OBSERVED`. Tests sintéticos para orden inválido, resets duplicados y PC/CC no esperados; CI ROM-free.

```bash
git pull --ff-only
node scripts/r3_sync_reset_causality.mjs
```

Para **B2** se requiere instrumentar directamente el evento de entrada IRQ/FIRQ/NMI y el ACK de SYNC a nivel núcleo/driver MAME. Evitar presentar VBLANK o next PC como equivalencia IRQ confirmada.

---

## R3.5 — SYNC 0x6016; falta certificar IRQ real (22/10/2026)

El operador confirmó `FRONTIER_IDENTIFIED_NOT_COMPILED` en los dos boots: `0x6016`, familia `SYNC`, secuencias `388` y `778`. El core MC6809 de MAME confirma que **SYNC despierta incluso con IRQ/FIRQ enmascaradas**; una señal no enmascarada requiere entrada de interrupción con pila/vector.

Se implementó generador JS estático para `SYNC` limitado al byte `0x13` real en `0x6016`, con estados `SYNC_WAIT`, `RUNNABLE_AFTER_MASKED_WAKE` e `INTERRUPT_ENTRY_REQUIRED`. Sin señal externa afirmada el estado no avanza. La fase de entrada IRQ queda bloqueada explícitamente; no hay simulación de stack ni señal inventada. Tests ROM-free y diagnóstico sobre los dos puntos del pretrace aprobados en CI.

**Siguiente paso Mac, sin lanzar MAME:**

```bash
git pull --ff-only
node scripts/r3_sync_boundary.mjs
```

Compártenos el JSON agregado para saber cuál es el próximo PC registrado y las máscaras CC; **ningún PC por sí solo acredita una IRQ real**. Luego se debe instrumentar señal y aceptación IRQ independientemente para permitir al JS cruzar esa barrera y extender el flujo del juego.

---

## R3.3 PASS real — 768/768 bytes; R3.4 diagnóstico post-boot (22/10/2026)

**Aceptado por evidencia operador:** `PASS_BOOT_SPRITE_RAM_WRITE_BYTES`: 2 ciclos de inicialización MC6809, 384 bytes escritos por ciclo observados directamente en MAME, **768/768** en total, cero diferencias de dirección, valor y orden, cero otras escrituras capturadas en sprite RAM. Los registros del bucle JS ya coincidían durante 389 pasos continuos. Esta es equivalencia acotada del bloque de boot, **no de todo el sistema de memoria**.

**Siguiente trabajo de código**: `r3_next_frontier.mjs` identifica cuál es el primer PC no compilado después de `0x6014` usando la ROM y la traza privadas del mismo operador; exige la prueba RAM exitosa y dos boots completos. Incluye clasificación tentativa por familia, nunca emite bytes ni registros. CI ROM-free PASS.

```bash
git pull --ff-only
node scripts/r3_next_frontier.mjs
```

Compartir exclusivamente el reporte resumido. Con esa evidencia, seleccionar R3.5: confirmar instrucción/semántica con Ghidra o CPU independiente, implementar el mínimo necesario y repetir diff. Bus completo, reset frío, IRQ/SYNC y banco post-handler siguen abiertos.

---

## R3.3 — Boot sprite RAM, capturador MAME y diferencial nativo preparados (22/10/2026)

**Estado real confirmado:** R3.2 ejecutó **1.192/1.192** pares soportados sin divergencias de registros, máximo **389 pasos continuos**, 28 PC compilados, 192 escrituras de palabra modeladas en cada uno de dos bucles boot (384 escrituras de palabra totales). **No equivale a RAM verificada.**

R3.3 ya incluye observador de escrituras de byte en sprite RAM de MAME (tap opt-in), comparador estricto contra **dos bucles JS con 192 escrituras de palabra cada uno**, respaldo previo de evidencia privada y pruebas ROM-free de bloqueos. Una coincidencia certificará únicamente los bytes/orden de esas escrituras concretas. No simular RAM faltante ni cerrar IRQ/bancos.

**Prueba real siguiente (primera nueva captura MAME en este subbloque):**

```bash
git pull --ff-only
bash scripts/r3-native-sprite-verify.sh
```

Compartir solo el JSON resumido `PASS_BOOT_SPRITE_RAM_WRITE_BYTES` o el texto del bloqueo, nunca los trazados y datos ROM de `out/`. Ver [R3.3](r3-first-native-prestate-slice.md). Luego extender a memoria/bus relevante si el diferencial coincide.

---

## Estado R3.2 — 22/10/2026: G2 real PASS, bucle boot ampliado en JS

El operador confirmó **G2 real**: 616/616 checkpoints de registros, 3 segmentos continuos de 4 pasos, 108 de al menos 2, ningún primer error. La frontera real son instrucciones no compiladas, especialmente en el arranque `0x6000`.

Se generó `STD ,X++` (posiciones `0x600c`/`0x600e`) con efecto explícito de escritura de D en sprite RAM y `LEAY -1,Y` en `0x6010`, restringidos a opcodes y direcciones ROM originales documentados por `src/poc.py`. **El JS modela escrituras RAM** y el harness las cuenta, pero todavía no las puede contrastar con bus MAME. Se mantiene `ram_writes_compared_with_mame=false` y la equivalencia RAM/IRQ sin verificar. Pruebas sintéticas de 12 pasos continuos y 4 escrituras, CI ROM-free PASS.

**Próxima validación de registros en Mac:**

```bash
git pull --ff-only
bash scripts/r3-first-real-slice.sh
```

La salida contendrá `longest_segment_steps`, `modeled_ram_word_writes` y la primera divergencia. Si aumenta la longitud continua y no divergen registros, pasar a capturar efectos de RAM reales en MAME para validar el mismo bucle antes de ampliar más opcodes. Ver [R3](r3-first-native-prestate-slice.md).

---

## R3 G1 PASS real; G2 segmentos acumulados preparados — 22/10/2026

El operador confirmó el primer resultado recompilado real: **616/616** pares de instrucciones soportadas, **25 PC compilados**, sin divergencias, con la ROM original `gngb` y el pretrace nativo MAME ya verificado. Se acepta **G1 limitado**; no significa 616 pasos contiguos ni equivalencia de todo el juego.

Se implementó **R3.1**, replay continuo desde **un único estado MAME por segmento**: el JS generado ejecuta varios pasos y compara su estado acumulado contra los siguientes preestados MAME. Detecta automáticamente la primera interrupción del segmento por opcode desconocido o divergencia. CI ROM-free [PASS](https://github.com/krukmat/gng-ghidra/actions/runs/39746370288). La aceptación provisional G2 requerirá **≥4 pasos consecutivos** reales.

**Único siguiente comando:**

```bash
git pull --ff-only
bash scripts/r3-first-real-slice.sh
```

La salida imprime `contiguous` con `longest_segment_steps`, `top_segments` y estatus. Compartir únicamente esa salida agregada; no ROM, JS generado, registros ni `pre-instruction.jsonl`. Si no hay tramo continuo, analizar los opcodes que lo interrumpen antes de ampliar el traductor. Sin nuevo MAME/Ghidra.

---

## Corrección de bloqueo operativo R3.0 — 22/10/2026

El primer run local de `node scripts/r3_static_trace_probe.mjs` se bloqueó por ausencia de `out/gngb-flat.bin`; `roms/gng.zip` ya estaba verificada en fases MAME anteriores. No es una divergencia de lógica MC6809.

**Fix en main:** `scripts/prepare_r3_flat_rom.py` reutiliza `src/poc.read_rom` (CRC de chips, mapeo de banco 4 y reset `0x6000`) para generar el flat **solo si falta**, bloqueando discrepancias de cualquier archivo existente; `scripts/r3-first-real-slice.sh` enlaza preflight + prueba del compilador estático. Tests ROM-free incluyen imagen ausente, existente idéntica, corrupta, vector de reset y salidas fuera de `out/`.

**Siguiente comando del operador:**

```bash
git pull --ff-only
bash scripts/r3-first-real-slice.sh
```

Si el comando alcanza la comparación MAME, devolver la salida agregada (estado, pares comparados, coincidentes, primera divergencia) sin publicar ROM ni JS generado. Una coincidencia en una instrucción no es equivalencia de juego completo.

---

## Prioridad actual: R3.0, primer paso real de JS compilado contra MAME

En lugar de seguir ampliando el observador sin demostrar recompilación, se preparó una prueba acotada **ROM → JS estático por PC → comparación del resultado con preestados consecutivos MAME**. El compilador `scripts/r3_static_trace_probe.mjs` solo admite instrucciones de registros, inmediatos y saltos en ROM fija; no interpreta opcodes durante runtime y falla cerrado ante registros/trazas inválidas. La CI ROM-free está integrada.

**El gate G1 sobre ROM y sesión real está PENDIENTE** y puede ejecutarse sobre los archivos privados ya existentes, sin repetir MAME:

```bash
git pull --ff-only
node scripts/r3_static_trace_probe.mjs \
  --rom out/gngb-flat.bin \
  --trace out/r2/mame-probe/pre-instruction.jsonl \
  --out out/r3/static-mame-prestate
```

Informe en `out/r3/static-mame-prestate/report.json`, código estático generado en `out/r3/static-mame-prestate/static-rom-slice.mjs`. No compartir el módulo ni JSONL original. Comparar pares preinstrucción es **una evidencia parcial**, no certifica por sí solo bus/IRQ ni CPU equivalente. Más detalles en [R3.0](r3-first-native-prestate-slice.md) e [issue #4](https://github.com/krukmat/gng-ghidra/issues/4).

R2.2.B2 sigue abierto (bank post-handler, bus y IRQ/SYNC) y el análisis offline de banco queda disponible en paralelo; no hace falta repetirlo para ejecutar este experimento.

---

## Estado vigente 22/10/2026 — R2.2.B2.a validado, B2.b offline listo

**Resultado MAME del operador:** exactamente **1/1 escritura** a `0x3e00` del banco, `bank_control_writes_observed=true`, sin evidencia de cambio efectivo por instrucción. Aceptar B2.a sin cerrar B2.

**B2.b — correlación sin repetir MAME:** el analizador `scripts/r2_probe_report.py` clasifica escrituras `0x3e00` frente al **siguiente frame** observado. Los resets, escrituras múltiples o ausencia de muestra invalidan la correlación. El informe expone únicamente contadores agregados `deferred_frame_followup`; no prueba `BANK_SWITCH` instantáneo. Pruebas ROM-free CI PASS.

```bash
git pull --ff-only
python3 scripts/r2_probe_report.py --dir out/r2/mame-probe
python3 - <<'PY'
import json
from pathlib import Path
r=json.loads(Path("out/r2/mame-probe/capabilities.json").read_text())
print(json.dumps({
    "status":r["status"],
    "control_write_count":r.get("bank_control",{}).get("control_write_count"),
    "deferred_frame_followup":r.get("bank_control",{}).get("deferred_frame_followup"),
    "observed_bank_switch_edges":r["capabilities"]["observed_bank_switch_edges"],
    "blockers":r["blockers"]
},indent=2))
PY
```

Compartir únicamente el JSON resumido. No enviar `observations.tsv`, `cpu.trace`, `pre-instruction.jsonl` ni ROM. Concluir B2.b según evidencia real antes de decidir instrumentación C++ del núcleo. R2.2.B2.c bus/IRQ/SYNC sigue pendiente.

---

## Estado vigente — 22/10/2026: R2.2.B1 PASS y B2.a desarrollado

**R2.2.B1 validado en MAME real:** soft reset observado una vez, 17.135 snapshots MC6809 sin errores sintácticos, 100 lecturas/12 escrituras MMIO; las barreras de `after`, bus por instrucción, banco post-handler, SYNC e IRQ permanecen abiertas.

**R2.2.B2.a listo para validar en Mac:** se observa el bus de selección de banco `0x3e00` con el tap MMIO existente y se cuentan sus escrituras; **no** se afirma cambio de banco completado. El contrato técnico está en [R2 Execution Trace Contract](r2-execution-trace-contract.md#r22b2a--bank-select-mmio-instrumentación-preparada-validación-real-pendiente). Tras conservar los datos previos, ejecutar una sola sonda nueva:

```bash
git pull --ff-only
mkdir -p out/r2/mame-probe-soft-reset-pass
cp -R out/r2/mame-probe/. out/r2/mame-probe-soft-reset-pass/
GNG_R2_PROBE_SOFT_RESET=1 bash scripts/r2-mame-probe.sh
python3 - <<'PY'
import json
from pathlib import Path
j=json.loads(Path("out/r2/mame-probe/capabilities.json").read_text())
print(json.dumps({
    "status": j["status"],
    "bank_control": j.get("bank_control"),
    "bank_control_writes_observed": j["capabilities"].get("bank_control_writes_observed"),
    "observed_bank_switch_edges": j["capabilities"]["observed_bank_switch_edges"],
    "blockers": j["blockers"]
},indent=2))
PY
```

Los archivos privados del debugger, ROM y JSONL se conservan bajo `out/` y no se comparten. Un valor cero de escrituras a `0x3e00` en 4 frames es un hallazgo legítimo, no un error inventado. R2.2 no está cerrada.

---

## Estado verificado R2.2.B1 — 22/10/2026: `tracesym` operativo

El operador confirmó una ejecución real de la sonda nativa MAME `gngb` **sin soft reset**: `17.281` preestados / `17.281` marcadores válidos, `0` malformados, `61` PC distintos. `PRE_INSTRUCTION_FORMAT_PARSED` y `PARTIAL_NATIVE_INSTRUMENTATION` superan el gate de **preestado**, pero no el contrato integral R2.1. El parser aislado no certifica procedencia por sí mismo. La ejecución R2.2.B2 está pendiente.

**Siguiente gate:** validar el soft reset separado (conservando primero la evidencia sin reset). `r2_probe_report.py` ahora exige solicitud → notificación en orden, sin duplicados; CI ROM-free PASS.

```bash
git pull --ff-only
mkdir -p out/r2/mame-probe-no-reset-pass
cp -R out/r2/mame-probe/. out/r2/mame-probe-no-reset-pass/
GNG_R2_PROBE_SOFT_RESET=1 bash scripts/r2-mame-probe.sh
cat out/r2/mame-probe/capabilities.json
cat out/r2/mame-probe/pretrace-report.json
```

La copia local preserva `cpu.trace` y `pre-instruction.jsonl` sin publicarlos. **Solo enviar los JSON de resúmenes, no datos CPU.** R2.2.B2 sigue exigiendo bus, registros `after`, IRQ y SYNC reales.

---

## R2.2.B1 — Corrección del soft reset y diagnóstico privado del trace

La primera ejecución MAME con soft reset informó `[LUA ERROR] attempt to use a closed file`, duplicación de contadores y **16.892 marcadores nativos** no parseables. **R2.2.B1 BLOCKED**, independientemente de `MAME_EXIT=0`. Se añadió cierre idempotente/guardia de reentrada y validación shell fail-closed; parser ahora informa anchos y nombres de campos sin revelar valores.

**Próximo paso no destructivo** (aprovecha `out/r2/mame-probe/cpu.trace` existente sin iniciar MAME):

```bash
git pull --ff-only
python3 scripts/r2_pretrace_report.py --dir out/r2/mame-probe
python3 - <<'PY'
import json
from pathlib import Path
r=json.loads(Path("out/r2/mame-probe/pretrace-report.json").read_text())
print(json.dumps({
  "status":r["status"],
  "markers_seen":r.get("markers_seen"),
  "malformed_markers":r.get("malformed_markers"),
  "malformed_shapes_redacted":r.get("malformed_shapes_redacted",[])
},indent=2))
PY
```

Si el informe contiene shapes útiles, corregir parser según formato **real** y no adivinar anchuras. **No volver a correr MAME con reset** hasta fijar eso. Conservar `cpu.trace`, ROM y `pre-instruction.jsonl` solo localmente en `out/`.

---

## Actualización R2.2.B1 — 22/10/2026: trazas preinstrucción estructuradas

La sonda R2.2.A fue probada por el operador en MAME real: instrucciones, CPU y MMIO observables, pero `INSTRUMENTATION_BLOCKED` para reset inicial, registros por instrucción, bus completo, bancos, SYNC e IRQ.

Se añadió [R2.2.B1](r2-execution-trace-contract.md#r22b1--preestado-real-por-instrucción-controlado-22102026): `tracelog` del debugger para todos los nueve registros **preinstrucción**, parser `r2_pretrace_report.py` fail-closed y soft reset **opcional** observado tras enganchar Lua. CI ROM-free PASS; no hay traza real de B1 validada todavía. Su salida estructurada `gng.r2.pre-instruction.v1` **no** sustituye el contrato completo `gng.r2.cpu-trace.v1`.

**Siguiente comando del operador:**

```bash
git pull --ff-only
GNG_R2_PROBE_SOFT_RESET=1 bash scripts/r2-mame-probe.sh
cat out/r2/mame-probe/pretrace-report.json
cat out/r2/mame-probe/capabilities.json
```

Conservar `cpu.trace` y `pre-instruction.jsonl` dentro de `out/`. Bloque siguiente R2.2.B2: instrumentar `after`, bus e IRQ/SYNC realmente observados; no fingirlos.

---

## Actualización R2.2.A — 22/10/2026: sonda independiente preparada

Se implementó el diagnóstico `scripts/r2-mame-probe.sh`: proceso MAME separado con `-debug`, traza nativa `noloop` y observaciones Lua de registros, MMIO, banco y frame; `scripts/r2_probe_report.py` genera una matriz de capacidades **sin afirmar equivalencia CPU**. CI ROM-free valida el analizador y casos fail-closed. La prueba real en Mac sigue pendiente.

**Próxima validación local:** `git pull --ff-only && bash scripts/r2-mame-probe.sh`; devolver solo `out/r2/mame-probe/capabilities.json` o el resumen textual y las líneas de error de MAME, **no el archivo `cpu.trace` ni memoria/ROM**.

Si la sonda confirma datos nativos, abordar R2.2.B (correlación por instrucción y detección IRQ/SYNC); hasta ello R2.2 no está aceptada. [Contrato y cobertura](r2-execution-trace-contract.md).

---

## Estado de verificación 22/10/2026 — R0 y R1 cerrados, inicio de R2

El operador aportó screenshot del frame **1700** `gngb`: el comparador entre MAME original y JavaScript devuelve **0/57.344 píxeles diferentes (0,00%)**. El frame **1660** también mostró **0/57.344** y se reprodujo en dos corridas con hashes SHA-256 **MATCH** en PNG, FG, BG, sprites DMA y paleta. El vídeo privado (256×224, 2.102 frames) muestra transición hasta gameplay.

**R0 #1 y R1 #2 CERRADOS.** La equivalencia es del renderer a partir de VRAM original; NO significa que la lógica del juego esté recompilada.

**R2.1 CONTRACT_DEFINED:** [especificación versionada JSONL](r2-execution-trace-contract.md) y validador ROM-free `python3 scripts/r2_trace_contract.py <ruta-a-trace.jsonl>` (siempre reporte `reference_execution_verified=false`). Las pruebas sintéticas fallan de forma cerrada ante secuencias discontinuas, campos falsos y bus/IRQ incompleto.

**R2.2 PENDIENTE:** instrumentar una fuente CPU independiente que capture reset → SYNC → primera IRQ con PC, registros, RAM/MMIO, banco y eventos de frame. El comparador independiente previo de rutinas 0x622c/0x6755 (120 vectores con entrada sintética) es antecedente útil pero NO es la traza continua de runtime exigida en R2.

**Único siguiente bloque:** construir el capturador de laboratorio R2.2 sin alterar el bot Blackbox ni incluir MAME/ROM en el runtime JS. No repetir R0/R1 por rutina.

---

## Estado de verificación 22/10/2026 — historial R0 cerrado, R1.5 pendiente (superado)

El operador repitió la captura real `gngb` frame `1660` y contrastó los manifests privados: `foreground`, `background`, `sprites`, `palette` y `reference` dieron **MATCH** SHA-256 en dos ejecuciones independientes. Por tanto, se aceptan R0.1–R0.5 y se cierra [R0 #1](https://github.com/krukmat/gng-ghidra/issues/1). El resultado JS del frame 1660 permanece **0/57.344** píxeles distintos (revisión visual del operador).

**Única tarea abierta antes de pasar a R2:** R1.5, repetir la comparación JavaScript↔MAME con un segundo estado auténtico de gameplay (frame sugerido `1700`), conservando `out/reference/frame-1660-original/` localmente. Si el segundo frame no alcanza pixel-perfect, depurar con un diff real y mantener R1 abierto. No se ha demostrado todavía ejecución de lógica MC6809 recompilada.

---

## Actualización operativa — 22/10/2026: R1 primer fotograma exacto

**Evidencia del operador en Mac:** el navegador comparó un fotograma auténtico `gngb` frame **1660** de MAME, contra el renderer JS alimentado con FG/BG, DMA sprites, scroll X=12/Y=0, paleta y gráficos de la ROM original, y registró **0 / 57.344 píxeles diferentes (0,00%)**. Antes de corregir los bitplanes eran **9.813 / 57.344 (17,11%)**. Se corrigió la prioridad de bits de plano 2/3/4 bpp para seguir `src/emu/drawgfx.cpp` de MAME. Una captura del comparador visual valida el primer frame, no todo el juego.

**Estado del gate:** R0.1–R0.3 y revisión visual R0.5 probadas; **R0.4 reproducibilidad con hashes en una segunda corrida pendiente**. R1.1–R1.4 (primer frame) verificadas; **R1.5 segundo fotograma distinto pendiente**. Mantener [R0 #1](https://github.com/krukmat/gng-ghidra/issues/1) y [R1 #2](https://github.com/krukmat/gng-ghidra/issues/2) **abiertas** hasta completar sus gates. R2 (diferencial de ejecución MC6809) y posteriores siguen sin demostrar.

**Siguiente secuencia operativa:** (1) archivar la carpeta privada `out/reference/mame/` del frame 1660, (2) repetir una vez el frame 1660 usando el plan inmovilizado y comparar hashes nativos, (3) conservar esa evidencia y capturar un frame distinto de gameplay (p. ej. 1700), comparar 256×224 en JS. No subir ni ROM ni PNG ni VRAM ni HTML con bytes privados a Git.

**Aviso:** el contenido de la sección de 21/10/2026 siguiente es histórico y sus instrucciones de repetir el primer intento de captura ya no son la acción prioritaria.

---

## Actualización operativa R0 — 21/10/2026

**Evidencia del operador:** `bash scripts/r0-blackbox-baseline.sh`
ya ejecuta la partida real de GNGb y **Arthur se mueve**.
La ruta funcional usa el plan gameplay y el Lua original de Blackbox fijado
al commit `99722c3900b63e13185c52824c0adec3df7f44c1`, con la única
adaptación conocida de botones ataque/salto. **No volver al bot
experimental** de `scripts/visual-real-frame.sh`.

**Siguiente tarea R0:** ejecutar `bash scripts/r0-blackbox-frame.sh`.
Este modo conserva el autoplayer original y añade un observador de
vídeo/FG/BG/DMA/paleta/scroll para producir
`out/reference/mame/manifest.json` y
`out/visual/frame-compare.html` a partir del **mismo** run.
El addon Lua y la igualdad JS/MAME aún requieren verificación local.
R0 se cierra solo tras validar los datos de vídeo reales.
El baseline sin addon permanece reproducible con su comando original.

## 2. Estado comprobado al redactar este plan

| Elemento | Estado | Interpretación |
| --- | --- | --- |
| V0/V1.1 | Visores implementados, revisión local parcial | Gráficos ROM / sprites diagnósticos; no gameplay |
| V1.2 | Código implementado, **rechazado visualmente** | Mosaico sintético; no se mejora como objetivo |
| R0 | **CERRADO** | Imagen, FG/BG/DMA/paleta auténticos; frame 1660 reproducible (cinco hashes MATCH) |
| R1 | **CERRADO (renderer)** | Dos fotogramas auténticos 1660 y 1700: **0/57.344** píxeles de diferencia en ambos |
| R2 | **R2.1 contrato y validador; R2.2+ pendientes** | Falta instrumentación y traza genuina reset → SYNC → primera IRQ |
| R3 | No demostrado | No hay recompilador directo validado de un tramo real significativo |
| R4/V2–R6/V4 | Bloqueados | No existe primer frame generado, interacción ni juego jugable |

Un **CI verde** acredita pruebas públicas/sintéticas, pero no certifica captura real, igualdad de píxeles, ejecución original ni gameplay.

## 3. Secuencia de trabajo, tareas y subtareas

Los plazos son **timeboxes orientativos en días laborables desde el inicio**, no fechas prometidas; dependen de poder ejecutar MAME y la ROM local. Cada issue contiene la checklist detallada, dependencia y aceptación. No abrir trabajo posterior para maquillar un gate bloqueado.

### R0 — Captura real y verificable · D1–D3 · [Issue #1](https://github.com/krukmat/gng-ghidra/issues/1)

**Tarea:** obtener un fotograma auténtico y su memoria de vídeo asociada.

- **R0.1:** verificar MAME, driver gngb/gng y chips ROM por CRC; no elegir driver por nombre ZIP.
- **R0.2:** ejecutar `bash scripts/r0-blackbox-frame.sh` usando como base el gameplay verificado; no utilizar el bot previo. Diagnosticar fallos en la captura sin volver a cambiar Coin/Start.
- **R0.3:** validar PNG 256×224, FG/BG, buffer DMA de sprites, paleta, scroll, manifest y hashes.
- **R0.4:** repetir captura en condiciones idénticas y comprobar reproducibilidad.
- **R0.5:** revisar fotograma auténtico y registrar resultado sin subir recursos privados.

**Entrega:** `out/reference/mame/` (local). **GO:** evidencia completa y reproducible. **STOP:** preflight/captura fallida, DMA ausente o estado incoherente. **No significa equivalencia del renderer.**

### R1 — Igualdad del renderer con fotogramas reales · D3–D7 · [Issue #2](https://github.com/krukmat/gng-ghidra/issues/2)

**Tarea:** reconstruir en JS el mismo fotograma que generó MAME, usando **sus bytes reales de VRAM**, no un collage.

- **R1.1:** abrir `out/visual/frame-compare.html` con el frame de R0.
- **R1.2:** medir y conservar localmente diff de píxeles, porcentaje, driver/frame y hashes.
- **R1.3:** depurar BG, FG, sprites, crop, paleta RGB, scroll, prioridades y sincronización DMA.
- **R1.4:** corregir renderer y añadir regresiones ROM-free.
- **R1.5:** contrastar un segundo fotograma real para evitar una coincidencia accidental.

**Entrega:** comparación visual y diff cuantitativo. **GO:** cero píxeles distintos para un frame estable y segundo frame contrastado. **STOP:** diferencias estructurales/no explicadas. Si aparece una imagen reconocible pero persisten diferencias, es **avance parcial**, no igualdad aceptada. El objetivo de D7 es un frame real reconocible; la igualdad estricta puede bloquear el cierre del gate.

### R2 — Oráculo diferencial de ejecución · D6–D10 · [Issue #3](https://github.com/krukmat/gng-ghidra/issues/3)

**Tarea:** capturar y comparar ejecución CPU auténtica, separada del renderer.

- **R2.1:** definir esquema de traza (PC, opcode, registros, CC, RAM/MMIO, banco, IRQ/FIRQ, frame).
- **R2.2:** instrumentar una referencia independiente del código generado.
- **R2.3:** capturar secuencia desde reset hacia SYNC y primera IRQ, con entradas/condiciones fijadas.
- **R2.4:** implementar diff que señale la **primera divergencia** y no continúe silenciosamente.
- **R2.5:** añadir CI con fixtures sintéticos; trazas reales exclusivamente en `out/`.

**Entrega:** formato, capturador y comparador reproducibles. **GO:** traza determinista y detector probado con errores deliberados. **STOP:** ausencia de eventos, trazas parciales ambiguas o validación circular.

### R3 — Prueba de recompilación directa 6809 → JS · D8–D14 · [Issue #4](https://github.com/krukmat/gng-ghidra/issues/4)

**Tarea:** decidir con evidencia si la recompilación estática es viable para el juego.

- **R3.1:** extraer bloques básicos/CFG y bytes exactos de ROM con Ghidra + decoder.
- **R3.2:** generar funciones JS por bloque y un dispatcher de **direcciones de código**, no un intérprete de opcodes.
- **R3.3:** modelar registros/flags, RAM, ROM bancarizada y MMIO explícito con fail-closed.
- **R3.4:** integrar SYNC, IRQ/FIRQ y cambios de banco observados; no saltar eventos.
- **R3.5:** comparar tramo contiguo **reset → primera interrupción atendida**, incluyendo escrituras.
- **R3.6:** comparar fidelidad y esfuerzo frente al pipeline P-code actual y emitir **GO/NO-GO**.

**Entrega:** demo Node y reporte de primera divergencia. **GO:** tramo real con interrupción, checkpoints y escrituras equivalentes, sin intérprete. **NO-GO al D14:** no hay prueba suficiente o la complejidad exige atajos no verificables. Si falla, **replantear el alcance con el operador**, sin convertir el producto a emulador de forma encubierta.

### T1/T2/T3 — Cierre de regresión ROM-free reproducible (24/10/2026)

T1: Node H de 9 casos + escalas 5k/40.001/100k, SHA256 y diagnóstico. T2: suite `scripts/r3-local-regression.sh` con Node/Python y gate F. T3: reparación de defectos comprobados, nuevo pase integral, salida agregada `out/r3/r42-validation-closure.json` sin ROM ni logs. **El ejecutor está implementado y probado (8/8 casos Python de aislamiento); las ejecuciones Node H y suite integral permanecen bloqueadas en la terminal actual por falta de checkout GitHub**. El bloqueo no es fallo del producto; realizar `python3 scripts/r42_validation_closure.py` sobre un clon completo. Sin GitHub Actions. [Documento operativo](r42-validation-closure.md).

### R4.2.H — Consolidación ROM-free y congelación del laboratorio (24/10/2026)

H1 F-shaped sintético → G → board → renderer; H2 integridad, cobertura y DMA; H3 pruebas 5k/40.001/100k (1M opcional); H4 comparación primer evento/byte/píxel con informe sin valores privados; H5 tests y documentación. Implementado en main; 9/9 tests aislados en V8 con hash no criptográfico, Node/Python integral pendiente. **No** usar H como certificación MAME, R4/V2 ni banco A0.6.3. Congelar expansión visual al finalizar. [Contrato R4.2.H](r42h-romfree-checkpoint.md).

### R4.2.G — Puente F→board de video, ROM-free (24/10/2026)

G1 revisión del contrato F; G2 estado de captura inicial, no asumir bytes inexistentes; G3 procesamiento incremental de hasta 1M eventos y ventanas de 40K sin reset; G4 comparación hashes/primer byte frente a R0; G5 CLI, tests y docs. La equivalencia nativa requiere pruebas externas y no está certificada. [Contrato R4.2.G](r42g-event-replay-bridge.md).

### R4.2.F — Instrumentación opcional MAME de eventos visuales (24/10/2026)

- **F1:** contrato `gng.r42f.native-video-metadata.v1` y JSONL secuencial con `seq`, tipo, frame y tiempo emulado. Raster exacto indisponible explícitamente.
- **F2:** `r42f_native_video_taps.lua` registra escrituras sprite/FG/BG/paleta, reutiliza los taps existentes de scroll y DMA, sin alterar los datos ni activar instrumentation por defecto.
- **F3:** `capture_real_frame.py --r42f-timeline` enlaza la corrida con ID aleatorio y valida JSONL/metadata con `r42f_validate_timeline.py`; hashes y recuentos solo acreditan coherencia local.
- **F4:** tests adversariales ROM-free para orden, máscara, DMA, rango, tiempo, duplicados, truncamiento, falseamiento de raster y procedencia.
- **F5:** runner local y documentación. No GitHub Actions, ROM ni certificación nativa sin MAME.

La cobertura empieza tras instalar los taps en el script autoboot. **No demuestra orden de instrucciones MC6809, PC/banco A0.6.3, IRQ, VBlank ni posición raster real**. [Contrato y comando privado](r42f-native-video-timeline.md).

### R4.2.E — Evidencia estructural R0 y correlación limitada (24/10/2026)

E1 contrato de procedencia R0; E2 integridad SHA-256 de FG/BG/DMA/paleta/PNG; E3 comparación de snapshots con checkpoints R4.2.D sin reclamar eventos nativos; E4 mutaciones adversariales ROM-free; E5 CLI local y documentación. El capturador R0 no registra aún escrituras ordenadas por instrucción: **timeline y VBlank no certificados**. Detalles: [contrato R4.2.E](r42e-native-correlation-contract.md).

### R4.2.D — Secuenciación y checkpoints visuales (24/10/2026)

**D1:** contrato ROM-free `gng.r42.visual-events.v1`: `WRITE8` (RAM o MMIO visual documentado), `DMA` (solo `0x3c00`) y `CHECKPOINT` (identificador único). Secuencias `seq=0..N-1`, validación completa de la estructura antes del replay y rechazo de cualquier evento desconocido o supuesto origen MAME.

**D2/D3:** `src/gngb_visual_event_replay.mjs` aplica cada evento sobre la board real de laboratorio (no decodifica instrucciones MC6809). Los checkpoints requieren RAM FG/BG, buffer DMA y los registros de paleta/scroll inicializados; preservan RGBA, VRAM, sprites y paleta en copias defensivas con SHA-256 y scroll inmutable. Los checkpoints son **puntos explícitos de laboratorio**; no implican VBlank nativo ni un frame de juego.

**D4:** render `256×224` con compositor compartido R1/R4.2.B y estados internos R4.2.C. Graphics ROM sintéticos en tests; ROM propietaria no incluida ni generada.

**D5:** `compareGngbVisualReplays` separa **primera divergencia de evento** de **primera divergencia RGBA** (coordenada X/Y y canal), y distingue un evento que cambia sin alterar píxeles. Pruebas negativas de orden, DMA irregular, estados incompletos, MMIO desconocido, atributos sobrantes, mutación de snapshots y origen nativo falsamente atribuido.

**D6:** `node scripts/r42d_visual_replay_lab.mjs` reproduce dos ejecuciones idénticas y una tercera con una modificación de sprite; verifica que el cambio visual no aparece hasta el siguiente DMA. Genera `out/r3/r42d-event-replay/report.json` y `checkpoints.html`, **solo material sintético**, sin GitHub Actions. `bash scripts/r3-local-regression.sh` incorpora las 10 pruebas de eventos y 2 del script, además de las existentes. En este entorno se ejecutaron **10/10 tests de eventos en V8 aislado**, con el código real del repo pero un hash determinista suplente de `node:crypto`; **no** se ha ejecutado todavía la suite Node/Python completa, y sus SHA-256 reales deben verificarse allí. No llamar a esto certificación A0.6.3 ni R4/V2.

**Siguiente dependencia:** correlacionar esos eventos/checkpoints con taps autenticados de MAME por captura y sincronización raster/IRQ. Sigue bloqueada la ejecución autónoma por A0.6.3 + SYNC/IRQ; la presencia de un HTML no es evidencia nativa.


### R4.2.C — Scroll y paleta desde MMIO de la board (24/10/2026)

Implementado el modelo `RGBx_444` (256 entradas, dos planos de bytes) y scroll little-endian de cuatro registros. El compositor compartido R1/R4.2 utiliza de forma predeterminada el estado de la board; overrides explícitos quedan solo como ruta de fixture/referencia claramente señalada. El board rechaza estado incompleto y efectos mixtos sin evidencia de orden de bus. Pruebas ROM-free; NO se reclama equivalencia temporal DMA/paleta/IRQ ni primer fotograma autónomo.

### R4.2.A — DMA sprites + entradas al renderer (24/10/2026)

Subbloque de R4.2 preparado y conectado al board en `main`, independiente de la recuperación bancaria A0.6.3:
- **R4.2.A1:** 0x3C00 dispara copia lógica de 512 bytes de sprite RAM CPU a buffer separado; sin inicialización de fuente no hay DMA válido.
- **R4.2.A2:** adapter con el decodificador JS existente, memoria FG/BG y sprites copiados; no hay píxeles ni frame real generado.
- **R4.2.A3:** pruebas ROM-free de atomicidad, copias, replay, rechazo y entradas del renderer. Comando: `bash scripts/r3-local-regression.sh`.

Sigue pendiente la conexión al renderer Canvas, la certificación de la transferencia nativa/timing y la ejecución continua con bancos, IRQ y `SYNC`. No presentar este avance como V2 ni como R4.2 cerrado. Detalles: [ruta crítica](r3-critical-path.md).

### R4 / V2 — Primer frame generado por JS recompilado · Semanas 3–4 · [Issue #5](https://github.com/krukmat/gng-ghidra/issues/5)

**Tarea:** que la memoria del fotograma proceda del **código original recompilado**, no de una instantánea inyectada.

- **R4.1:** completar arranque, bancos, dispositivos e interrupciones hasta primer vblank.
- **R4.2:** conectar RAM/MMIO y buffer DMA del JS generado con renderer R1.
- **R4.3:** ejecutar avance determinista de frames e inputs fijados.
- **R4.4:** comparar memoria, eventos y píxeles con R0/R2.
- **R4.5:** entregar demo local y regresiones sin ROM en Git.

**Entrega:** primer frame V2 auténtico del JS generado. **GO:** fotograma causado por ejecución recompilada y contrastado. **STOP:** composición manual o estado de vídeo precargado como sustituto.

### R5 / V3 — Primer control jugable · Semanas 5–8 · [Issue #6](https://github.com/krukmat/gng-ghidra/issues/6)

**Tarea:** Arthur responde a controles mediante lógica original recompilada.

- **R5.1:** mapear inputs hardware a teclado/gamepad.
- **R5.2:** crear loop determinista con replay de entradas.
- **R5.3:** recompilar rutas observadas de movimiento, salto, animación y colisión.
- **R5.4:** comparar posiciones, estados y frames con el oráculo.
- **R5.5:** verificar interacción local y documentar limitaciones.

**Entrega:** demo V3 con izquierda/derecha y salto. **GO:** comportamiento real reproducible; **STOP:** desplazamientos o animaciones hardcodeados.

### R6 / V4 — Port completo · Sin fecha cerrada · [Issue #7](https://github.com/krukmat/gng-ghidra/issues/7)

**Tarea:** convertir la primera interacción en partida completa.

- **R6.1:** niveles, enemigos, proyectiles, físicas, colisiones, vidas y transiciones.
- **R6.2:** audio/Z80 y sincronización tras estabilizar gameplay.
- **R6.3:** rendimiento y fidelidad de prioridades, scroll y paletas.
- **R6.4:** empaquetado sin distribuir ROM.
- **R6.5:** regresiones de sesiones completas con inputs reproducibles.

**Entrega:** port jugable validado, no solo un frame o una demo de movimiento.

## 4. Dependencias y política de avance

```text
R0: captura real ──→ R1: renderer igual al frame ──┐
       │                                            │
       └───────────→ R2: traza CPU ──→ R3: GO/NO-GO ├──→ R4/V2 ──→ R5/V3 ──→ R6/V4
```

R2 puede prepararse durante la depuración R1, pero **R4 exige R1 y R3 aceptados**. R3 necesita R2. Un gate bloqueado no se etiqueta PASS por tener CI verde.

## 5. Reglas operativas y definición de terminado

1. **Un solo objetivo observable por entrega**: comando local, resultado, evidencia y límite explícito.
2. **Tareas y subtareas máximo dos niveles**: una issue por gate con checklist y enlace a evidencia, no backlog de rutinas arbitrarias.
3. **ROM privada:** ZIP, dumps RAM/VRAM, PNG originales, trazas con bytes ROM y HTML con gráficos ROM en `out/`; nunca commit ni adjuntos públicos.
4. **CI sin ROM:** pruebas de esquema, compilador, renderer y diff con datos sintéticos. **Validación con ROM/MAME:** ejecución manual en Mac, reportada separadamente.
5. **Fail closed:** no completar estados desconocidos con valores ficticios; no afirmar equivalencia sin comparación independiente.
6. **Ritmo:** revisión al terminar R0, R1 y al D14. El resultado del D14 determina la arquitectura de la siguiente fase, no una decisión previa.
7. **V1.3 anterior** (mostrar inicialización de sprite RAM traducida) queda como prueba técnica opcional dentro de R3/R4, **no** como hito visual prioritario.

## 6. Próxima acción exacta

**Ingeniería:** R2.2.A ha entregado una sonda MAME real y verificación ROM-free. R2.2.B requiere aún instrumentación fiable de cada instrucción y señales SYNC/IRQ. No confundir una muestra de MMIO o un fichero debugger `trace` con equivalencia CPU.

**Operador — ahora, primer test de capacidades MAME con ROM local:**

```bash
git pull --ff-only
bash scripts/r2-mame-probe.sh
cat out/r2/mame-probe/capabilities.json
```

La sonda es independiente del bot y se ejecuta por separado; devuelve `PARTIAL_NATIVE_INSTRUMENTATION` o `INSTRUMENTATION_BLOCKED`, **nunca** `R2=PASS`. Evidencia en `out/`, no subir `cpu.trace`, ROM o memoria al repositorio.
