# A0.6.3 — MAIN_RAM write tap: T0 ROM-free checkpoint

**Fecha:** 2026-10-26. **Rama:** `feature/a063-r1-forensics-contract`.
**HEAD de entrada verificado:** `6ad502982947aca79af36aaa7db9bb4f3e5d6fce`.
**Estado:** `T0_IMPLEMENTED_DIRECTED_TESTS_PASS_INTEGRAL_BLOCKED_ENV`.
**T1/T2/T3:** NO INICIADAS. Sin ROM, MAME, Docker ni evidencia privada en este entorno.

## Decisión de enlace: MAME mame0289

- `src/frontend/mame/luaengine_mem.cpp` expone `space:install_write_tap(start,end,name,callback)` con dirección, dato y máscara, pero no un ordinal de instrucción compartido con pre-trace.
- `src/emu/debug/debugcpu.cpp` expone `totalcycles`, actualizado en `instruction_hook` antes de cada instrucción; no demuestra causalidad para una escritura.
- `src/frontend/mame/luaengine_debug.cpp` implementa `debug:wpset(space,"w",addr,len,cond,act)`. `src/emu/debug/points.cpp` confirma que el watchpoint es otro memory tap, usa `wpaddr/wpdata/wpsize`, detiene la CPU por defecto y ejecuta la acción. `src/emu/debug/debugcmd.cpp` permite `tracelog` en la traza del CPU visible.
- `patches/mame0289-a063-bank-oracle.patch` aporta el símbolo `gng_a063_bank`.
- **Candidato evaluado, no validado:** watchpoint con acción `tracelog` dentro del flujo de trace, con reanudación controlada. Antes de usarlo debe demostrarse el orden y ausencia de perturbación en MAME nativo; no se asume que `wpdata`, PC del tap o `totalcycles` vinculen de forma causal cada escritura.
- **Decisión T0:** coincidencia ordenada y única por epoch, como diagnóstico débil (`ORDERED_EXACT_MATCH_ONLY_NOT_INSTRUCTION_CAUSAL`), sin certificar ninguna escritura como ligada a su instrucción.

Fuente pública, **tag exacto `mame0289`**:
- https://github.com/mamedev/mame/blob/mame0289/src/frontend/mame/luaengine_mem.cpp
- https://github.com/mamedev/mame/blob/mame0289/src/frontend/mame/luaengine_debug.cpp
- https://github.com/mamedev/mame/blob/mame0289/src/emu/debug/points.cpp
- https://github.com/mamedev/mame/blob/mame0289/src/emu/debug/debugcpu.cpp
- https://github.com/mamedev/mame/blob/mame0289/src/emu/debug/debugcmd.cpp

## Archivos T0

- `scripts/r2-mame-probe.lua`: opt-in `GNG_A063_MAIN_RAM_TAP=1`, tap en `0x0000–0x1dff`, solo full-oracle, soft reset y bus 8-bit; registra epoch, ordinal global, dirección, dato, máscara en TSV privado. Límite 65.536 eventos; cualquier truncamiento bloquea. Sin PC emisor atribuido.
- `scripts/a063-main-ram-native-capture.sh`: launcher nuevo. `--check` no captura. `--run` requiere `GNG_A063_RAM_CAPTURE_APPROVED=EXPLICIT_OPERATOR_T1`, Docker/Colima local, imagen fijada, red inhabilitada, rootfs/ROM/repo/MAME RO y volumen nuevo protegido `gng-a063-private-capture-arm64-ram-tap-v1`. **No ejecutado.**
- `scripts/r3_native_main_ram_write_gate.mjs`: primero autentica los 11 roles SHA256 del mismo run y postflight; compila y ejecuta `STA_INDEXED/STB_INDEXED` con preestados auténticos y bancos de la misma captura; compara eventos dentro de cada epoch sin asignar escrituras de pila u otras instrucciones. Reporta solo agregados; salida CLI siempre exit 2 mientras falte vínculo causal nativo.
- `tests/test_r3_native_main_ram_write_gate.mjs`: nueve tests sintéticos con faltantes, extras, dato/máscara, orden, epochs, duplicados y fuente vinculada.
- `tests/test_a063_main_ram_contract.py`: opt-in, preservación B4/VRAM/sprite, launcher, fuentes y registro. `scripts/a063_trace_contract.py::SOURCE_FILES` incluye las nuevas fuentes y `scripts/a063-r2b-romfree.sh` integra los tests.

## Resultados verificables

| Verificación | Resultado |
|---|---|
| Node 22: 9/9 tests sintéticos dirigidos | PASS |
| Sintaxis del módulo JS (`node --check`) | PASS |
| CLI sin binario explícito | Exit 2, marcador BLOCKED esperado |
| Inspección estática de 19 contratos sobre archivos reales de GitHub | 19/19 PASS |
| `TMPDIR=/tmp bash scripts/a063-r2b-romfree.sh`, sintaxis launcher y Python integral | **BLOCKED_ENV_MISSING_CHECKOUT** |
| Tap Lua en MAME real / watchpoint / evidencia nativa | NO EJECUTADOS |

La terminal cloud dispone de Node 22, Python 3.13 y Git, pero carece del checkout completo; `git ls-remote` tampoco puede resolver GitHub (DNS). Intento de suite integral en el entorno aislado: `exit 127`, script ausente. **No se declara PASS integral**, ni se omiten deliberadamente tests.

## Límite y próximo checkpoint

El tap observa también escrituras ajenas a las stores bancarias (pila, otras instrucciones). La coincidencia, aunque única, no aporta identidad causal. El gate retorna INCONCLUSIVE con extras/ambigüedad y no puede emitir PASS nativo.

**T1 (pendiente de autorización):** ejecutar la suite integral desde checkout Linux con `TMPDIR=/tmp`; revisar cambios, presupuesto, 4 frames y volumen nuevo; valorar un experimento watchpoint+tracelog antes de afirmar enlace; solicitar autorización explícita para la captura en el Mac. No tocar D5/D6 previos. No avanzar a T2/T3.
