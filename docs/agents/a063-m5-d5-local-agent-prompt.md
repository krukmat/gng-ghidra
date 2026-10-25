# Prompt operativo — agente local GPT-6.1 High / Claude Opus 5.5

> Copiar **el bloque siguiente** como instrucción al agente de coding que tenga acceso al checkout local `gng-ghidra` y al Docker/Colima del Mac M5 Pro. El documento de referencia es `docs/audit/a063-m5-d5-oracle-out-of-range-handoff.md`.

---

Eres el agente responsable de **desbloquear A0.6.3/M5.D5** del proyecto privado `krukmat/gng-ghidra`. Trabajas **localmente** en MacBook Pro M5 Pro, con Docker/Colima Linux ARM64. Tu prioridad es certeza forense, cambios mínimos, reutilización de evidencia y **cero gasto adicional**.

## Contexto fijo que debes preservar

- Rama: `feature/a063-r1-forensics-contract`. NO toques `main`, no cambies de rama sin necesidad, no hagas `git stash/reset/clean`.
- MAME 0.289 diagnostic ARM64 compilado y verificado: `/mame/mame0289/gnga063` dentro del volumen Docker `gng-a063-mame0289-arm64-v1`. SHA-256: `80c447cd81fa91be8bf3159e22dedab157798a4f1a189e6680849179b0ac282d`. No recompiles.
- Imagen Docker local: `gng-a063-m5:local`. Datos privados persistentes: `gng-a063-private-capture-arm64-v1`, bajo `/workspace/out/r3/a063-oracle-smoke/`. NO borres ni sobrescribas estos datos.
- Gates previos PASS: M5.D0–D4, parche MAME exacto, `gngb`, `gng_a063_bank`, verificación de ROM y bancos, Xvfb.
- Captura auténtica ejecutada: MAME exit=0; **41.426 preestados**; parser de CPU PASS; cadena pre/postflight íntegra.
- Resultado D5: `A063_ORACLE=BLOCKED invalid_private_instruction_oracle_evidence`.
- **Nueva causa exacta confirmada por diagnóstico offline:** `D5_DIAGNOSIS=A063_ORACLE_BANK_OUT_OF_RANGE`. Es un valor `E` interpretado mayor que 4 por `parse_driver_entries()`; **no equivale a una discrepancia comprobada entre índices de banco válidos**.
- A0.6.3 y A0.6.4 siguen NOT_CERTIFIED.

Lee primero `docs/audit/a063-m5-d5-oracle-out-of-range-handoff.md` y las fuentes `scripts/a063_bank_oracle_gate.py`, `scripts/a063_trace_contract.py`, `scripts/r3_bank_provenance.py`, `scripts/a063_capture_integrity.py`, `scripts/r2-mame-probe.sh` y `patches/mame0289-a063-bank-oracle.patch`.

## OBJETIVO

1. Aislar cómo el símbolo `gng_a063_bank` / `tracelog` produce una captura de `GNG_A063_ENTRY E=...` que no representa un índice permitido `0..4`, o demostrar otro mecanismo concreto que explique el resultado.
2. Clasificar la causa como **CONFIRMED**, **HYPOTHESIS** o **UNPROVEN**, con evidencia agregada y una ruta de reproducción ROM-free.
3. Proponer y, si corresponde, implementar **la reparación más pequeña** en la rama feature, con tests; no suavizar las invariantes de procedencia.
4. Validar primero offline. Solo realizar una nueva captura o recompilar MAME si la causa y el plan lo justifican y después de informar explícitamente al operador.

## FASE 0 — Obligatoria: protección

- Inspecciona `pwd`, rama, `git status --short`, runtime Docker/Colima y existencia de los volúmenes. No alters el estado existente para «limpiarlo».
- Captura y MAME son **solo lectura** hasta que haya diagnóstico causal.
- Usa Docker local con `--network none`. No iniciar Codespaces, CI, VPS ni builds cloud.
- La función `evaluate()` de `a063_bank_oracle_gate.py` **puede crear** `private-a063-oracle-check.json` si completa; por tanto, NO la invoques sobre el volumen de evidencia como primer paso ni alteres scripts vinculados al preflight. Empieza por inspección y agregación read-only.

## FASE 1 — Diagnóstico offline obligatorio

Puedes ejecutar esta inspección ROM-free de formato. **Solo imprime contadores y longitudes; no valores E, ROM, CPU, PC ni trazas**:

```bash
docker run --rm -i --network none --platform linux/arm64 \
  -v gng-a063-private-capture-arm64-v1:/workspace/out:ro \
  -v "$PWD/scripts:/workspace/scripts:ro" \
  -w /workspace gng-a063-m5:local python3 - <<'PY'
from pathlib import Path
from collections import Counter
import sys
sys.path.insert(0, "/workspace/scripts")
from a063_bank_oracle_gate import ORACLE, MARK

p = Path("/workspace/out/r3/a063-oracle-smoke/cpu.trace")
if not p.is_file():
    raise SystemExit("D5_TRIAGE=BLOCKED_TRACE_NOT_FOUND")

totals = Counter()
widths = Counter()
first_bad = None
ordinal = 0

with p.open(encoding="utf-8", errors="replace") as stream:
    for line in stream:
        if "GNG_R2_PRE" not in line and MARK not in line:
            continue
        ordinal += 1
        totals["cpu_marker_count"] += line.count("GNG_R2_PRE")
        totals["entry_marker_count"] += line.count(MARK)
        matches = list(ORACLE.finditer(line))
        if line.count("GNG_R2_PRE") != 1 or line.count(MARK) != 1 or len(matches) != 1:
            totals["missing_duplicate_or_malformed"] += 1
            if first_bad is None:
                first_bad = ordinal
            continue
        token = matches[0].group(1)
        widths[len(token)] += 1
        entry = int(token, 16)
        if 0 <= entry <= 4:
            totals["E_valid_0_to_4"] += 1
        elif entry <= 255:
            totals["E_invalid_5_to_255"] += 1
            if first_bad is None:
                first_bad = ordinal
        else:
            totals["E_invalid_gt_255"] += 1
            if first_bad is None:
                first_bad = ordinal

print("D5_TRIAGE=AGGREGATE_ONLY")
print("D5_CAPTURE_MARKER_ROWS=", ordinal)
for key in sorted(totals):
    print(key + "=", totals[key])
print("E_token_hex_digit_width_histogram=", dict(sorted(widths.items())))
print("first_bad_marker_ordinal=", first_bad)
print("D5_KNOWN_EXCEPTION=A063_ORACLE_BANK_OUT_OF_RANGE")
PY
```

Compara la cantidad de marcadores E con los 41.426 preestados sin imprimir las líneas de captura. **Si el script falla**, diagnostica localmente, pero no copies trazas al agente remoto ni a archivos versionados. Si tienes acceso completo local a las ROM, cualquier inspección del contenido es privada y queda fuera de los entregables compartibles.

Debes razonar sobre:

- Semántica de `debug/debugcpu.h` y `debug/express.h` en MAME **tag mame0289**, no la API de `master`.
- Cómo se construye `gng_a063_bank` en `patches/mame0289-a063-bank-oracle.patch` y cuándo se evalúa `m_mainbank->entry()`.
- Formato de `tracelog` de MAME 0.289: aridad y evaluación de las **12** expresiones (9 CPU + 2 lecturas `b@` + banco E); si `%02X` equivale a ancho mínimo y qué tipo interno se imprime.
- Revisión separada de `parse_debugger_bank_signatures()` y `parse_driver_entries()`. La excepción actual ocurrió **después** del parseo de firmas ROM y **antes** de `compare()`.
- Si el problema es derivado del valor real o de su formato, propon un test ROM-free que distinga ambos sin datos protegidos.

## FASE 2 — Corrección mínima, condicionada

Solo después de describir causa raíz, hipótesis falsadas y pruebas:

- Cambia el mínimo número de archivos. No desactives `A063_ORACLE_BANK_OUT_OF_RANGE`, no uses `&0xff`, módulo 5, slicing/truncamiento, reemplazo por una secuencia adivinada ni joins entre distintas instrucciones.
- Conserva la relación 1:1 `seq/PC/9 registros/firma/banco vivo` y los cinco bancos autenticados; no interpolar por frame o tap.
- Añade tests ROM-free adversariales y negativos que fallen con el bug y pasen con el fix.
- Atención: `a063_trace_contract.SOURCE_FILES` incluye archivos de captura y oráculo; sus hashes están congelados en el preflight. Si modificas alguno, **no uses el preflight previo como certificación**.
- Si el arreglo cambia el productor MAME/debugger, necesitarás **nueva captura de oráculo en directorio privado distinto**; no reutilices evidencia incompatible, no sobreescribas `out/r3/a063-oracle-smoke` ni borres volúmenes. Diseña la migración primero.
- Si afecta C++ requiere reconstrucción incremental MAME, únicamente después de justificarla. No activar `main`, Actions ni cloud.

## FASE 3 — Cierre y reporte

Trabaja con tareas de 1–2 niveles, y entrega al final:

- **Diagnóstico:** nombre exacto del fallo, mecanismo causal y pruebas que lo sostienen; diferencia claramente hecho vs hipótesis.
- **Estado:** `D5_DIAGNOSED`, `D5_FIXED_ROMFREE_NOT_NATIVE`, `D5_RECAPTURE_REQUIRED` o `D5_NATIVE_MINIPROBE_PASS_NOT_FULL_A063`. Jamás declarar A0.6.3 PASS sin prueba completa.
- **Tests:** comando, resultado y alcance; no equiparar sintéticos con evidencia nativa.
- **Archivos modificados** y por qué.
- **Próxima acción**: un comando local reproducible que preserve todos los datos privados.
- **Publicación:** si hay cambios y pruebas validadas, commit/push **solo** de fuentes, tests y reportes depurados explícitamente seleccionados a la rama feature, sin usar `git add -A` ni modificar `main`. Nunca publicar datos de `roms/`, `out/`, emulador, trace bruto, secuencias de bancos o información de memoria.

**No vuelvas a lanzar MAME ni construirlo por costumbre. Tu primer entregable es la causa concreta del `A063_ORACLE_BANK_OUT_OF_RANGE` que impide usar la captura ya obtenida.**
