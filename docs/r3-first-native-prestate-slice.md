# R3.0 — Primer gate real de lógica MC6809 → JavaScript estático

**Estado:** G1 REAL_ROM_MAME_PASS (616/616 pares admitidos); G2 REPLAY_CONTIGUO_IMPLEMENTADO, PENDIENTE_DE_VALIDACIÓN_REAL  
**Fecha:** 2026-10-22  
**Código:** `scripts/r3_static_trace_probe.mjs`  
**Pruebas:** `tests/test_r3_static_trace_probe.mjs`  
**Dependencias:** R0 y R1 finalizados; R2.2.B1 (17.281 y 17.135 preestados MAME válidos en ejecuciones reales). El gate R2 integral permanece abierto.

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
