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
