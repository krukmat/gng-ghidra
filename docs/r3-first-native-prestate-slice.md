# R3.0 — Primer gate real de lógica MC6809 → JavaScript estático

**Estado:** G1 PASS; G2 PASS; R3.2 REGISTROS REALES PASS (1192/1192, 389 pasos); R3.3 NATIVE SPRITE RAM PASS (768/768 bytes); R3.4 FRONTIER 0x6016 SYNC VALIDADO EN ROM/TRAZA; R3.5 BARRERA SYNC IMPLEMENTADA, IRQ NATIVA PENDIENTE  
**Fecha:** 2026-10-22  
**Código:** `scripts/r3_static_trace_probe.mjs`  
**Pruebas:** `tests/test_r3_static_trace_probe.mjs`  
**Dependencias:** R0 y R1 finalizados; R2.2.B1 (17.281 y 17.135 preestados MAME válidos en ejecuciones reales). El gate R2 integral permanece abierto.

## R3.5 — Frontera SYNC 0x6016: espera compilada, evento aún no demostrado (22/10/2026)

**Prueba real R3.4 aportada por el operador:** `FRONTIER_IDENTIFIED_NOT_COMPILED` en dos boots, PC no compilado **`0x6016`**, familia probable **SYNC**, primera época `seq=388` y segunda `seq=778` después de una instrucción ya compilada en `0x6014`. Ambas parten de la misma ROM privada SHA-256 `fe14e127586245fd4dd0842cd09acdcab44c7ac91cfeff45a8bfccbd03e1b535`, y R3.3 mantiene 768/768 bytes nativos comparados. **El resultado de R3.4 era una pista por familia, no descodificación ni prueba IRQ.**

**Fuente de semántica independiente:** el núcleo MC6809 de MAME implementa [`SYNC` en `base6x09.lst`](https://github.com/mamedev/mame/blob/master/src/devices/cpu/m6809/base6x09.lst). Opcode `0x13` en tabla `m6809.lst`; SYNC consume el byte y espera a que se afirme NMI, FIRQ o IRQ **incluso si está enmascarada**. Si la señal está enmascarada, se reanuda en la siguiente instrucción; si está habilitada, corresponde procesar la entrada de interrupción (pila, vector, CC), lo cual aún NO se ha implementado.

**Código R3.5:**
- `scripts/r3_sync_boundary.mjs` solo compila el byte `0x13` **cuando el ROM real lo contiene exactamente en `0x6016`**. Emite `out/r3/sync-boundary/generated-sync.mjs` con dos funciones estáticas: `enterSync` retorna `SYNC_WAIT` con PC de reanudación `0x6017`; `wakeSync` **requiere una señal externa afirmada** NMI/FIRQ/IRQ para abandonar la espera. No interpreta opcodes, no emite un timer ficticio y no implementa entrada IRQ.
- La máscara `CC.I` y `CC.F` determina `RUNNABLE_AFTER_MASKED_WAKE` frente a `INTERRUPT_ENTRY_REQUIRED`. Esta última **NO** modifica RAM/pila/vector ni afirma handler ejecutado; el origen de la señal siempre se marca `signal_provenance_authenticated=false` si lo proporciona un operador.
- El diagnóstico offline reutiliza `runNativeBootWriteGate`, revalida ROM + pretrace + taps de MAME del mismo proceso, verifica el byte del ROM y los dos preestados en `0x6016` y **clasifica la siguiente dirección vista en el debugger** sin inferir cuál fue la señal externa. `cpu_post_sync_equivalence_verified=false` y `irq_or_firq_or_nmi_assertion_observed=false` permanecen invariantes.
- Tests ROM-free para byte equivocado, PC incorrecto, espera sin señal, wake por IRQ/FIRQ enmascaradas, entrada pendiente por señales habilitadas, ausencia de stack/vector y clasificación que nunca acredita IRQ solo por el PC. [CI PASS](https://github.com/krukmat/gng-ghidra/actions/runs/39756151981).
- **Próximo gate real no destructivo** (usa la misma captura MAME, sin nuevo MAME):
  ```bash
  git pull --ff-only
  node scripts/r3_sync_boundary.mjs
  ```
  Compartir **solo** el resumen JSON (`epochs`, máscara observada, `next_debugger_pc`, `generated_static_js_wait_entered_from_real_prestates`). No compartir ROM, JSONL ni código JS generado.

**Pendiente R3.5.B:** evidencia independiente del momento en que una línea IRQ/FIRQ/NMI se afirma y de su aceptación por CPU (IRQ entry y stack). Hasta entonces `SYNC` es una **barrera correcta implementada**, no un tramo ejecutable validado que cruce una IRQ. El boot R3.3 permanece PASS acotado.

---

## R3.3 PASS real — escrituras nativas del boot (22/10/2026)

El operador ha ejecutado en un proceso nativo MAME `gngb` con tap RAM y soft reset. **`PASS_BOOT_SPRITE_RAM_WRITE_BYTES`**: 192 stores MC6809 de 16 bits por boot, cada uno observado como dos escrituras de byte en MAME; **384/384 bytes en cada uno de los dos boots** y **768/768 bytes en total**, mismos valores, direcciones y orden; ninguna otra escritura nativa en el rango durante las épocas. Todas las comparaciones de registros del boot que soportan el análisis anterior siguen acotadas a la traza auténtica. **R3.3 cerrado para esas escrituras de sprite RAM**; no significa que todas las RAM, CPU bus, IRQ, SYNC o banco sean equivalentes.

## R3.4 — Elegir el siguiente bloque real después del boot (preparado)

Nuevo `scripts/r3_next_frontier.mjs`, completamente offline. **Reejecuta primero el diferencial R3.3 desde la misma ROM, el mismo pretrace y los mismos taps MAME privados**, de modo que un `sprite-native-report.json` antiguo no sirve como prueba. Exige dos épocas válidas y sin otras escrituras de sprite RAM, ROM fija de 64 KiB con vector `0x6000`, y estructura de boot con **96 repeticiones de cada una de las dos instrucciones `STD ,X++` por arranque**. Elige la primera instrucción que realmente no esté compilada **después del exit `0x6014`**, no asume que `0x6014` sea la frontera. La clasificación de opcode es una *pista por familia*; no constituye todavía descodificación Ghidra ni implementación de semántica.

```bash
git pull --ff-only
node scripts/r3_next_frontier.mjs
```

El comando genera únicamente el resumen `out/r3/next-frontier/report.json` (ignorado por Git) y lo imprime. **Solo compartir ese resumen**, nunca datos de `out/r2/mame-probe/`, ROM o JS generado. Un resultado `FRONTIER_IDENTIFIED_NOT_COMPILED` permite elegir R3.5 sobre evidencias en vez de extender opcodes sin prioridad. [Pruebas ROM-free CI PASS](https://github.com/krukmat/gng-ghidra/actions/runs/39754222149).

**Próxima aceptación:** confirmar familia/instrucción/operando por Ghidra y oráculo 6809 independiente, traducir *una instrucción o el menor bloque necesario* y volver a medir longitud continua, memoria y MMIO. El estado de juego ejecutable sigue **false**.

---

## R3.3 — Contrastar las escrituras de sprite RAM con MAME (22/10/2026)

**Nueva evidencia real R3.2 del operador:** `MATCHED_SUPPORTED_PRESTATE_PAIRS` **1192/1192**; **28 PC estáticos** generados; `first_divergence=null`. **389 pasos continuos** con estado JS acumulado desde `0x6000`, y **388** desde `0x6002`, ambos detenidos en `UNCOMPILED_INSTRUCTION`. El contador `modeled_ram_word_writes=384` son **192 escrituras de palabra en cada uno de DOS ciclos de boot independientes**; no 384 en un solo bucle. **R3.2: PASS de registros; escrituras RAM todavía sin contrastar.**

**R3.3 implementado** para adquirir esa evidencia:

- `scripts/r2-mame-probe.lua` añade `GNG_R2_PROBE_SPRITE_RAM=1` (desactivado por defecto): instala un tap independiente sobre **0x1e00–0x1fff**, captura cada **byte escrito**, dirección, dato y máscara, con tope 4096 y contador que detecta truncamientos. Captura dos ciclos de arranque antes/después de un soft reset controlado. **No es captura exhaustiva del bus**.
- `scripts/r3_compare_sprite_writes.mjs` parte de `r3_static_trace_probe.mjs`, recompila a JS estático desde los bytes locales autenticados y exige **dos bucles completos**, cada uno con **192 escrituras de palabra / 384 bytes** y registros coincidentes en todos los checkpoints. Contrasta en orden las 384 muestras por boot con el tap nativo de MAME; rechaza muestras ausentes, distinto valor, dirección incorrecta, orden distinto, contador truncado, ausencia de reset causal, evidencia ambigua y bucles parciales. No usa PC leído dentro del tap como límite de instrucción: ese PC puede ser posterior al fetch.
- Reporte `out/r3/sprite-native/sprite-native-report.json` resume únicamente conteos/estados, **sin registros, bytes de ROM, direcciones ni valores de RAM**. `PASS_BOOT_SPRITE_RAM_WRITE_BYTES` significará que los **bytes reales escritos en los dos bucles boot** coinciden con los generados, no que todo el sistema de memoria coincida.
- El wrapper `scripts/r3-native-sprite-verify.sh` hace copia privada de la sonda R2 previa bajo `out/r3/probe-before-sprite.XXXXXXXX/` antes de capturar con MAME. Reutiliza la ROM ya validada y ejecuta el diferencial.
- Pruebas sintéticas ROM-free ejercitan el orden, bytes, valores/mascaras erróneos, truncamientos, duplicados, otros accesos ajenos al boot y prohibición de afirmar equivalencia total.

**Ejecutar una sola captura nativa cuando corresponda:**

```bash
git pull --ff-only
bash scripts/r3-native-sprite-verify.sh
```

La salida incluirá `boot_runs_compared`, `compiled_sprite_ram_word_writes`, `native_sprite_byte_samples`, los dos `per_boot` y el estado. No compartir `cpu.trace`, `observations.tsv`, `pre-instruction.jsonl`, ROM ni `static-rom-slice.mjs`; todo queda en `out/`. Si MAME no emite la máscara esperada, el verificador **bloquea** en lugar de reinterpretar silenciosamente el bus.

**Pendiente tras R3.3:** estado de memoria completo, flancos banco post-handler, SYNC/IRQ y demo ejecutable de juego. El gate R3 definitivo permanece abierto.

---

## Gate G2 real superado y siguiente prueba R3.2 (22/10/2026)

**G2 real validado por el operador:** `MATCHED_SUPPORTED_PRESTATE_PAIRS`, **616/616** comparaciones de registros, `401` segmentos, `108` con dos o más pasos y **tres** segmentos con cuatro pasos consecutivos, `first_divergence=null`. Arrancan entre otras direcciones en `0x6000`, `0x6036` y `0x604a`, terminando en `UNCOMPILED_INSTRUCTION`. Esto confirma el G2 *preliminar* de registros/control, pero no la equivalencia de memoria/bus/IRQ.

**R3.2 implementado**: las posiciones de boot `0x600c` y `0x600e` del ROM `gngb` contienen `STD ,X++` (`ED 81`), y `0x6010` contiene `LEAY -1,Y` (`31 3F`), ya descodificadas antes por `src/poc.py`. El compilador R3 reconoce **exclusivamente** estas direcciones y bytes; genera escrituras de palabra de 16 bits para sprite RAM `0x1e00..0x1fff` con comprobación estricta de límites y sink obligatorio, y actualiza los registros/CC de acuerdo con el MC6809. El renderizado y Blackbox no se modifican.

Cada instrucción `STD` produce el *efecto de memoria que esperamos* en el JS generado, pero MAME aún no exporta una lista comparable de escrituras RAM. El reporte mantiene **`ram_writes_compared_with_mame=false`** y **`generated_sprite_ram_writes_unverified_by_reference=true`**. No rellenamos RAM desconocida con cero ni afirmamos un `BANK_SWITCH` o una IRQ.

**Pruebas ROM-free** sobre un pequeño bucle sintético: doce pasos JS continuos de registros, cuatro escrituras de palabra modeladas, incremento del puntero X, CC N/Z/V y LEAY Z, guardas de rango y divergencias. [GitHub CI PASS](https://github.com/krukmat/gng-ghidra/actions/runs/39748424402).

**Único siguiente comando con la ROM y la traza reales ya disponibles en Mac:**

```bash
git pull --ff-only
bash scripts/r3-first-real-slice.sh
```

Informar `status`, `matching_pairs`, `contiguous.longest_segment_steps`, `contiguous.modeled_ram_word_writes`, `top_segments` y `first_divergence`, o fallo textual. Sin volver a ejecutar MAME ni Ghidra y sin divulgar ROM, JS generado, snapshots ni datos de memoria. Si el reset loop llega más lejos que cuatro instrucciones, hemos aumentado *cobertura de registros* real, no equivalencia de RAM.

---

## Validación real R3.0 G1 — 22 de octubre de 2026

**Resultado del operador en Mac:** `bash scripts/r3-first-real-slice.sh` preparó la imagen fija de ROM verificada desde `roms/gng.zip`, SHA-256 `fe14e127586245fd4dd0842cd09acdcab44c7ac91cfeff45a8bfccbd03e1b535`, y comparó **616/616 pares preinstrucción reales de MAME con JS estático generado**, sin divergencias (`MATCHED_SUPPORTED_PRESTATE_PAIRS`). Se compilaron **25 direcciones PC** distintas. **G1 PASS acotado:** solo instrucciones de registros/control admitidas en ROM fija, con un reinicio desde cada preestado MAME para la comparación de una instrucción. No demuestra 616 instrucciones consecutivas ni equivalencia de memoria/bus/IRQ.

## R3.1 — Replay continuo de registros/control, una única entrada MAME por segmento

`scripts/r3_static_trace_probe.mjs` ahora también produce `report.contiguous` con esquema `gng.r3.contiguous-register-only.v1`:

- Se inicia un segmento desde **un único preestado de MAME**. El registro de salida del JS generado pasa como entrada al siguiente paso JS del segmento.
- Después de cada instrucción se compara contra el siguiente preestado MAME. Si aparece un opcode sin compilar, una divergencia o el final del trace, **se cierra el segmento**. Nunca se mezclan como continuas coincidencias separadas.
- Informa `longest_segment_steps`, `segments_at_least_2`, `segments_at_least_4`, `top_segments`, `first_divergence`, y contadores de pares soportados/no soportados.
- `reinjects_mame_state_per_instruction=false` se aplica dentro de cada segmento; el único reinicio permitido ocurre **entre** segmentos separados.
- El reporte no incluye registros, bytes, ROM ni fragmentos de código; puede compartirse como JSON agregado. Generación y pruebas de replay son ROM-free en CI; [ejecución aprobada](https://github.com/krukmat/gng-ghidra/actions/runs/39746370288).

**Gate G2 preliminar (pendiente en Mac):** al menos cuatro instrucciones seguidas con el estado **acumulado** del JS concordando con todos los preestados MAME intermedios. Incluso un `FOUR_PLUS_STEPS_OBSERVED` valida exclusivamente el subconjunto de registros/control y no reemplaza el requisito R3 completo (RAM/MMIO/IRQ). Si no hay segmento de cuatro, el informe sigue siendo útil para seleccionar la próxima instrucción a compilar.

**Operador — misma ROM y traza ya verificadas; no repetir MAME:**

```bash
git pull --ff-only
bash scripts/r3-first-real-slice.sh
```

Devolver únicamente la sección `contiguous` que imprime el wrapper, o extraerla desde `out/r3/static-mame-prestate/report.json`:

```bash
python3 - <<'PY'
import json
from pathlib import Path
r=json.loads(Path('out/r3/static-mame-prestate/report.json').read_text())
print(json.dumps(r['contiguous'],indent=2))
PY
```

Una discrepancia de PC/CC durante una IRQ pendiente sigue siendo evidencia de un límite del modelo, no motivo para ignorarla ni inventar el evento.

---

## Motivación

Prioridad: demostrar ya una transición verificable **ROM original → código JS generado y ejecutado → comparación con CPU MAME**, en vez de seguir ampliando indefinidamente el observador. Reutilizar `out/r2/mame-probe/pre-instruction.jsonl` ya capturado, sin nueva sesión MAME.

Este experimento complementa —no sustituye— los diferenciales independientes previos de las rutinas `0x622c`/`0x6755` con estados sintéticos. Aquellos sí compararon el motor JS con la CPU de terceros bajo estados controlados, pero no probaron condiciones de entrada reales. Este paso usa **estados registrados por MAME auténtico**, pero únicamente en operaciones sin acceso a memoria y aún no demuestra bus/IRQ.

## Arquitectura de este pequeño gate

```text
Mac local: out/gngb-flat.bin        out/r2/mame-probe/pre-instruction.jsonl
          ROM privada (64 KiB)      MAME real (17k+ registros)
                    │                      │
                    ▼                      │
        R3 compileAt en Node                │
        reconoce instrucciones              │
        soportadas del ROM                  │
                    │                      │
                    ▼                      │
        out/r3/static-mame-prestate/         │
           static-rom-slice.mjs              │
        módulo con JS estático por PC       │
                    │                      │
                    └───────┬───────────────┘
                            ▼
             aplicar 1 paso JS a preestado anterior
             comparar PC/A/B/X/Y/U/S/DP/CC con
             siguiente preestado MAME del mismo stream
                            │
                            ▼
                   out/r3/.../report.json
```

Las instrucciones se descodifican **en la compilación**, no durante la ejecución. El módulo generado usa `switch(PC)` de bloques estáticos con operaciones JS directas; no recibe la ROM ni interpreta opcodes. Todas las salidas, incluyendo los inmediatos extraídos de la ROM, permanecen en directorios gitignored `out/`.

### Subconjunto inicialmente admitido

Instrucciones que no realizan RAM/ROM/MMIO en su semántica principal: `NOP`, `ORCC #`, `ANDCC #`, `LDA/LDB/LDX/LDU/LDD/LDY/LDS #`, `BRA`, `LBRA`, `BNE`, `BEQ` y `JMP extended` hacia PC fijo (sin lectura de datos). Las cargas inmediatas actualizan N/Z/V y preservan los demás bits de CC. Se rechaza todo opcode y dirección no soportada. El código fijo se toma **únicamente de la región ROM `0x6000–0xffff`**; la ventana bancaria `0x4000–0x5fff` no se compila aquí.

**Comparación estricta:** cada par adyacente de snapshots `seq n` y `seq n+1` se procesa cuando la primera dirección tiene un bloque compilable. Se comparan los nueve registros y se informa la primera discrepancia de la sesión **sin ocultarla**. Si una IRQ intervino entre los dos hooks, puede causar un mismatch legítimo que se investiga; no se salta ese par ni se declara equivalencia por la coincidencia de PC. No se aplican estados `after` inventados.

## Primera ejecución real (Mac)

El operador ya tiene `roms/gng.zip` verificada por MAME, pero su prueba inicial R3 devolvió `ENOENT: out/gngb-flat.bin`. No indica que falte la ROM original ni que haya divergencia CPU: solo faltaba la **vista plana local** generada anteriormente por `src/poc.py`.

La siguiente entrada única ejecuta el preflight y luego el test **sin iniciar MAME ni Ghidra**:

```bash
git pull --ff-only
bash scripts/r3-first-real-slice.sh
```

`scripts/prepare_r3_flat_rom.py` reutiliza el **mismo** `poc.read_rom` con sus CRC esperados de `gg4.bin`, `gg3.bin`, `gg5.bin` y reset `0x6000`, produce `out/gngb-flat.bin` solo cuando falta y rehúsa sobrescribir una imagen existente que no coincida con el ZIP. La ventana bancaria `0x4000..0x5fff` es una vista estática de banco 4, **no** un modelo de cambio de bancos. `scripts/r3-first-real-slice.sh` invoca el comparador original con `pre-instruction.jsonl` local, sin reejecutar las pruebas de MAME.

Salida privada en `out/r3/static-mame-prestate/report.json` y `static-rom-slice.mjs`, ambos gitignored. Enviar solo la salida del terminal o campos agregados del informe. Si falla, conservar el motivo textual; no inventar ROM/estado.

Para obtener solo datos agregados, sin código ROM ni registros:

```bash
python3 - <<'PY'
import json
from pathlib import Path
r=json.loads(Path('out/r3/static-mame-prestate/report.json').read_text())
print(json.dumps({k:r[k] for k in (
  'status','compiled_pc_count','compared_pairs','matching_pairs',
  'distinct_compared_pc','first_divergence',
  'full_game_or_bus_irq_equivalence_verified')},indent=2))
PY
```

**Salida esperada:** `MATCHED_SUPPORTED_PRESTATE_PAIRS`, `FIRST_DIVERGENCE` o `NO_SUPPORTED_NATIVE_PAIR`. El comando devuelve código distinto de 0 cuando no hay pares soportados o aparece divergencia: es una señal diagnóstica, no un problema que se oculte.

### Gates

- **G0 — PASS:** `node --test tests/test_r3_static_trace_probe.mjs` en CI ROM-free. Verificar que los bytes sintéticos permiten generar JS estático, ejecutarlo y detectar errores deliberados de flags, saltos, snapshots, secuencias, límites y ROM.
- **G1 — PASS (616/616 pares admitidos; 25 PC compilados):** al menos 1 par de preestados **realmente capturados por MAME** coincide con el resultado del JS generado desde bytes de ROM privados y el modelo de registros. No confundir un acierto de una instrucción con compatibilidad de toda una función.
- **G2 — PENDIENTE:** reunir una subsecuencia real contigua de varias instrucciones soportadas, o ampliar el traductor a memoria/stack/bus con verificación independiente. Este gate **no** se satisface por coincidencias separadas a lo largo de la traza.
- **G3 — PENDIENTE:** reset → IRQ con cambios completos de estado y eventos MMIO/banco/stack. Es el criterio previo de R2/R3, y sigue bloqueado.

**Límites deliberados:** no hay todavía atribución causal completa de la traza MAME, ni comparación de efectos RAM/MMIO, ni IRQ/SYNC o bancos. La validación de CC/PC solo es válida para las instrucciones admitidas. La verificación de bytes y estado real se obtiene de fuentes locales distintas, pero el informe no certifica por sí solo la procedencia criptográfica de la sesión MAME (`reference_provenance_independently_authenticated=false`).

**Próximo bloque cuando G1 tenga evidencia:** si `FIRST_DIVERGENCE`, identificar la instrucción y si hubo una interrupción/bus que impide el supuesto de contigüidad; si no hubo pares, clasificar opcodes reales elegibles y añadir **solo** la mínima operación necesaria para conseguir un par continuo, probándola primero con un oráculo MC6809 independiente; después ampliar hasta un bloque de arranque significativo. No sustituir ejecución por una tabla de resultados esperados.
