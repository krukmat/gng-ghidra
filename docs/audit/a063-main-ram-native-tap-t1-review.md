# A0.6.3 MAIN_RAM — T1: revisión de seguridad y preflight (ROM-free)

Fecha: 2026-10-26. Rama `feature/a063-r1-forensics-contract`.
**Alcance:** T1.1–T1.4. Sin T2, MAME, ROM, Docker, evidencia privada, PR, merge ni `main`.

## T1.1 — Suite integral desbloqueada en Mac del operador

El operador remitió los tres marcadores finales de una ejecución local:

- `GNG_LOCAL_REGRESSION=PASS_ROM_FREE_A0_2_TO_A0_6_3`
- `GNG_LOCAL_REGRESSION=PASS_ROM_FREE_R3_R42H`
- `A063_R2B=ROMFREE_CHECKS_PASS_NOT_NATIVE_NOT_A063_CERTIFIED`

**Resultado:** `T1.1=PASS_OPERATOR_REPORTED_ROMFREE`. Son logs del operador; el cloud no ha accedido a su checkout ni a evidencia privada. No extraer de ellos recuentos de tests o certificación nativa que no figuran en la salida.

## T1.2 — Revisión de implementación y preservación

Inspeccionados en GitHub los archivos reales de T0: `scripts/r2-mame-probe.lua`, `scripts/a063-main-ram-native-capture.sh`, `scripts/a063-full-native-inner.sh`, `scripts/r3_native_main_ram_write_gate.mjs` y los tests. Chequeos de diseño:

1. RAM principal `0x0000..0x1dff` únicamente opt-in `GNG_A063_MAIN_RAM_TAP=1`; exige modo full oracle, bus de 8 bits y soft reset, captura en `observations.tsv` del volumen privado. El límite es 65.536 eventos; truncamiento implica bloqueo. No atribuye PC del tap.
2. Sprite `0x1e00..0x1fff`, VRAM `0x2000..0x2fff` y B4 MMIO conservan rangos y flags originales. El nuevo launcher reutiliza el `inner` D6, que ya configura sprite, vídeo, política MMIO y reset.
3. El launcher limita nombre a `gng-a063-private-capture-arm64-ram-tap-vN`, falla con volumen preexistente y requiere para `--run` `GNG_A063_RAM_CAPTURE_APPROVED=EXPLICIT_OPERATOR_T1`. Repositorio, ROM y MAME solo lectura, `out` nuevo, Docker ARM64 local, sin red y SHA de MAME protegido en el inner. No monta volúmenes D5/D6 existentes.
4. El gate requiere los 11 roles/hashes del mismo `full-oracle` y verifica `postflight` antes de predicciones AOT con el banco autenticado. Los eventos MAIN_RAM se comparan sin asignar escrituras de pila ni otras instrucciones a las stores bancarias. El CLI devuelve exit 2 incluso si el diagnóstico es `ORDERED_EXACT_MATCH_ONLY_NOT_INSTRUCTION_CAUSAL`.
5. **Limitación deliberada:** no se valida causalidad nativa en T1. Una subsecuencia única ordenada no equivale a enlace de instrucción. El estado de las fuentes es apto para **captura diagnóstica** autorizada, no para declarar `MAIN_RAM_NATIVE_CAUSAL_PASS`.

Resultado: `T1.2=SOURCE_AUDIT_PASS_WITH_CAUSAL_LIMITATION`; no se requiere cambio adicional del binario MAME.

## T1.3 — Opciones de correlación: fuentes MAME 0.289

Verificadas las APIs públicas de `tag mame0289` y el parche local `patches/mame0289-a063-bank-oracle.patch`:

- `src/frontend/mame/luaengine_mem.cpp`: `install_write_tap` entrega dirección, dato y máscara en callback, **sin ID de instrucción** compartido.
- `src/emu/debug/debugcpu.cpp`: el símbolo `totalcycles` se actualiza en `instruction_hook` antes de cada instrucción. No es por sí solo un ID causal de write tap, y su lectura asíncrona no certifica bus.
- `src/frontend/mame/luaengine_debug.cpp`: `debug:wpset(space,"w",addr,len,cond,act)` instala watchpoints; `src/emu/debug/points.cpp`: se apoyan en taps internos, crean `wpaddr/wpdata/wpsize` y ejecutan una acción al disparar **después de poner al depurador en stopped**. `src/emu/debug/debugcmd.cpp`: `tracelog` escribe en la traza del CPU visible.
- `patches/mame0289-a063-bank-oracle.patch`: expone `gng_a063_bank` para lectura en depurador, no implementa ordinal de escritura.

**Evaluación:** el candidato `watchpoint + tracelog` podría escribir eventos de memoria al mismo stream que el pre-trace, pero su acción puede parar/reanudar CPU, modificar el orden o introducir eventos inesperados. Debe validarse en una captura **experimental explícita** con requisitos ROM-free previos. No añadir un `wpset` no probado a la única captura completa T2. Es preferible primero utilizar el tap actual para evaluar cobertura y extras de escrituras; si se exige enlace por instrucción, preparar un contrato/experimento separado y autorizarlo como tal.

**Decisión T1.3:** `ORDERED_ONLY_DIAGNOSTIC_NOT_CAUSAL`. No existe en los mecanismos revisados una prueba de ID compartido sin validación nativa.

Fuentes: https://github.com/mamedev/mame/blob/mame0289/src/frontend/mame/luaengine_mem.cpp ; https://github.com/mamedev/mame/blob/mame0289/src/frontend/mame/luaengine_debug.cpp ; https://github.com/mamedev/mame/blob/mame0289/src/emu/debug/points.cpp ; https://github.com/mamedev/mame/blob/mame0289/src/emu/debug/debugcpu.cpp ; https://github.com/mamedev/mame/blob/mame0289/src/emu/debug/debugcmd.cpp

## T1.4 — Preparación Mac; preflight confirmado por el operador

- Comando seguro **sin ejecución nativa ni creación de volumen**:
  `bash scripts/a063-main-ram-native-capture.sh --check --frames 4 --volume gng-a063-private-capture-arm64-ram-tap-v1`
- Se ejecuta desde el checkout feature **limpio y sincronizado**, con Docker Colima local y ROM privada en el Mac; el cloud no puede ejecutar este preflight. El script inspecciona Docker/volúmenes existentes y retorna `D6_CAPTURE_LAUNCHER=CHECK_PASS_CONFIGURATION_ONLY_NOT_CAPTURED` cuando cumple condiciones.
- Coste cloud adicional: cero; MAME ARM64 ya construido, sin rebuild. Presupuesto de captura: cuatro frames, timeout del inner de 180 s y un volumen nuevo. Hasta 65.536 eventos RAM quedan registrados; sobrepasar ese límite retorna diagnóstico truncado, no PASS. El consumo real de CPU/RAM/disco no es verificable desde cloud.
- El evento `A063_FULL_NATIVE_BANK_PROVENANCE_PASS` de T2/T3 requiere nuevo postflight/11 roles, más B4/VRAM/sprite; el nuevo gate MAIN_RAM solo puede aportar `ORDERED_EXACT_MATCH_ONLY_NOT_INSTRUCTION_CAUSAL` o INCONCLUSIVE/BLOCKED, no certificación causal.
- Volumen nuevo propuesto: `gng-a063-private-capture-arm64-ram-tap-v1`. D5, D6 v1 y D6 v2 preservados, no montados por este launcher.

**Estado T1.4:** `PASS_OPERATOR_REPORTED_CHECK_ONLY`. El operador comunicó `D6_CAPTURE_LAUNCHER=CHECK_PASS_CONFIGURATION_ONLY_NOT_CAPTURED` tras `git pull --ff-only`; no es una captura y el cloud no inspeccionó Docker/Colima local.

## T1.5 — Punto de parada

**NO SE AUTORIZA T2** con el PASS de la suite ni con el `--check` reportado. El preflight está confirmado por la salida del operador; hace falta autorización explícita **posterior y separada** para ejecutar `--run`. Prohibido ejecutar `--run`, crear volúmenes o afirmar causalidad. Si se pretende certificar el objetivo original 1:1 instrucción↔write, decidir antes si se introduce un experimento `watchpoint+tracelog` con prueba de no perturbación; el tap actual es solo una sonda diagnóstica.

## T1.6 — Endurecimiento de integridad antes de T2 (ROM-free)

El parser MAIN_RAM ahora exige opt-in previo, secuencia ordenada de reset, cierre
`WRITE_COUNT → WRITE_TRUNCATED → PROBE_END(frame-limit)` y ausencia de eventos
posteriores. Rechaza parada prematura, marcador de reset malformado y escrituras
después del resumen. Se añaden tres tests adversariales al gate sin cambiar Lua,
launcher, ROM, MAME, B4, VRAM ni sprite. El gate continúa saliendo con código
2 en caso de coincidencia ordenada: la causalidad por instrucción no está probada.

Validación ejecutada en el entorno de edición: parser puro y casos adversariales
en V8 aislado, sin dependencias Node. Suite `a063-r2b-romfree.sh` **pendiente
de volver a ejecutarse en el checkout completo** tras este cambio. El PASS
anterior del operador corresponde al commit anterior.
