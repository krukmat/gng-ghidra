# A0.6.3 — M5.D5: investigación del oráculo nativo (handoff)

**Checkpoint:** 2026-10-25  
**Repositorio privado:** `krukmat/gng-ghidra`  
**Rama:** `feature/a063-r1-forensics-contract` (NO modificar `main`)  
**Estado actual:** `D5_FIXED_ROMFREE_NOT_NATIVE`; `D5_RECAPTURE_REQUIRED`; `A0.6.3/A0.6.4=NOT_CERTIFIED`
**Objetivo:** identificar y resolver la causa real de un valor de banco nativo inválido **sin repetir la captura mientras pueda analizarse offline**.

**Diagnóstico completado:** falta el separador entre E y el PC que añade MAME.
Ver [causa confirmada, fix mínimo, tests y siguiente checkpoint](a063-m5-d5-delimiter-diagnosis.md).
La evidencia y las hipótesis siguientes conservan el contexto del handoff original;
la captura antigua sigue rechazada y no se ha recompilado ni recapturado.

## 1. Evidencia confirmada

| Etapa | Estado | Evidencia |
|---|---|---|
| Colima / Docker local ARM64 / toolchain | PASS | `A063_M5_D0_D2=PASS_ARM64_PATCHED_SOURCE_NOT_COMPILED` |
| MAME 0.289 Linux ARM64 compilado | PASS | `A063_M5_D3=BUILD_PASS` |
| ELF AArch64, versión 0.289, driver `gngb`, símbolo `gng_a063_bank` | PASS | `A063_M5_D4=PASS_ELF_ARM64_GNGB_ORACLE` |
| SHA-256 del ejecutable | registrado | `80c447cd81fa91be8bf3159e22dedab157798a4f1a189e6680849179b0ac282d` |
| ROM privada y cinco bancos preparados | PASS | `D5_ROM=PASS`; `D5_BANKS=PASS` |
| Xvfb | PASS | `D5_XVFB=PASS` |
| MAME con ROM privada, mini-oráculo | terminó | `GNG_R2_PROBE_MAME_EXIT=0` |
| Preestados de CPU | 41.426 | `GNG_R2_PRETRACE=PRE_INSTRUCTION_FORMAT_PARSED` |
| Enlace preflight/postflight | PASS de integridad, **NO procedencia bancaria** | `A063_R1_POSTFLIGHT=A063_POSTFLIGHT_CHAIN_INTACT_NOT_BANK_PROVENANCE` |
| Validación del oráculo | BLOCKED | `A063_ORACLE=BLOCKED invalid_private_instruction_oracle_evidence`; `D5_EXIT=2` |
| **Diagnóstico exacto posterior, obtenido por el operador** | **CONFIRMADO** | **`D5_DIAGNOSIS=A063_ORACLE_BANK_OUT_OF_RANGE`** |

La captura se conserva en el volumen `gng-a063-private-capture-arm64-v1`, bajo `/workspace/out/r3/a063-oracle-smoke/`. El MAME compilado se conserva en `gng-a063-mame0289-arm64-v1`, binario `/mame/mame0289/gnga063`. No mover, truncar ni sobrescribir los volúmenes.

## 2. Qué significa exactamente el nuevo error

La función `parse_driver_entries()` en `scripts/a063_bank_oracle_gate.py` busca en cada línea el marcador `GNG_A063_ENTRY E=...`, interpreta su argumento como **hexadecimal** y exige que el índice de banco pertenezca al conjunto `{0,1,2,3,4}`. Si `int(captura,16) > 4` lanza `ValueError("A063_ORACLE_BANK_OUT_OF_RANGE")`.

Por orden de ejecución de `evaluate()`, llegar a esta excepción significa que **las verificaciones anteriores de postflight, imágenes bancarias, offsets y parseo del fingerprint ROM alcanzaron el siguiente paso sin lanzar excepción**. No significa que los fingerprints y el oráculo nativo coincidieran: `compare()` no llegó a ejecutarse. Tampoco permite afirmar que el driver de MAME tenga un índice interno superior a cuatro: lo que se observó fuera de rango es la **representación registrada/interpretada del símbolo**.

**Hipótesis prioritarias, sin dar ninguna por probada:**

1. **Formato o evaluación en el depurador MAME:** `tracelog` y su `%02X` pueden estar imprimiendo un valor distinto del esperado por representación, anchura, argumento o expresión.
2. **Valor nativo del símbolo:** `gng_a063_bank` debe devolver `m_mainbank->entry()`, pero hay que comprobar su ciclo de vida, el instante de evaluación y su semántica.
3. **Desajuste del parser:** tratamiento de hexadecimal, prefijos, límites, marcadores repetidos o tokens contiguos. No modificar el parser para «aceptar» entradas inválidas sin prueba.
4. **Problema de registro de la acción:** correlación o aridad de los 12 argumentos `tracelog` (`9 CPU + 2 b@ + 1 E`); los invariantes previos no prueban por sí solos el valor correcto de E.

No asumir que es `A063_NATIVE_SIGNATURE_EXCEEDS_BYTE`: **el diagnóstico confirmado en esta captura es `A063_ORACLE_BANK_OUT_OF_RANGE`**.

## 3. Ruta crítica para el agente local

### T0 — Congelar evidencia y entorno (sin MAME, sin mutaciones)

- Confirmar rama y `git status`; respetar cambios locales. No `git switch`, `stash`, `reset`, `clean`, `pull` indiscriminado.
- Confirmar que los volúmenes Docker y el binario SHA indicado existen.
- Montar captura **solo lectura** (`:ro`), MAME **solo lectura**, repositorio **solo lectura**, `--network none`.
- No ejecutar `a063-native-oracle-miniprobe.sh`, `r2-mame-probe.sh` ni `make` durante esta fase.

### T1 — Aislamiento exacto del fallo offline

1. Leer `scripts/a063_bank_oracle_gate.py`, `a063_trace_contract.py`, `r3_bank_provenance.py`, `a063_capture_integrity.py`, `r2-mame-probe.sh` y el parche `patches/mame0289-a063-bank-oracle.patch`.
2. Sobre la traza privada guardada, **no imprimir líneas, registros, bytes ROM, PC, E ni secuencias de bancos**.
3. Producir únicamente un **reporte agregado allowlist**:
   - número total de marcadores CPU y de marcadores E;
   - cantidad de tokens E: válidos 0..4, inválidos 5..255, inválidos >255, malformados/ausentes/duplicados;
   - histograma de **anchuras** de tokens E (no valores);
   - ordinal del primer token inválido (sin PC, dirección, CPU ni valor);
   - si se completó el vínculo 1:1 de CPU/fingerprint sin degradación de gates;
   - `first_exception_code=A063_ORACLE_BANK_OUT_OF_RANGE`.
4. Trazar localmente el primer fallo desde la captura hasta el argumento de `tracelog` y al símbolo; cualquier inspección de valor bruto es **solo local**, jamás pegada en chat, issue, commit o reporte público.

**Criterio T1:** razón específica de E fuera de rango, sustentada en implementación y evidencia. Si es aún incierto, registrar `ROOT_CAUSE_UNPROVEN`, no inventar.

### T2 — Reparación mínima solo cuando T1 esté justificado

- Si el problema es de formato: preparar fix puntual en acción/depurador con tests ROM-free que reproduzcan la desviación **sin usar datos ROM**.
- Si es de símbolo MAME: revisar ámbito y estabilidad de `m_mainbank->entry()` y compatibilidad de la API 0.289. Recompilar **solo si hay modificación necesaria de código C++**.
- Si es de parser: validar con fixtures sintéticos, sin truncar, sin máscara `&0xff`, sin tomar «último nibble», sin inventar valores.
- **No reinterpretar una captura inválida como PASS**. Una corrección del productor normalmente exigirá **nueva captura privada aislada** y un preflight nuevo, sin sobrescribir la anterior.
- Mantener separado `ROMFREE_PASS` de `NATIVE_MATCHED`; los tests sintéticos no son evidencia nativa.

**Criterio T2:** cambio mínimo trazable, tests positivos/negativos, explicación causal explícita. Las fuentes enumeradas en `a063_trace_contract.SOURCE_FILES` están vinculadas criptográficamente al preflight existente: cambios en ellas pueden invalidar reutilización del checkpoint. Ejecutar diagnóstico **antes** de editarlas.

### T3 — Revalidación y cierre por gates

- Solo después de T2, ejecutar la menor prueba necesaria; primero diagnóstico offline, después mini-oráculo **nuevo** si se cambió el productor.
- Rechazar sobreescritura de `out/r3/a063-oracle-smoke/` y del preflight viejo; crear una ubicación de captura nueva versionada o copia íntegra, con hashes y sin perder los originales.
- Aceptar mini-oráculo únicamente con E en `0..4` para **todos** los preestados, comparación ROM auténtica vs banco vivo **1:1**, al menos 256 preestados, dos bancos distintos y al menos un control write/una transición sin reset según el contrato actual.
- La aceptación del **mini-oráculo** no certifica por sí sola la **captura completa A0.6.3**. A0.6.4 sigue pendiente del gate correspondiente sobre la **misma** evidencia válida.

## 4. Límites y prohibiciones

- **Coste adicional = 0 €.** Sin Codespaces, Actions, VPS, APIs pagas, servicios cloud ni nuevas máquinas. Solo Docker/Colima local.
- **No subir** ROM, ZIP, blobs, binarios MAME, `out/`, `cpu.trace`, `pre-instruction.jsonl`, `observations.tsv`, `start-debugger.txt`, manifiestos privados, hashes de ROM, dumps de registro/PC, secuencia banco/instrucción, secretos ni logs de MAME.
- Publicar únicamente Markdown/JSON **saneado y allowlisted** en rama feature, si hace falta, en un commit dedicado. No tocar `main`.
- No desactivar checks, no aceptar máscaras/recortes, no reconstruir un banco por frame, no declarar A0.6.3 PASS por compilación o por 41.426 prestates.
- No volver a hacer un build o recaptura hasta demostrar su necesidad.

## 5. Entregables de la siguiente sesión

1. **Informe de causa raíz**, con código de error, evidencia agregada y clasificación `CONFIRMED` / `HYPOTHESIS` / `UNPROVEN`.
2. **Plan de cambio mínimo** (archivos y tests afectados), sin cambiar evidencia protegida.
3. Si procede, implementación y pruebas ROM-free locales; reporte sanitized y commit en feature.
4. **Checkpoint** inequívoco: `D5_DIAGNOSED`, `D5_PATCHED_NOT_NATIVE` o `D5_NATIVE_MINIPROBE_PASS_NOT_FULL_A063`.

**Primer comando recomendado:** usar el prompt hermano `docs/agents/a063-m5-d5-local-agent-prompt.md` para ejecutar solo T0–T1 en local y hacer diagnóstico de lectura.
