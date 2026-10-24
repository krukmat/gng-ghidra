## R4.2.H — Cierre funcional ROM-free (24/10/2026)

H1 cadena F-shaped sintética → G board → renderer compartido; H2 SHA/estado/DMA fail-closed; H3 escala 5k/40.001/100k en ventanas sin nuevo reset; H4 diagnóstico por primera divergencia de evento, byte y píxel; H5 CLI, tests y evidencia agregada. [Contrato y pasos](r42h-romfree-checkpoint.md).

**Verificación disponible:** 9/9 tests en V8 aislado con hash suplente (no SHA256 Node) y fuentes de GitHub; 100k eventos en 3 ventanas, mutación de sprite (byte offset 3, píxel 34/66 canal R) y escritura CPU posterior al DMA sin efecto visible. Los tests Node reales y la regresión Python integrada siguen pendientes de ejecución. La certificación nativa por F, A0.6.3, IRQ/SYNC, MAME framebuffer **no** está cerrada.

**Decisión:** congelar expansión del laboratorio visual R4.2 después de H; no abrir R4.2.I por inercia. Enfocar esfuerzo siguiente en evidencias externas pendientes, no sumar escenas sintéticas.

---

## R4.2.G — Puente F→board sin certificación MAME (24/10/2026)

G1: esquema F verificado y test F incorporado en runner; ejecución nativa Node/Python pendiente. G2: cobertura explícita de RAM sprite/VRAM/paleta/scroll y bootstrap SHA-256 opcional, sin inicialización inventada. G3: replay incremental y checksum del JSONL F hasta 1M eventos (ventanas de 40K con estado persistente). G4: SHA-256 de los componentes visuales y primer offset de divergencia frente a R0 verificado, sin copiar bytes al informe. G5: pruebas ROM-free, CLI y roadmap actualizados.

**ROM-free verificado:** 11/11 tests del módulo en V8 con hash sustituto; humo del CLI con filesystem simulado PASS; 4 tests de CLI incorporados pero pendientes de Node. El runner Node/Python integral, los taps MAME y el origen temporal permanecen pendientes.

**STOP:** no afirmar correspondencia por instrucción, raster, IRQ ni equivalencia nativa. [Contrato y comandos](r42g-event-replay-bridge.md).

---

## R4.2.F — Cronología de escrituras de vídeo MAME (24/10/2026)

**Estado de implementación:** F1–F5 preparados en `main`, con captura opt-in de taps Lua, evento JSONL acotado, ID de corrida, validador estructural Python, tests adversariales y documentación. La ejecución real de MAME con ROM privada y la suite completa Node/Python se reportarán por separado; **ninguna coincidencia sintética constituye evidencia nativa**. [Ver contrato, límites y comando](r42f-native-video-timeline.md).

**Riesgo conocido:** las APIs Lua documentan `screen.frame_number` y `machine.time`, pero no posición vpos/hpos exacta. Los campos raster permanecen explícitamente `null`. El log es orden de taps invocados desde autoboot, no secuencia CPU por instrucción garantizada. Las discrepancias de máscara/orden bloquean la captura en vez de normalizar datos.

---

## R4.2.E — Auditoría estructural R0 / preparación de correlación MAME (24/10/2026)

El contrato y la ruta de uso están en [docs/r42e-native-correlation-contract.md](r42e-native-correlation-contract.md). E1–E5 implementan verificación de los cinco artefactos R0, metadata de frame/DMA/scroll, comparación informativa de estado con checkpoint sintético D, CLI privado y tests adversariales. **No hay secuencia temporal de MAME verificable** en el formato R0 existente; una coincidencia de snapshots no certifica orden nativo de eventos, pixels del PNG ni VBlank. No usar este bloque para cerrar A0.6.3.

---

# R4.2.D — Secuenciación determinista de vídeo (24/10/2026)

**D1:** contrato ROM-free `gng.r42.visual-events.v1`: `WRITE8` (RAM o MMIO visual documentado), `DMA` (solo `0x3c00`) y `CHECKPOINT` (identificador único). Secuencias `seq=0..N-1`, validación completa de la estructura antes del replay y rechazo de cualquier evento desconocido o supuesto origen MAME.

**D2/D3:** `src/gngb_visual_event_replay.mjs` aplica cada evento sobre la board real de laboratorio (no decodifica instrucciones MC6809). Los checkpoints requieren RAM FG/BG, buffer DMA y los registros de paleta/scroll inicializados; preservan RGBA, VRAM, sprites y paleta en copias defensivas con SHA-256 y scroll inmutable. Los checkpoints son **puntos explícitos de laboratorio**; no implican VBlank nativo ni un frame de juego.

**D4:** render `256×224` con compositor compartido R1/R4.2.B y estados internos R4.2.C. Graphics ROM sintéticos en tests; ROM propietaria no incluida ni generada.

**D5:** `compareGngbVisualReplays` separa **primera divergencia de evento** de **primera divergencia RGBA** (coordenada X/Y y canal), y distingue un evento que cambia sin alterar píxeles. Pruebas negativas de orden, DMA irregular, estados incompletos, MMIO desconocido, atributos sobrantes, mutación de snapshots y origen nativo falsamente atribuido.

**D6:** `node scripts/r42d_visual_replay_lab.mjs` reproduce dos ejecuciones idénticas y una tercera con una modificación de sprite; verifica que el cambio visual no aparece hasta el siguiente DMA. Genera `out/r3/r42d-event-replay/report.json` y `checkpoints.html`, **solo material sintético**, sin GitHub Actions. `bash scripts/r3-local-regression.sh` incorpora las 10 pruebas de eventos y 2 del script, además de las existentes. En este entorno se ejecutaron **12/12 pruebas ROM-free** (10 de eventos + 2 del CLI) con fuentes actuales descargados de GitHub en V8 aislado y un hash determinista suplente de `node:crypto` (el CLI y el código publicado sí usan SHA-256 de Node). Fixture: **5.140 eventos, 5 checkpoints**, repetición idéntica y mutación observada en secuencia **5132**, primera divergencia visual en `second-dma`, pixel `(132, 66)`, canal `G`. El montaje/serialización HTML con `Buffer` y la escritura de artefactos se validaron solo mediante dobles de prueba; **no** se ha ejecutado la suite Node/Python integral ni el CLI completo bajo Node porque el entorno shell no puede resolver `github.com`. Sus SHA-256 y los ficheros generados deben comprobarse en un checkout real, sin reactivar Actions. No llamar a esto certificación A0.6.3 ni R4/V2.

**Siguiente dependencia:** correlacionar esos eventos/checkpoints con taps autenticados de MAME por captura y sincronización raster/IRQ. Sigue bloqueada la ejecución autónoma por A0.6.3 + SYNC/IRQ; la presencia de un HTML no es evidencia nativa.


---

## R4.2.C — Scroll + palette RGBx_444 gobernados por la board (24/10/2026)

**C1/C2:** verificados sobre MAME `gng.cpp` y `emupal.h`: `0x3B08/09` X little-endian, `0x3B0A/0B` Y; paleta extendida `0x3800–0x38FF` = byte alto y paleta base `0x3900–0x39FF` = byte bajo, formato `RGBx_444` (`R=ext[7:4]`, `G=ext[3:0]`, `B=base[7:4]`, expansión x17; byte bajo nibble bajo ignorado). No se infieren valores tras reset: `snapshotVideoRegisters()` exige cuatro bytes scroll y los **512** bytes de RAM de paleta escritos explícitamente. Este requisito fail-closed es conservador, no una afirmación de comportamiento nativo POR.

**C3:** `src/gngb_video_registers.mjs` se integra en `src/gngb_board_memory.mjs` (solo MMIO de escritura). `renderGngbBoardFrame({board,chars,tiles,sprites})` obtiene scroll y paleta **de la board** sin inyección manual, conservando el buffer DMA independiente. Por compatibilidad ROM-free del bloque B, la sobreescritura explícita *emparejada* `palette+scroll` continúa disponible, pero se etiqueta `EXPLICIT_LAB_OR_REFERENCE`, nunca `BOARD_MMIO`. `read8` en MMIO mantiene rechazo salvo política B4 de 0x3C00.

**C4:** `stepStatic` admite hasta dos escrituras de registro de vídeo por instrucción, valida estado CPU antes de commit y rechaza mezclas RAM/MMIO/DMA no corroboradas por bus. Pruebas ROM-free: endianess, red/green/blue, datos incompletos, aislamiento, cambios de píxeles por scroll/paleta, reset, DMA inalterado, callbacks B4 y rollback.

**C5:** nuevos `tests/test_gngb_video_registers.mjs` y `tests/test_gngb_video_mmio_board.mjs` en `scripts/r3-local-regression.sh`. Validación de los fuentes actuales descargados de GitHub en V8 con dependencias inyectadas: **11/11 pruebas nuevas + 10/10 pruebas de DMA/renderer preexistentes**. El fixture de scroll se corrigió para respetar el recorte de 16 líneas del raster; no hubo que modificar el cálculo de scroll. **La regresión integral Node/Python aún NO se ha ejecutado** en este entorno. No GitHub Actions, no ROM privada, no equivalencia temporal de paleta/raster ni frame autónomo. El gate nativo de R4 continúa dependiendo de A0.6.3 e IRQ/SYNCACK.

---

# Ruta crítica del port recompilado — R3.5 → R4 (22/10/2026)

## R4.2.B — Pixel compositor compartido R1 → board DMA (24/10/2026)

Se extrajo a `src/gngb_frame_renderer.mjs` el compositor **RGBA 256×224** que antes estaba embebido exclusivamente en `reference_frame_view.py`. Preserva el mismo orden de R1: BG back → sprites del buffer DMA → BG front → FG, transparencia y recorte superior de 16 píxeles. El generador privado R1 ahora inyecta el módulo compartido al HTML y lo usa para la comparación con PNG MAME.

`src/gngb_frame_pipeline.mjs` integra el módulo mediante `snapshotGngbRendererInputs` de R4.2.A, exigiendo RAM FG/BG completa y transferencia de sprites `0x3C00` previa; dibuja únicamente desde el buffer congelado, nunca desde sprite RAM CPU sin DMA. Entradas obligatorias: imágenes gráficas privadas CRC-verificadas y paleta/scroll proporcionados explícitamente. Sin esas fuentes **se bloquea**, no se inventan datos ni se declara V2.

Seis tests ROM-free verifican píxeles BG/sprite/FG, orden de prioridad, clip, aislamiento antes/después de DMA y fallo ante datos incompletos. Se incluyeron en `scripts/r3-local-regression.sh`.

**Regresión de compatibilidad R1:** cuatro hashes FNV-1a de 229.376 canales RGBA cada uno, obtenidos con el compositor HTML anterior del commit `65eace2` y fixtures deterministas. En la comparación directa con el nuevo compositor: **0 diferencias** para los cuatro casos. El test `tests/test_gngb_frame_renderer_r1_parity.mjs` congela esos valores; no son capturas MAME ni pruebas de juego real. `tests/test_mame_visual_oracle.py` también exige que la página R1 inyecte la nueva función sin marcadores pendientes.

**Salida visual ROM-free reproducible:** `node scripts/r42_visual_fixture.mjs` genera `out/r3/r42-visual-fixture/compare.html` y `report.json`. Los dos lienzos 256×224 muestran una modificación de RAM de sprites que **solo aparece después de la segunda transferencia DMA**. El HTML contiene píxeles exclusivamente sintéticos, no ROM, y está marcado visiblemente como prueba de laboratorio. Se añaden pruebas del HTML, del delta pixel a pixel y del split-priority de BG grupo 1 frente a sprites. No se utiliza como evidencia MAME ni V2.

 El gate real de R4 / V2 **sigue dependiendo de A0.6.3, IRQ/SYNCACK, timing DMA y ejecución CPU continua**; este bloque solo conecta el canal de píxeles del laboratorio, no demuestra un frame de juego generado por código recompilado.

---

## R4.2.A — Sprite DMA lógico y renderer input adapter (24/10/2026)

**A1 — DMA aislado:** nuevo `src/gngb_sprite_dma.mjs` acoplado al adapter `src/gngb_board_memory.mjs`. La escritura en `0x3C00` copia **512 bytes completos** de la RAM CPU `0x1E00–0x1FFF` a un buffer privado. No se interpreta el valor escrito como dato del buffer. Sin RAM completamente inicializada, error sin efectos. `snapshotRawSprites` sigue mostrando CPU RAM, mientras que `snapshotBufferedSprites` solo existe tras DMA. Un reset de laboratorio invalida el buffer.

**A2 — Conexión a los decodificadores existentes:** `snapshotGngbRendererInputs(board)` entrega instantáneas separadas: 4.096 bytes FG/BG dentro de la imagen 64 KiB, 512 bytes de sprites bufferizados, **1.024 tiles FG, 1.024 BG** decodificados con `video_memory.mjs`, y sprites ordenados por `sprite_memory.mjs`. El adapter falla si falta RAM de vídeo inicializada o no ocurrió DMA. No dibuja píxeles ni reemplaza el renderer Canvas actual; R4.2.B seguirá encargándose del frame efectivo.

**A3 — Pruebas:** 5 tests del núcleo DMA y 4 tests de integración board/renderer; incluidos en `scripts/r3-local-regression.sh`. Se ejecutaron 5/5 con Node v22 (módulo DMA sin dependencias) y 9/9 en prueba aislada cargando los **archivos exactos de GitHub**, con sus dependencias JS inyectadas (no es la batería Node integrada). La regresión completa del repositorio sigue pendiente de un entorno con checkout; no activar GitHub Actions.

**Gate ROM-free:** sin byte inicializado, DMA rechaza; cambios de CPU RAM posteriores no se ven en pantalla hasta nueva captura; la lectura de `0x3C00` conserva la política previa B4, otras escrituras MMIO siguen rechazadas; los efectos DMA de código generado se confirman antes de commit y se revierten si falla CPU o se mezclan writes ambiguos. **Alcance no certificado:** ciclos de DMA/halt CPU, efecto exacto observado en MAME, sprite-buffer/renderer completo, IRQ/SYNC, banco A0.6.3, frame R4 autónomo.

---

## A0.6.3 — plan de desbloqueo (24/10/2026)

La ruta ejecutable y los criterios de decisión están consolidados en [docs/a063-unblock.md](a063-unblock.md). Primero forense offline de firmas en la captura privada; solo si son inválidas se corrige la instrumentación y se repite MAME una vez. La API Lua `memory.banks[tag].entry` es una alternativa potencial, pero por sí sola no aporta correspondencia por instrucción. **Sin trazas/ROM privadas, no se puede certificar A0.6.3 a distancia.**

---

## A0.6.4.H1 — exactitud de histograma bancario sin hardware (24/10/2026)

Se incorporó `scripts/r3_banked_report_integrity.mjs`, que exige coincidencia exacta entre las filas `(bank, pc, samples)` del reporte A0.6.3, los pares agrupados del witness y los totales por banco/PC. Un cambio de banco o redistribución de muestras con idénticos totales globales **se rechaza**, al igual que filas duplicadas, formato de dirección inválido, bancos desconocidos y muestras cero. El gate `compileNativeBankedPairs` ahora lo llama después del chequeo de totales agregados, antes de compilar módulos. Se añadieron siete tests Node ROM-free (incluyendo 128 mutaciones deterministas compensadas) y se incluyeron en `scripts/r3-local-regression.sh`.

**Validación alcanzada:** 7/7 tests independientes del validador ejecutados con Node v22 en entorno aislado. Aún no se ha podido ejecutar todo el runner del repositorio aquí porque la descarga/clonación de GitHub desde el shell está bloqueada. No se usaron GitHub Actions ni ROM privada. El nuevo control no transforma evidencia sintética en autenticación nativa; A0.6.3 y el A0.6.4 de captura real siguen bloqueados.

---

## A0.6.3 — continuación sin Mac ni ROM privada (24/10/2026)

**Objetivo:** avanzar en gates sintéticos sin confundir una regresión ROM-free con la certificación de banco real. El repositorio sigue en `main`, sin GitHub Actions.

1. **A0.6.3.H1 — integridad de implementación (independiente de captura).**
   - H1.1: revisar sintaxis de `r3_bank_provenance.py` y parser del preestado; un `\\n` literal dentro de la firma de `diagnose_trace_signatures` fue corregido en `669ff08`.
   - H1.2: comprobar guardas de correspondencia (nueve registros, PC, número de línea y firma de banco) y carácter exclusivamente diagnóstico del enmascaramiento de 8 bits. Revisión estática: 11/11 invariantes comprobadas; **no significa suite ejecutada**.
2. **A0.6.3.H2 — validación remota ROM-free (sin hardware ni secretos).**
   - H2.1: crear un Codespace temporal en GitHub desde navegador móvil, *si está habilitado*, sin publicar ROM ni archivos `out/`.
   - H2.2: ejecutar `bash scripts/r3-local-regression.sh`. Criterio: todas las pruebas Node/Python pasan en un checkout limpio de `main`. El runner no llama a MAME ni necesita ROM. No reactivar Actions.
3. **A0.6.3.N1 — validación nativa pendiente (requiere privados conservados en Mac).**
   - N1.1: `python3 scripts/r3_bank_provenance.py diagnose` sobre las trazas privadas; revisar recuentos de overflow y contraste agregado contra bancos auténticos.
   - N1.2: aceptar banco por preinstrucción solo con firmas auténticas válidas y witness 1:1. Nunca inferir `A0.6.3=PASS` de ejemplos sintéticos ni de aplicar `&0xff`.
   - N1.3: únicamente tras N1.2, ejecutar `bash scripts/r3-banked-critical-path.sh` para certificar A0.6.4.

**Dependencias:** H1 → H2; N1 depende de disponer de evidencia privada en Mac, no de H2 por sí sola. A0.6.4 real depende de N1.2. Un Codespace sin ROM sirve exclusivamente para H2. Sin acceso al Mac, mantener **A0.6.3 y A0.6.4 reales bloqueados**; continuar hardening, fixtures y compilación estática sin atribuir bancos nativos inventados.

---

## A0.6.3 — diagnóstico offline de firmas fuera de rango (22/10/2026)

**Resultado nativo:** 60/60 Node, 6/6 Python inventario y 13/13 Python procedencia PASS en Mac; 17.135/17.135 líneas tienen PC y ambas firmas; 0 divergencias CPU/PC/línea. Las 17.135 firmas tienen por lo menos un campo mayor que 0xFF, de modo que `report` se bloquea correctamente por `A063_NATIVE_SIGNATURE_EXCEEDS_BYTE`. **No es A0.6.3 PASS.**

El código del debugger MAME upstream (`src/emu/debug/express.cpp`) define `b@` como lectura de 1 byte, que devuelve <= 0xFF; `tracelog` usa un formato con ancho mínimo. No basta alegar que el ancho `%02X` generó una extensión de 64 bits: los datos son inconsistentes con esa semántica. Por eso **no se aceptan valores enmascarados** ni se genera witness a partir de `value & 0xff`.

Se amplió `diagnose` para distinguir por firma qué campos exceden un byte, si los bits altos reproducen patrones 32/64-bit y cuántas parejas serían compatibles con los cinco bancos autenticados **solo después de enmascarar**. Esto último es una hipótesis diagnóstica, no una equivalencia validada. Todos los recuentos permanecen agregados, sin bytes, PC, ROM o estado CPU.

Para determinar la siguiente corrección sin repetir MAME ni exponer privados:

```bash
git pull --ff-only
bash scripts/r3-local-regression.sh
python3 scripts/r3_bank_provenance.py diagnose
```

Compartir únicamente ese JSON. **No lanzar nueva captura MAME**, ni el gate A0.6.4, hasta revisar si ambos campos contienen valores no-byte y si sus 8 bits bajos corresponden a bancos reales. A0.6.3 permanece bloqueado mientras la firma completa no sea válida o exista prueba independiente de la codificación alternativa.

---

## A0.6.3 — integridad de enlace CPU y banco (22/10/2026)

El parser ahora exige en una misma línea la firma bancaria única y los nueve registros del preestado R2; verifica también el número de línea nativo si consta en JSONL. Rechaza emparejamientos de registros distintos aunque coincida el PC, y marcadores duplicados. El diagnóstico seguro alinea las líneas de preestado reales incluso si una pareja de firmas está malformada. También se corrigió el test A0.6.4 que esperaba `NOP` en `0x4002`, donde el fixture contiene `JMP_EXT`.

**Pendiente:** ejecutar regresión y reutilizar evidencia privada en Mac; no declarar A0.6.3 PASS antes de correspondencia nativa 1:1. Sin GitHub Actions:

```bash
git pull --ff-only
bash scripts/r3-local-regression.sh
bash scripts/r3-banked-critical-path.sh
```

Ante un bloqueo, compartir solo `gng.a06.bank-trace-shape-diagnostic.v1` y el error; nunca `cpu.trace`, firmas ni ROM.

---

## Incidencia A0.6.3 en Mac y reparación offline (22/10/2026)

**Resultado operator Mac:** al ejecutar `git pull --ff-only; bash scripts/r3-local-regression.sh; bash scripts/r3-bank-provenance-capture.sh`, la suite Node quedó en **58/60**. Los dos fallos del test `test_r3_banked_static_gate.mjs` provenían del *fixture ROM-free*, que hacía que un `NOP` en `0x4002` «saltase» a `0x4000` sin branch. Se corrigió por un `JMP 0x6000` compilado, con cambio explícito de banco en una sección de ROM fija. El fixture negativo ahora comprueba el PC correcto. **No se altera la lógica del compilador productivo para ocultar divergencias.**

La nueva ejecución de MAME **sí finalizó con exit=0**, extrajo otra vez **17.135** preestados y revalidó B4 `MAME_UNMAPPED_POLICY_MATCHES_NATIVE_TAPS_AND_STATIC_LDA` y A0.4 `NATIVE_VIDEO_WRITES_MATCH_GENERATED_STATIC_JS` para **4096/4096** escrituras, sin diferencias ni eventos extra. Falló **solamente** el parseo de A0.6.3: `A063_TRACE_MARKERS_NOT_SAME_INSTRUCTION`. Por ello A0.6.3 y A0.6.4 **NO están cerradas**, aunque los datos brutos quedaron privados en el Mac.

**Cambios de reparación:** `r3_bank_provenance.py` tolera anchos de campo hexadecimal variables (MAME `%02X` especifica ancho **mínimo**), acepta un prefijo `0x` cuando corresponda y **rechaza**, sin truncar, valores superiores a un byte. Mantiene el requisito estricto de marcador PC y dos firmas en la **misma línea nativa**, con alineación 1:1 con `pre-instruction.jsonl`. Se añadió modo `diagnose` que solo comunica conteos y formas de campos —sin bytes, PC concretos ni disassembly—. Los tests nuevos prueban estas variantes y corrupciones; **aún no están ejecutados en el Mac**.

**Recuperación SIN nueva captura y SIN GitHub Actions:**

```bash
git pull --ff-only
bash scripts/r3-local-regression.sh
bash scripts/r3-banked-critical-path.sh
```

`r3-banked-critical-path.sh` imprime primero el diagnóstico redacted; luego reintenta el informe A0.6.3 y, **solo si pasa**, recompila los pares (banco, PC) mediante A0.6.4. Si todavía falla, compartir únicamente el JSON `gng.a06.bank-trace-shape-diagnostic.v1` y la línea de error —**nunca** `cpu.trace` ni los bytes de firma—. No repetir `r3-bank-provenance-capture.sh` hasta determinar si el problema es solo formato o la acción MAME no emitió ambos campos.

---

## A0.6.1/2 real PASS → A0.6.3 banco por instrucción + A0.6.4 AOT bancario (22/10/2026)

**Confirmado por operador Mac:** 55/55 pruebas Node y 6/6 Python PASS. Inventario autenticó **5×8192 bytes = 40.960**, empaquetados desde el ZIP original con CRC; ROM fija sin cambios. Captura existente: **17.135** prestates, **7.434** en ventana bancaria, solo **7 PCs distintos**, banco inicial del debugger observado 0, dos frames con banco 0 y dos con banco 3; **una** escritura registrada al selector `0x3e00` que seleccionaría banco 3. **No se puede atribuir el banco por PC con esas muestras**. A0.6.1/2 aceptados, sin hacer equivalencia CPU o IRQ.

**A0.6.3 — captura por instrucción implementada, validación Mac pendiente:**

- `scripts/r3_bank_provenance.py`: elige dos offsets `0x4000–0x5fff` cuya **pareja de bytes distingue de forma única** los 5 bancos autenticados (búsqueda determinista de patrones, fallo cerrado sin pareja única). Produce configuración privada en `out/r3/banked-provenance`; **no** comparte bytes ROM ni firmas.
- `scripts/r2-mame-probe.sh`: opt-in, en el **mismo** callback `trace` por instrucción MAME, imprime los nueve registros CPU y dos valores `b@ADDR` sin efectos secundarios. [MAME debugger expressions](https://docs.mamedev.org/debugger/index.html) documenta `b@` como acceso byte al programa con efectos laterales suprimidos. **No requiere un binario MAME recompilado.** El parser exige los dos `GNG_A06_BANKSIG` en la MISMA línea que el preestado, firma única, exactamente un registro por instrucción y PC/seq alineados.
- Reporte `gng.a06.native-bank-per-instruction.v1`: identifica el banco visible para **cada preestado**, cuenta combinaciones (banco,PC) y detecta transiciones, distinguiendo reset suave de cambios consecutivos. **No equivale a traza nativa de fetch ni a certificación de todas las escrituras del selector**. Se guarda un witness privado `private-bank-per-prestate.jsonl` y un manifiesto SHA256 de los archivos nativos y ROM para prevenir mezclar distintas corridas.
- `scripts/r3-bank-provenance-capture.sh`: **una sola ejecución MAME local**, reutiliza backups del wrapper R3 y mantiene los gates B4 lectura sin handler + A0.4 escrituras VRAM. Luego ejecuta el diagnóstico bancario y la recompilación A0.6.4.

**A0.6.4 — compilación bancaria ya implementada pero depende estrictamente del reporte A0.6.3 real:**

- `compileAt` acepta opcionalmente `{banked:true}` solo sobre un *view* de ROM preparada para una entrada. El modo por defecto **sigue rechazando PCs bancarios**. Se rechazan instrucciones que crucen el límite `0x5fff`.
- `scripts/r3_banked_static_gate.mjs` exige hashes idénticos de ROM, CPU debugger trace, TSV y witness, revalida arranque/sprites R3.3 y SYNC con la misma captura, y genera **un módulo JS estático por banco** a partir de las parejas (banco,PC) autenticadas. Evalúa opcodes sin efectos RAM desde un preestado MAME **por instrucción**, compara el siguiente checkpoint y señala familias faltantes, divergencias o efectos de memoria sin certificar. Nunca incorpora un intérprete CPU en runtime ni declara CPU autónoma.
- Tests ROM-free nuevos: `test_r3_bank_provenance.py` (capturas corruptas, firmas y transiciones) y `test_r3_banked_static_gate.mjs` (mismo PC en bancos distintos, límites y desvíos). Incorporados al runner local; **todavía no validados por el operador**. Los workflows de GitHub Actions siguen eliminados.

**Ejecutar en el Mac (primero tests sin ROM; después UNA captura MAME):**

```bash
git pull --ff-only
bash scripts/r3-local-regression.sh
bash scripts/r3-bank-provenance-capture.sh
```

Si la captura nativa funciona, el último comando emite dos JSON agregados (A0.6.3 y A0.6.4), nunca bytes ROM ni estados CPU. Si se necesita repetir **solo el análisis offline sin ejecutar MAME**: `bash scripts/r3-banked-critical-path.sh`. No compartir `cpu.trace`, `private-bank-per-prestate.jsonl`, imágenes ROM ni código generado bajo `out/`.

**Próxima dependencia:** las familias de opcodes bancarios más frecuentes según ese análisis, luego modelar `0x3e00` como escritura en la board y demostrar el despertar IRQ/SYNCACK con el hook nativo de R3.5.B2 o evidencia equivalente. **R4 sigue bloqueado**: no hay CPU autónoma desde reset, ni primer frame JS reproducido.

---

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
