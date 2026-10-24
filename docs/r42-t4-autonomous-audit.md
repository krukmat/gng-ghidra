# T4 — Auditoría autónoma de T1–T3 y puente F → G → H (24/10/2026)

## Alcance

T4 se limita al controlador de regresión ROM-free, endurecimiento de contratos y auditoría de integración. **No constituye certificación de MAME, ROM, banco por instrucción, IRQ/SYNC ni framebuffer real.** No se han usado ni añadido GitHub Actions.

## Task status y cambios publicados

| Task | Trabajo | Evidencia / estado |
|---|---|---|
| T4.1 | Auditar cierre T1–T3 | **FIX**: el CLI de cierre ahora exige informe H fresco por ejecución con ruta aleatoria privada bajo `out/r3/`; no puede aceptar un manifiesto de escala de una ejecución anterior. Rechaza falsos claims nativos/Actions y SHA-256 no válido. |
| T4.2 | Pruebas Python independientes | **Preparadas, no ejecutadas desde este checkout**: `tests/test_r42_validation_closure.py` contiene **12 tests** (incluidos informe obsoleto, salida de proceso incorrecta, timeouts, flags nativos falsos, metadatos SHA mal tipados, falta de checkout). Sigue bloqueada la ejecución real del fichero por la ausencia de un checkout completo en esta terminal. |
| T4.3 | Auditar F→G→H | **FIX**: `src/r42g_incremental_timeline.mjs` rechaza claves JSONL duplicadas, también aliases Unicode como `"\\u0073eq"`, antes de `JSON.parse`. El validador F Python ya rechazaba duplicados; G ahora no debilita el contrato. |
| T4.4 | Corregir defectos reproducibles | Añadida prueba negativa `tests/test_r42g_incremental_timeline.mjs`. Prueba aislada V8: **5/5** contratos de JSONL (caso válido, duplicado directo, alias Unicode, ":" dentro de valor, clave escapada duplicada). **9/9** chequeos de integración publicados. No equivalen a un `node --test` real. |
| T4.5 | Checkpoint y roadmap | Este informe, `docs/r3-critical-path.md`, `docs/plan-ejecucion.md`; bloque T1–T3 permanece sin PASS hasta ejecutar Node/Python completos. |

## Comandos reproducibles sin MAME

Desde un checkout real de `krukmat/gng-ghidra`:

```bash
git pull --ff-only
python3 -m unittest discover -s tests -p 'test_r42_validation_closure.py' -v
node --test tests/test_r42g_incremental_timeline.mjs
python3 scripts/r42_validation_closure.py
```

El último comando ejecuta T1 (9 tests H + escala 5k, 40.001, 100k), T2 (regresión integral R3/R4.2) y genera `out/r3/r42-validation-closure.json`. Requiere **Node y Python reales y todos los archivos del repositorio**, pero **no necesita MAME ni ROM**. La evidencia H del cierre se crea en un nombre único, es validada y eliminada; el reporte ordinario H de otra ejecución no se consulta ni sobrescribe.

## Gates aún pendientes

1. **T1–T3:** Node/SHA-256 real, regresión integral Node/Python y corrección de posibles fallos de dicha ejecución. Estado: `BLOCKED_MISSING_CHECKOUT` en la terminal disponible; no declarar `PASS_ROM_FREE_ONLY`.
2. **V1:** MAME Lua taps reales; confirmar integridad de F y procedencia de las escrituras.
3. **V2:** Estado inicial pre-taps o prueba de cobertura completa.
4. **V3:** A0.6.3/A0.6.4 identidad bancaria por instrucción.
5. **V4:** IRQ/SYNC, VBlank, continuidad de CPU recompilada y primer frame auténtico.

**Criterio de salida:** mantener congelada la expansión de escenas sintéticas R4.2; reabrir solo ante defectos observables o evidencia nativa. El estado de bloque T4 no cambia la certificación nativa.
