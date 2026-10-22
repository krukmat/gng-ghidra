# R3.0 — Primer gate real de lógica MC6809 → JavaScript estático

**Estado:** IMPLEMENTED_AND_CI_ROM_FREE_PASS / REAL_ROM_MAME_COMPARISON_PENDING  
**Fecha:** 2026-10-22  
**Código:** `scripts/r3_static_trace_probe.mjs`  
**Pruebas:** `tests/test_r3_static_trace_probe.mjs`  
**Dependencias:** R0 y R1 finalizados; R2.2.B1 (17.281 y 17.135 preestados MAME válidos en ejecuciones reales). El gate R2 integral permanece abierto.

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

El fichero `out/gngb-flat.bin` es el flat ROM privado previamente generado. Si falta, **no generar otra imagen sintética** ni descargar ROM: restaurar la ROM verificada por el flujo de Ghidra.

```bash
git pull --ff-only
node scripts/r3_static_trace_probe.mjs \
  --rom out/gngb-flat.bin \
  --trace out/r2/mame-probe/pre-instruction.jsonl \
  --out out/r3/static-mame-prestate
```

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
- **G1 — PENDIENTE:** al menos 1 par de preestados **realmente capturados por MAME** coincide con el resultado del JS generado desde bytes de ROM privados y el modelo de registros. No confundir un acierto de una instrucción con compatibilidad de toda una función.
- **G2 — PENDIENTE:** reunir una subsecuencia real contigua de varias instrucciones soportadas, o ampliar el traductor a memoria/stack/bus con verificación independiente. Este gate **no** se satisface por coincidencias separadas a lo largo de la traza.
- **G3 — PENDIENTE:** reset → IRQ con cambios completos de estado y eventos MMIO/banco/stack. Es el criterio previo de R2/R3, y sigue bloqueado.

**Límites deliberados:** no hay todavía atribución causal completa de la traza MAME, ni comparación de efectos RAM/MMIO, ni IRQ/SYNC o bancos. La validación de CC/PC solo es válida para las instrucciones admitidas. La verificación de bytes y estado real se obtiene de fuentes locales distintas, pero el informe no certifica por sí solo la procedencia criptográfica de la sesión MAME (`reference_provenance_independently_authenticated=false`).

**Próximo bloque cuando G1 tenga evidencia:** si `FIRST_DIVERGENCE`, identificar la instrucción y si hubo una interrupción/bus que impide el supuesto de contigüidad; si no hubo pares, clasificar opcodes reales elegibles y añadir **solo** la mínima operación necesaria para conseguir un par continuo, probándola primero con un oráculo MC6809 independiente; después ampliar hasta un bloque de arranque significativo. No sustituir ejecución por una tabla de resultados esperados.
