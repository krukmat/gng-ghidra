# R2.B — Certificación previa a la validación nativa

Fecha: 2026-10-24. Rama: feature/a063-r1-forensics-contract. main intacta, sin GitHub Actions.
Gate actual: R2B_ROMFREE_PARTIALLY_EXECUTED_NATIVE_BLOCKED.

## Resultado por task

| Task | Entregable | Resultado verificable | Pendiente |
| --- | --- | --- | --- |
| R2.B1 | Regresión ROM-free y runner de checkout íntegro | 32/32 pruebas locales PASS en copia parcial de módulos R1/R2, Python 3.13; scripts/a063-r2b-romfree.sh preparado | Ejecutar suite integral completa de tests Node/Python en checkout íntegro |
| R2.B2 | Parche diagnóstico para MAME 0.289 | git apply --check y git apply PASS sobre fragmentos exactos de las zonas originales del driver, extraídos del tag mame0289; verificados device_t::debug(), memory_bank::entry(), symbol_table::add() en fuentes del tag | Compilar binario diagnóstico y ejecutar symbol lookup con MAME real; NO hay full-source build PASS |
| R2.B3 | Harness cinco bancos | scripts/a063_oracle_replay.py y tests/test_a063_oracle_replay.py con 14 casos deterministas: 5 bancos, 4 transiciones, reset, sin escrituras, un banco, traza corta, byte ancho, banco discordante, líneas duplicadas/orfandad, PC/registros desplazados y captura parcial | Ejecutar el harness y sus tests dentro del checkout completo; no se afirma PASS de los 14 casos |
| R2.B4 | Checkpoint y camino crítico | Este documento, runner ROM-free y controles fail-closed, sin material ROM ni trazas subidas a Git | La certificación A0.6.3 sigue nativa y privada |

## Ejecutable único para pruebas sin ROM ni MAME

Desde checkout limpio de la rama:

    git switch feature/a063-r1-forensics-contract
    git pull --ff-only
    bash scripts/a063-r2b-romfree.sh

Este runner ejecuta: bash -n de wrappers relevantes, py_compile, replay y unittest ROM-free, test de aplicación de parche y regresión completa `r3-local-regression.sh`. Solo declara PASS_ROM_FREE si todo finaliza con código 0; NO declara procedencia bancaria nativa.

## Comprobación futura con ROM privada (NO ejecutar hasta pasar ROM-free y build)

1. Utilizar checkout separado de MAME mame0289. Ejecutar `python3 scripts/a063_patch_mame_oracle.py --mame-source <MAME_SRC>`; luego aplicar con `--apply` exclusivamente en el checkout MAME limpio.
2. Compilar con la toolchain oficial MAME para macOS, por ejemplo `make -j6 SOURCES=src/mame/capcom/gng.cpp`; confirmar ruta de ejecutable, versión 0.289 y presencia de símbolo `gng_a063_bank`.
3. Exportar GNG_R3_MAME_BIN como ruta EXPLÍCITA al binario diagnóstico; ejecutar `bash scripts/a063-native-oracle-miniprobe.sh`. No usar el MAME del sistema como sustituto.
4. Aceptar para considerar captura completa SOLO `A063_ORACLE_MINIPROBE_NATIVE_MATCHED_NOT_FULL_A063`, con >=256 prestates, >=2 bancos y escritura real, sin reset, y sin un solo desacuerdo entre firmas ROM autenticadas y entrada bancaria del driver.
5. Si falta transición o hay reset, estado INCONCLUSIVE; si hay firma >255, desalineación, diferencia de banco o captura incompleta, BLOCKED. Ninguno se transforma en PASS por truncamiento o por muestras de frame.

## Evidencia y riesgos restantes

El diseño de fuente se fundamenta en MAME tag mame0289:
- https://github.com/mamedev/mame/blob/mame0289/src/emu/debug/debugcpu.cpp
- https://github.com/mamedev/mame/blob/mame0289/src/emu/device.h
- https://github.com/mamedev/mame/blob/mame0289/src/emu/emumem.h
- https://github.com/mamedev/mame/blob/mame0289/src/emu/debug/express.h
- https://github.com/mamedev/mame/blob/mame0289/src/mame/capcom/gng.cpp

Los 32/32 tests locales pertenecen a un subconjunto disponible en el sandbox y NO equivalen a 32/32 tests del checkout integral de GitHub. El harness de 14 casos está versionado pero su ejecución integrada está pendiente.

**Estado:** a063-r2b ROM-free preparado parcialmente verificado; A0.6.3 permanece BLOCKED. Confianza de desbloqueo: estimación previa 85%, NO revisada hasta ejecución nativa.
