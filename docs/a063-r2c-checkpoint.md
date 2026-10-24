# R2.C — Cierre de investigación y validación ROM-free

Fecha: 2026-10-24. Rama: `feature/a063-r1-forensics-contract`. `main` no modificado deliberadamente. No se ejecutan GitHub Actions.

**Decisión R2.C6: `BLOCKED_ENVIRONMENT_FULL_CHECKOUT_AND_NATIVE_BUILD_UNAVAILABLE`.**
**A0.6.3: BLOCKED. Certeza de desbloqueo: 85% subjetiva, no recalibrada con evidencia nativa.**

## Resultado comprobado vs pendiente

| Task | Verificado durante R2.C | Estado |
| --- | --- | --- |
| R2.C1 — Checkout íntegro | Inventario remoto de ~190 archivos versionados mediante GitHub; `git ls-remote` local falla por DNS (github.com) y no hay red saliente al checkout. | BLOCKED_ENVIRONMENT; no se reconstruyó árbol completo |
| R2.C2 — Regresión integral | Ejecución local ROM-free del subconjunto R1: 32/32 unittest PASS en copia parcial. No equivale a los módulos Node ni la suite Python completa del repositorio. | PARTIAL_PASS, full checkout pendiente |
| R2.C3 — Cinco bancos adversariales | Ejecución aislada de 16/16 escenarios PASS, usando rutinas del parser/per-prestate y comparador de bancos reconstituidas desde el código de rama con dependencias ajenas al caso sustituidas. Cinco bancos sintéticos, 375 prestates en escenario positivo, cuatro transiciones. | ISOLATED_PASS_NOT_NATIVE |
| R2.C4 — Fuentes MAME 0.289 | Dos hunks del parche comparados con el gng.cpp oficial del tag `mame0289`, ambas posiciones y contadores verificados, PASS_EXACT_MAME0289_CONTEXT. Se corrigieron offsets del diff. Se verificaron `device_t::debug`, `memory_bank::entry`, `symbol_table::add` en MAME. | STATIC_SOURCE_PASS; build no ejecutado |
| R2.C5 — Trazas, hashes y custodia | Corregida variable `oracle_smoke` inexistente en `verify_postflight`; incorporada vinculación de binario MAME diagnosticado y verificación posterior de SHA, manifiesto exacto de fuentes; rechazo de muestras nativas malformadas y totales imposibles. Nuevos tests versionados. | FIXED_IN_BRANCH, integración pendiente de regresión completa |
| R2.C6 — Checkpoint | Runner local existente `scripts/a063-r2b-romfree.sh`, replay integrado a `scripts/r3-local-regression.sh`, casos adicionales + este informe. | BLOCKED hasta ejecutar gates pendientes |

## Defectos encontrados y reparados

1. **Hunks fuera de línea en MAME 0.289:** el parche tenía cabeceras con líneas de origen incorrectas (`-35` y `-541`); ahora usa las líneas reales `-36` y `-543`. Se verificó correspondencia EXACTA de los dos contextos completos con el driver de upstream. Esto es evidencia de aplicabilidad textual, no de compilación C++.
2. **Error de ejecución posterior (NameError):** `verify_postflight` mencionaba `oracle_smoke` sin inicializarlo, impidiendo la verificación de ruta privada. Corregido.
3. **Verificación binaria incompleta:** al volver a verificar el postflight del oráculo no se comprobaba el binario vivo del MAME diagnóstico. Ahora el modo oracle exige `--mame-bin`, comprueba SHA frente a preflight y niega confirmación si cambió.
4. **Muestras de banco inconsistentes:** un total de escrituras imposible o muestras nativas ilegibles ya no pueden producir PASS del oráculo. Se añadieron 2 escenarios adversariales y tests ROM-free.

## Evidencia falsable reproducible

En un checkout COMPLETO, sin ROM:

    git switch feature/a063-r1-forensics-contract
    git pull --ff-only
    bash scripts/a063-r2b-romfree.sh

El runner hace bash -n, py_compile, replay y pruebas Python, y termina ejecutando la regresión ROM-free de Node + Python. El PASS debe provenir de la salida local real; este checkpoint no lo anticipa.

En fuente de MAME `mame0289` separada, antes de compilar:

    python3 scripts/a063_patch_mame_oracle.py --mame-source "$MAME_SRC"

Después: aplicar con `--apply` y compilar binario aparte. El test con ROM privada `scripts/a063-native-oracle-miniprobe.sh` exige coincidencia instrucción a instrucción de firmas ROM y `mainbank.entry`; incluso un PASS de mini-probe NO certifica la traza completa A0.6.3.

## Política de decisión

- `R2C_ROM_FREE_READY`: SOLO tras resultados íntegros reproducibles del runner y build comprobado del parche MAME, conservando el resultado como `NOT_NATIVE`.
- `BLOCKED_ENVIRONMENT_FULL_CHECKOUT_AND_NATIVE_BUILD_UNAVAILABLE`: estado ACTUAL, porque no existe artefacto verificable de regresión completa ni compilación real en este entorno.
- `BANK_IDENTITY_AT_EVERY_NATIVE_PRESTATE_VERIFIED`: objetivo futuro separado. Requiere MAME real + ROM privada + evidencia 1:1 completa sin divergencia.

## Fuentes auditadas

- [MAME tag mame0289 / driver](https://github.com/mamedev/mame/blob/mame0289/src/mame/capcom/gng.cpp)
- [MAME debugcpu](https://github.com/mamedev/mame/blob/mame0289/src/emu/debug/debugcpu.cpp)
- [MAME debug expressions](https://github.com/mamedev/mame/blob/mame0289/src/emu/debug/express.h)
- [MAME memory_bank](https://github.com/mamedev/mame/blob/mame0289/src/emu/emumem.h)
- [MAME device API](https://github.com/mamedev/mame/blob/mame0289/src/emu/device.h)

Privacidad: no se han añadido ROMs, bytes privados, capturas reales ni trazas CPU. No se ha realizado merge ni usado CI de GitHub.

## Seguimiento sin Mac — verificación adicional 2026-10-24

- **17/17 casos sintéticos PASS, ejecutados** en copia local parcial, con
  funciones reales del clasificador/replay y dependencias periféricas
  simuladas. Nuevo rechazo de cambios bancarios que superen el total de
  escrituras de control observadas cuando no haya reset.
- **32/32 unittest parciales PASS**, en sandbox aislado de R1/R2 con
  dependencias suplidas (8 contratos + 6 integridad + 5 smoke + 2 parche
  sintético + 11 comparador). No representan el test suite integral.
- **PASS_STATIC_UPSTREAM_PATCH**: los dos hunks del parche se aplicaron
  textualmente sobre el archivo **completo** `gng.cpp` del tag oficial
  `mame0289` mediante un verificador de aplicación de diff en memoria;
  líneas originales 36 y 543, contextos/cuentas correctos. El cuerpo de
  `bankswitch_w` se mantuvo idéntico. En fuentes MAME del mismo tag se
  verificó que el driver espera a sus hijos antes de `machine_start()`,
  y que la CPU crea su depurador durante el arranque con `-debug`.
- **Bloqueo medido:** `git ls-remote` no puede resolver github.com
  desde el contenedor local. El repositorio es privado y solo accesible
  desde el conector GitHub; no se ha obtenido un checkout local completo
  de los ~190 archivos, ni fuente/build íntegros de MAME.
- La nueva protección de transición es una cota de plausibilidad:
  `bank_transitions <= total_bank_control_writes` sin reset; no atribuye
  la escritura exacta a cada instrucción ni sustituye la evidencia nativa.

**Cierre:** `R2C_STATIC_AND_ISOLATED_PASS__FULL_REGRESSION_AND_MAME_BUILD_BLOCKED`.
No inventar `ROM_FREE_READY`, no ejecutar GitHub Actions. La siguiente
validación factible requiere un entorno de checkout privado ejecutable.

## Bloque posterior a investigación avanzada — verificación del mismo día

**Estado: `R2C_PARTIAL_ROMFREE_PASS_FULL_BUILD_BLOCKED`; confianza estimada 85% sin recalibración.**

**Ejecución real disponible en el contenedor de la sesión:** `python3
scripts/a063_oracle_replay.py`: 17/17 PASS en copia parcial con
dependencias sintéticas; `python3 -m unittest discover -s tests -p
'test_a063_*py' -q`: 32/32 PASS en espejo R1 parcial. Además, un
smoke C++20 de la expresión getter/registro observó las cinco entradas
simuladas, pero **no enlazó ni compiló MAME**. No se ejecutó en checkout
íntegro de la rama.

**Defecto reproducido y corregido:** el test
`tests/test_a063_oracle.py::test_insufficient_coverage_or_transition_is_inconclusive`
esperaba `INCONCLUSIVE_NO_BANK_TRANSITION` para cero escrituras,
mientras que el oráculo devuelve
`INCONCLUSIVE_NO_UNINTERRUPTED_BANK_TRANSITION`. Se reprodujo el
desacuerdo con el comparador ejecutable, y se actualizó el assert sin
debilitar el gate. La suite del checkout real debe demostrarlo.

**Nuevo test de integración publicado, aún NO ejecutado en checkout real:**
`tests/test_a063_oracle_pipeline.py` usa el extractor R2 real y los
dos parsers del oráculo sobre una traza sintética; cubre éxito y cuatro
adversarios (división de firma, marcador CPU duplicado, registros
incompatibles y marcador bancario huérfano). Ahora forma parte de
`scripts/r3-local-regression.sh`.

**Gate Linux versionado, build NO ejecutado:**
`scripts/a063-r2c-linux-gate.sh`. En host Linux autorizado y con
dos clones privados/públicos completos:

```bash
bash scripts/a063-r2c-linux-gate.sh --mame-source /path/to/clean/mame0289 --jobs 2
```

Ejecuta la regresión ROM-free, verifica 17/17, valida/aplica el parche
al MAME separado, hace el build `gnga063`, verifica la versión y fecha
de creación del ejecutable y produce SHA-256, logs y manifiesto
fuera del repositorio. **Solo publica `R2C_ROM_FREE_READY` si todo
pasa**. Si falla cualquiera de los pasos, deja
`status=BLOCKED_UNTIL_ALL_GATES_PASS`. Las precondiciones incluyen
árboles limpios, tag exacto y existencia de binario recién generado.

**Limitaciones actuales:** el contenedor no resuelve `github.com`
para clonar el repositorio privado y no contiene MAME 0.289 completo.
No se ha corrido el nuevo runner extremo a extremo ni se ha
ejecutado la compilación real. MAME y la ROM privados NO forman parte
del test sintético; R2.A5 permanece pendiente. No se activaron Actions
ni se modificó `main`.
