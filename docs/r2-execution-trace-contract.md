# R2.1 — Contrato versionado de traza de ejecución MC6809

**Estado:** CONTRACT_DEFINED / REAL_TRACE_NOT_CAPTURED  
**Versión:** `gng.r2.cpu-trace.v1`  
**Fecha:** 2026-10-22  
**Dependencia:** R0 y R1 aceptados, ambos con evidencia local del operador.  
**Objetivo siguiente:** R2.2, instrumentar un oráculo independiente que produzca esta traza a partir de ejecución REAL del juego.

## Alcance y separación de responsabilidades

El renderer R1 es exacto en dos frames (1660 y 1700) **alimentado con memoria capturada**; no ejecuta MC6809. R2 rastrea el programa original a nivel de instrucciones y eventos del bus para comparar después contra bloques JS generados. Ni el capturador ni el motor de referencia pueden reutilizar la interpretación de P-code o las funciones generadas por Ghidra.

Ya existe una referencia externa `elmerucr/mc6809` (fijada a `5bad24375961418d6591491929aea1f4dc8cb90f`) y comparadores para **rutinas aisladas con estados iniciales sintéticos** (120 vectores aprobados en octubre). Este antecedente se conserva, pero **no constituye** la traza de reset → SYNC → primera IRQ de R2. Para R2.2 se evaluará capturar la ejecución en MAME (solo laboratorio) o extender un CPU independiente con una placa/bus modelados y auditados; no inferir equivalencia de un motor respecto a sí mismo.

## Formato de transporte: JSON Lines (`.jsonl`), UTF-8

Cada línea es un único objeto JSON. La primera es `header`, luego registros de evento o instrucciones en **orden absoluto**, y el último es `footer`. Todos los enteros binarios y direcciones se serializan como enteros decimales sin redondear; el visor podrá formatearlos en hexadecimal. No se aceptan campos críticos ausentes, valores `null` para datos desconocidos ni snapshots interpolados.

### Header obligatorio

```json
{
  "schema": "gng.r2.cpu-trace.v1",
  "kind": "header",
  "driver": "gngb",
  "cpu": "maincpu",
  "origin": "mame-independent-debugger",
  "origin_revision": "MAME-version-and-instrumentation-revision",
  "rom_sha256": "64 lowercase hexadecimal characters",
  "input_plan_sha256": "64 lowercase hexadecimal characters",
  "initial_reset_vector": 0,
  "frame_clock": "screen.frame_number",
  "instruction_phase": "pre-fetch",
  "bank_initial": 0,
  "capture_policy": "full-instruction-and-ordered-bus-effects"
}
```

`origin` será un identificador comprobable del proveedor, no el nombre de un módulo JS generado. Los dos SHA-256 y la revisión de instrumentación identifican los insumos; el contenido real permanece local. `bank_initial` debe proceder de una lectura observada de la máquina, no de un valor supuesto. Los literales de ejemplo son *placeholders* y **no son evidencia ni un fixture para aprobación**.

### Registro de instrucción (`step`)

```json
{
  "kind": "step",
  "seq": 0,
  "frame": 0,
  "pc": 0,
  "opcode_bytes": "12",
  "bank": 0,
  "before": {"PC":0,"A":0,"B":0,"X":0,"Y":0,"U":0,"S":0,"DP":0,"CC":0},
  "after": {"PC":0,"A":0,"B":0,"X":0,"Y":0,"U":0,"S":0,"DP":0,"CC":0},
  "bus": [
    {"kind":"read","space":"ram","addr":0,"width":1,"value":0}
  ]
}
```

- `seq`: contador de **todos** los registros (pasos y eventos) empezando en 0 y avanzando exactamente en 1; sin pérdidas ni duplicados.
- `frame`: valor de reloj capturado en la misma fase declarada; no decrece dentro de una sesión.
- `pc` coincide con `before.PC`; `opcode_bytes` corresponde a los bytes de memoria/programa de ese fetch, considerando el banco activo; no al texto disassembly ni a datos derivados del JS.
- `before` y `after`: estado CPU arquitectónico auténtico. A/B/DP/CC tienen rango 0..255; PC/X/Y/U/S, rango 0..65535. El valor de CC debe incluir todos los bits, no solo flags seleccionados.
- `bus`: lecturas y escrituras **en el orden observado por instrucción**; entradas `kind=read|write`, `space=ram|rom|mmio`, dirección 16 bits, `width=1|2`, valor unsigned del tamaño correspondiente. Incluir accesos a pila, memoria videográfica y efectos MMIO. El número de efectos no puede reconstruirse desde un resumen posterior. Las escrituras a banco MMIO se anotan también como evento explícito de cambio.
- `bank`: banco visible para la ventana de ROM `0x4000..0x5fff` antes del fetch. Su transición se observa, no se inventa.

### Registro externo (`event`)

```json
{"kind":"event","seq":1,"frame":0,"pc":0,"name":"RESET","details":{}}
```

Eventos permitidos: `RESET`, `FRAME_BOUNDARY`, `SYNC_ENTER`, `SYNC_EXIT`, `IRQ_ASSERT`, `IRQ_ENTRY`, `IRQ_CLEAR`, `FIRQ_ASSERT`, `FIRQ_ENTRY`, `FIRQ_CLEAR`, `BANK_SWITCH`. Para `BANK_SWITCH`, `details` exige `old_bank`, `new_bank`, `mmio_addr` y `value`. En `IRQ_ENTRY`/`FIRQ_ENTRY` registrar `vector_addr` y `handler_pc`; el vector y su disparo deben provenir del oráculo. Un evento sin instrumentación fiable marca captura incompleta.

### Footer

```json
{
  "kind": "footer",
  "seq": 2,
  "frame": 0,
  "status": "INCOMPLETE",
  "steps": 1,
  "coverage": {
    "reset_observed": true,
    "sync_observed": false,
    "first_irq_entry_observed": false
  },
  "stop_reason": "synthetic schema illustration only"
}
```

El ejemplo entero es **ilustrativo**: no simula ni prueba un arranque válido. Para R2 PASS, el footer tendrá `status=COMPLETE`, `reset_observed=true`, `sync_observed=true` y `first_irq_entry_observed=true`, coherentes con los eventos y el log real. Una captura interrumpida puede ser útil como diagnóstico, nunca como gate aprobado.

## R2.2.B2.a — Bank-select MMIO (instrumentación preparada; validación real pendiente)

**Confirmación en código fuente MAME** [`src/mame/capcom/gng.cpp`](https://github.com/mamedev/mame/blob/master/src/mame/capcom/gng.cpp):

- `gng_main_map` instala `gng_state::bankswitch_w` en **0x3E00** y mapea la ROM con banco en **0x4000–0x5FFF**.
- `bankswitch_w(data)` selecciona banco **4** si `data == 4`; para otros valores selecciona `data & 0x03`. Esta regla es semántica publicada del driver, no una medición del banco activado después de una instrucción.
- La CPU principal usa MC6809 y `irq0_line_hold` asociado al VBLANK. Que exista la configuración no constituye una observación del instante IRQ_ENTRY.

**Cambios en `main`:** `scripts/r2-mame-probe.lua` añade `BANK_CONTROL_WRITE_SAMPLE` al tap de escrituras MMIO existente únicamente cuando `addr == 0x3e00`, incluyendo frame, PC visto por Lua, dirección, byte escrito y `bank.entry` **en el propio callback**. Emite `OBSERVED_BANK_CONTROL_WRITE_COUNT` y conserva como máximo 64 muestras; el exceso se declara truncado. No se toca Blackbox ni se añade un segundo tap que pueda interferir con el primero.

`scripts/r2_probe_report.py` comprueba integridad, rango y contadores de esas muestras, crea `capabilities.bank_control_writes_observed` e informa `bank_control.control_write_count`, `recorded_samples` y los flags **`post_handler_bank_entry_verified=false`**, **`all_bank_edges_verified=false`**. `observed_bank_switch_edges` sigue en **false** aunque haya escrituras válidas: el tap puede ejecutar antes del handler de banco, por lo que leer `bank.entry` en ese instante no demuestra el efecto posterior.

**CI ROM-free:** pruebas de banco válido, dirección incorrecta, muestras ausentes/truncadas y prohibición de dar por demostrados los flancos de banco. [CI PASS](https://github.com/krukmat/gng-ghidra/actions/runs/39734205848).

**Prueba en MAME real — una sola corrida:** conservar la evidencia previa y ejecutar `GNG_R2_PROBE_SOFT_RESET=1 bash scripts/r2-mame-probe.sh`. Revisar `capabilities.json` (sección `bank_control`, `capabilities.bank_control_writes_observed` y `observed_counts`); si el banco no se escribe durante los cuatro primeros frames, el reporte marcará **false** sin inventar transiciones. Mantener `cpu.trace` privado.

**Próxima decisión R2.2.B2.b:** instrumentar los flancos reales de `mainbank` con fuente post-handler o callback de instrucción independiente; registrar IRQ/SYNC con señales del núcleo y no inferir la aceptación de interrupciones a partir de VBLANK o PC. Si Lua/debugger no ofrece esos hooks, implementar una variante diagnóstica del MAME de laboratorio, sin introducir un emulador 6809 en el producto JS.

---

## R2.2.B1 — Alternativa nativa `tracesym` (22/10/2026)

Tras el error real del operador (`16.892` marcadores, `0` registros parsables y fallo del callback de soft reset), se contrastó el contrato con el código de depuración de MAME, `src/emu/debug/debugcmd.cpp`:

- `tracelog` utiliza un `mini_printf` con parámetros interpretados por la consola.
- `tracesym` obtiene directamente los símbolos CPU registrados y formatea los valores según el `device_state_entry` de MAME.
- `trace` ejecuta la acción de depuración antes de cada instrucción. La sonda puede combinar dos comandos dentro de `{...}`.

**Implementación actual:** `scripts/r2-mame-probe.sh` utiliza por defecto
`GNG_R2_TRACE_MODE=tracesym`, generando `{tracelog "GNG_R2_PRE ";tracesym pc,a,b,x,y,u,s,dp,cc}`.
El modo histórico `GNG_R2_TRACE_MODE=printf` se mantiene solo para diagnóstico opt-in;
no se mezclan ambos modos en una misma evidencia. `scripts/r2_pretrace_report.py`
admite mayúsculas/minúsculas, prefijo `0x`, relleno con espacios y cantidades
hexadecimales de hasta 2/4 dígitos, pero rechaza registros ausentes o duplicados,
campos sobreanchos, valores no hexadecimales y trazas parciales.

**CI ROM-free PASS:** [run 39729514466](https://github.com/krukmat/gng-ghidra/actions/runs/39729514466).
No confirma todavía el formato nativo en el Mac.

### Orden de validación revisado

1. **Primero aislar el modo de trazado sin reset** (`GNG_R2_PROBE_SOFT_RESET=0`, `tracesym` predeterminado). No alterar el bot.
2. Comprobar `pretrace-report.json`: `PRE_INSTRUCTION_FORMAT_PARSED`, `snapshots >= 2` y `malformed_markers=0`. Una muestra sintácticamente válida aún no acredita ejecución CPU completa.
3. Solo si (2) pasa, validar el soft reset controlado con `GNG_R2_PROBE_SOFT_RESET=1`. No equipararlo con reset frío.
4. R2.2.B2 aún requiere bus completo por instrucción, salida de registros, bancos e IRQ/SYNC auténticos.

Comando del primer gate:

```bash
git pull --ff-only
GNG_R2_PROBE_SOFT_RESET=0 bash scripts/r2-mame-probe.sh
cat out/r2/mame-probe/pretrace-report.json
```

La salida de `cpu.trace` sigue siendo privada; en caso de error compartir únicamente
`malformed_shapes_redacted` (sin registros/ROM). El estado R2.2 continúa **BLOCKED** hasta una verificación real.

---

## R2.2.B1 — Preestado real por instrucción, controlado (22/10/2026)

**Resultado de la prueba R2.2.A del operador** (`gngb` real): `PARTIAL_NATIVE_INSTRUMENTATION`; traza nativa **314.999 bytes**, **4 frames**, **100 lecturas** y **12 escrituras MMIO**, registros y banco observables. Falta callback de reset inicial, estados de entrada/salida por instrucción, bus completo, cambios de banco y señales SYNC/IRQ.

**Nuevo código**: el launcher añade una acción `tracelog` a cada instrucción en `-debugscript`:

```text
trace <private-path>,:maincpu,noloop,{tracelog "GNG_R2_PRE PC=%04X A=%02X B=%02X X=%04X Y=%04X U=%04X S=%04X DP=%02X CC=%02X",pc,a,b,x,y,u,s,dp,cc}
g
```

La [documentación oficial MAME](https://docs.mamedev.org/debugger/execution.html#trace) asegura la ejecución de la acción antes de escribir cada instrucción y `noloop` evita condensar bucles. El [comando `tracelog`](https://docs.mamedev.org/debugger/general.html#tracelog) usa el mecanismo nativo de expresiones de registros del debugger. El script `scripts/r2_pretrace_report.py` analiza **únicamente** los marcadores `GNG_R2_PRE`, captura `PC,A,B,X,Y,U,S,DP,CC` y conserva el resultado privado en `out/r2/mame-probe/pre-instruction.jsonl`, separado del esquema `gng.r2.cpu-trace.v1`.

El parseo aislado devuelve `PRE_INSTRUCTION_FORMAT_PARSED`, pero mantiene `provenance_authenticated=false`. Solo una ejecución genuina de MAME con `EXIT=0`, el informe de sonda y el archivo nativo de trace permite considerar auténticos los marcadores; las pruebas sintéticas de CI **no** lo demuestran. Sin marcadores o con marcadores incompletos reporta `INSTRUMENTATION_BLOCKED`.

### Reset auténtico después de enganchar Lua (opcional)

La sonda puede programar **una vez** `machine:soft_reset()` después de su primer frame mediante `GNG_R2_PROBE_SOFT_RESET=1`. El notificador `emu.add_machine_reset_notifier` debe corroborar el evento. Si ocurre, `controlled_soft_reset_observed=true`; **no se presenta como reset frío inicial** y no prueba por sí solo el tramo contiguo reset → IRQ. Si el callback no aparece, la sonda conserva el bloqueo.

**Validación en el Mac (no subir los bytes de instrucciones ni las trazas):**

```bash
git pull --ff-only
GNG_R2_PROBE_SOFT_RESET=1 bash scripts/r2-mame-probe.sh
cat out/r2/mame-probe/pretrace-report.json
cat out/r2/mame-probe/capabilities.json
```

Entregar solo estos **dos resúmenes JSON** o errores textuales de MAME. `cpu.trace` y `pre-instruction.jsonl` permanecen en `out/`.

**Todavía NO verificamos:** `after` por instrucción, cada efecto del bus en orden, transición de banco por instrucción, fase exacta de IRQ/FIRQ, SYNC y reset frío inicial. Resolverlos exige R2.2.B2: capturar señales en las APIs de debugger o introducir un adaptador independiente de laboratorio con eventos de inicio/fin de instrucción y bus. Se mantiene **R2.2 ABIERTA** y R2.3 **NO INICIADA**.

---

## R2.2.A — Sonda de capacidades nativas (implementada, NO aceptada en MAME real)

Implementación en `main` (ROM-free CI): `scripts/r2-mame-probe.sh`,
`scripts/r2-mame-probe.lua`, `scripts/r2_probe_report.py` y
`tests/test_r2_mame_probe.py`.

**Fuentes de APIs reales:** [MAME debugger `trace`](https://docs.mamedev.org/debugger/execution.html)
(documenta `trace <file>,<CPU>,noloop` y que `-debugscript` permite
iniciar comandos de depuración), [MAME Lua memory taps](https://docs.mamedev.org/luascript/ref-mem.html)
(documenta `install_read_tap`/`install_write_tap` y sus limitaciones)
y [MAME Lua callbacks](https://docs.mamedev.org/luascript/ref-common.html)
(`add_machine_reset_notifier`, `add_machine_frame_notifier`).

### Instrumentación y cobertura prometida

| Campo | Fuente disponible en sonda | Limitación / aceptación |
| --- | --- | --- |
| driver / revisión | MAME system `gngb` / debugger | Debe ser confirmado en MAME real, no por nombre ZIP |
| Instrucciones / PC | debugger nativo `trace ...,:maincpu,noloop` | Raw trace ≠ `step` JSONL con `opcode_bytes`, `before/after` y bus |
| Registros A/B/X/Y/U/S/DP/CC/PC | Lua `cpu.state` | La sonda detecta disponibilidad; muestras fuera del callback de instrucción, por lo tanto NO prueba registros por step |
| RAM/MMIO | taps de lectura/escritura, sonda MMIO 0x3000–0x3fff | Muestras acotadas y contadores; NO prueba cobertura completa de RAM, ROM, fetch, pila ni orden por instrucción |
| Banco 0x4000–0x5fff | `machine.memory.banks[":mainbank"].entry` | Observa muestras; no todos los flancos de `BANK_SWITCH` |
| Frames | `screen:frame_number()` | Observación al concluir cada frame, no etiqueta atómica por instrucción |
| Reset | `emu.add_machine_reset_notifier` | Si la Lua se engancha tras reset, el campo queda explícitamente ausente; NUNCA se sintetiza |
| SYNC / IRQ / FIRQ | no instrumentado con fidelidad de evento | **INSTRUMENTATION_BLOCKED**, necesidad de una fuente fiable de instrucción/IRQ |

La sonda deliberadamente corre en **otro proceso MAME**, sin Blackbox y sin sustituir la
ROM original. Su resultado no es un replay de la sesión de gameplay R0/R1. El
resultado `PARTIAL_NATIVE_INSTRUMENTATION` indica únicamente que pudieron observarse
datos nativos de CPU/frames; **no cumple** `gng.r2.cpu-trace.v1`, no produce `COMPLETE`
y no abre R2.3.

### Primera prueba local en Mac (solo si CI ROM-free PASS)

```bash
git pull --ff-only
bash scripts/r2-mame-probe.sh
cat out/r2/mame-probe/capabilities.json
```

La sonda utiliza la ROM del operador verificada por
`scripts/prepare_mame_rom.py` y la instalación local de MAME con
`-debug -debugscript`. La ventana del debugger en macOS puede abrirse
separadamente; el `debugscript` intenta continuar la ejecución con `g`.
El comando escribe `out/r2/mame-probe/{cpu.trace,observations.tsv,mame.log,capabilities.json}`.
Si debugger, Lua, ROM o captura no funcionan, se informa un bloqueo sin generar
un archivo de traza R2 falsamente completo. La salida privada no debe subirse a GitHub.

**Siguiente sub-bloque R2.2.B:** validar esta sonda en MAME real y luego resolver
la correlación de inicio/fin de instrucción, cobertura de bus y
`SYNC/IRQ_ENTRY`; si la API pública no es suficiente, diseñar un adaptador
C++ de laboratorio o extensión del oráculo independiente, sin cambiar la
política de fidelidad. R2.2 no se considera terminada antes de ello.

---

## Reglas de aceptación R2.1 y de R2.2

1. Fijar esta versión de formato sin modificar la política del emulador ni relajar los eventos requeridos.
2. R2.2 debe demostrar qué API produce *cada* campo del header, instrucción, bus y eventos; si una API no lo expone, marcar `INSTRUMENTATION_BLOCKED` y documentar la alternativa antes de seguir.
3. Fijar el inicio en reset auténtico, el driver `gngb`, la ROM local y el mismo plan de inputs; capturar secuencia contigua hasta SYNC y primera IRQ atendida, sin omitir eventos que causen divergencias.
4. Validar monotonía, integridad de bytes, estados y cobertura; dos corridas deben ser equivalentes bajo mismas condiciones. Primer error de divergencia detiene R2.4.
5. Trazas reales, ROM, memoria, dumps y capturas solo dentro del directorio gitignored `out/`. CI usa exclusivamente trazas sintéticas y rechazos deliberados.
6. La comparación de R2 será **ejecución CPU contra código generado**. Un PASS del renderer R1 o de vectores aislados T2.B no se contabiliza como un PASS de traza R2.

## Dependencias concretas

```text
R0 (captura real) + R1 (dos frames exactos)
    └── R2.1 contrato [DEFINED]
         └── R2.2 oráculo de reset / MMIO / IRQ [PENDING]
              └── R2.3 traza genuina y reproducible [PENDING]
                   └── R2.4 primer diff CPU↔JS [PENDING]
                        └── R2.5 tests y CI [PENDING] → R3 GO/NO-GO
```

**Próxima implementación:** estudiar un punto de integración independiente con la captura MAME/debugger sin tocar el bot Blackbox (que sigue funcionando). El primer entregable de R2.2 será una tabla de cobertura de los campos, más un smoke test ROM-free del capturador — no una traza inventada.
