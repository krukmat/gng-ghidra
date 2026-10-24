# Ruta crítica de desbloqueo A0.6.3 → A0.6.4 → R4

**Rama aislada:** `feature/a063-r1-forensics-contract`.
**Fecha de definición:** 24-10-2026.
**Semántica:** `R1_READY` no es prueba nativa; `A0.6.3 PASS` exige identidad bancaria 1:1 autenticada.

## 0. Evidencia de partida

- 17.135 preestados nativos MC6809 alineados a 17.135 líneas con `GNG_R2_PRE` y `GNG_A06_BANKSIG`. Diferencias detectadas PC / 9 registros / línea original: **0**.
- En las **17.135** parejas, al menos un valor de firma > 0xFF; parser bloqueó correctamente con `A063_NATIVE_SIGNATURE_EXCEEDS_BYTE`. Ningún banco fue certificado por instrucción.
- Cinco imágenes ROM de 8 KiB autenticables; banco de programa 0x4000–0x5FFF, selector 0x3e00.
- MAME 0.289, `src/emu/debug/express.cpp`: `read_memory(size=1)` lee un byte o devuelve la máscara de un byte en caso de error; `debugcmd.cpp`: `tracelog` usa `mini_printf`, con `%02X` de ancho mínimo. **Inferencia:** el valor >0xFF no se explica solamente por una lectura de un byte; falta identificar por qué la salida difiere.
- Las pruebas sintéticas y verificaciones de la rama no prueban procedencia ROM.

Referencias primarias:
- [MAME 0.289 express.cpp](https://github.com/mamedev/mame/blob/mame0289/src/emu/debug/express.cpp).
- [MAME 0.289 debugcmd.cpp](https://github.com/mamedev/mame/blob/mame0289/src/emu/debug/debugcmd.cpp).
- [Runbook original](a063-unblock.md); [R1 checkpoint](a063-r1-checkpoint.md).

## Diagrama de dependencias

`C1 (R1, ROM-free)` → `C2 (forense privado sin MAME)` → decisión:
- Si se recupera una codificación documentada e independiente, comparar con firma auténtica sin truncamiento inventado; **nunca** pasar directamente a A0.6.3 PASS.
- Si no hay prueba suficiente, `C3 (mini-probe privado A/B)` → si PASS, `C4 (recaptura completa una vez)`; si BLOCKED, reparar instrumentación y repetir **solo** mini-probe.
- `C4` → `C5 (certificación 1:1)` → gate nativo A0.6.4 → R4.

## C1 — R1: contrato y pruebas ROM-free (único bloque inmediato sin acceso privado)

**C1.T1 — Contrato del debugger.** Centralizar/validar `tracelog`: 9 registros CPU, 2 lecturas `b@`, misma línea y CPU `:maincpu`, offsets autenticados distintos y dentro de ventana. Prohibir `&0xff` en la ruta certificable.

**C1.T2 — Proveniencia del entorno.** Manifiesto privado pre-run con versión/hash del binario MAME, acción exacta y hashes de scripts; nunca confundir preflight con evidencia post-run. Una captura distinta no debe reutilizar un manifiesto de la anterior.

**C1.T3 — Forense reproducible.** Diagnóstico agregado por primer/segundo valor fuera de byte, patrones de bits altos, parejas reales frente a huellas de cinco bancos, alineación CPU, y diagnóstico exclusivamente hipotético tras máscara.

**C1.T4 — Negativos.** Cadenas expresivas mal formadas, argumentos permutados, firmas duplicadas, números inválidos, firmas compatibles solo tras máscara, manifest viejo, intento de compartir datos privados, captura parcial e incoherencia de contadores.

**C1.T5 — Regresión integral y hardening mini-probe.** Ejecutar `bash scripts/r3-local-regression.sh` en checkout limpio mediante un entorno ROM-free (no GitHub Actions); comprobar `bash -n` de wrappers, sintaxis Python, y pruebas de comportamiento. Detectar/eliminar dependencia accidental del mini-probe en `out/r2/mame-probe` preexistente; preservar todo artefacto previo incluso si la captura falla antes de `cpu.trace`. Versionar la carpeta o rechazar colisión; no borrar evidencia.

**Artefactos:** `scripts/a063_trace_contract.py`, tests `test_a063_trace_contract.py`, runner ROM-free, `scripts/a063-native-miniprobe.sh`, `docs/a063-r1-checkpoint.md`.

**Criterio de salida `A063_R1_READY`:** pruebas integradas PASS ejecutadas (no inspección estática), contrato consistente con MAME 0.289, no falsos PASS ni sobrescritura; mini-probe preparado sin afirmar ejecución nativa.

## C2 — Forense sobre captura existente (privado, sin ejecutar MAME)

**C2.T1.** Validar hash, antigüedad y secuencia de `cpu.trace`, `pre-instruction.jsonl`, ROM privada y configuración de offsets. Ejecutar `python3 scripts/r3_bank_provenance.py diagnose`.

**C2.T2.** Clasificar valores altos, comparar pares originales con huellas auténticas y buscar una causa de formato/expresión. Análisis bajo `out/` únicamente; exportar solo JSON agregado.

**Criterio de salida:** una causa respaldada por evidencia independiente permite diseñar C3; de lo contrario, pasar a C3 como diagnóstico diferencial. **No** aceptar `&0xff` por coincidencia estadística.

## C3 — Mini-probe diferencial nativo (primer gate externo; sin recaptura total)

**C3.T1.** Validar stock MAME y ROM CRC-autenticada; lanzar en directorio privado aislado el probe de 2 frames / ~2 segundos; no tocar R2/R3 histórico.

**C3.T2.** Contrastar *en la misma frontera de instrucción*:
  1. lectura debugger `b@addr` sin máscara;
  2. lectura independiente de byte del espacio de programa;
  3. `memory.banks[":mainbank"].entry` (índice real MAME);
  4. nueve registros CPU / PC / secuencia.
La API Lua por frame **no** es una correlación por instrucción; primero demostrar que existe un hook nativo confiable. Si no se consigue, usar banco activo como comprobación puntual auxiliar, no como witness 1:1.

**C3.T3.** Comparar al menos dos bancos distintos o una transición con escritura `0x3e00` observada; si el mini-probe solo ve un banco, el resultado es **INCONCLUSIVE**, no PASS. Distinguir reinicio de selector.

**Criterio de salida `A063_MINIPROBE_NATIVE_READY`:** todas las lecturas medidas son bytes válidos, coinciden exactamente con los bytes de la ROM mapeada por el banco auténtico, y se comprueba una transición o dos bancos. En caso de error corregir primero mini-probe; no repetir la captura completa.

## C4 — Recuperación nativa de una sola corrida

**C4.T1.** Preservar/respaldar toda la evidencia anterior (sin exportarla); producir trace/prestados/observaciones con mismo run-id y binario MAME inmovilizado.

**C4.T2.** Leer diagnóstico redacted antes de generar witness. Si firmas inválidas, STOP. Si bytes válidos pero no asignan de forma unívoca, STOP.

**Criterio de salida:** nuevo trace completo con pares auténticos suficientes, forma y tiempo correlacionados, conteo CPU y líneas coherentes. No inferir banco desde muestra de frame.

## C5 — Certificación A0.6.3 + desbloqueo nativo A0.6.4

**C5.T1.** Identificar los cinco bancos por huellas autenticadas, unívocas para cada preestado; comparar secuencia, nueve registros CPU, PC, posición de línea y evidencia de transición.

**C5.T2.** Generar `private-bank-per-prestate.jsonl`, hash de ROM/bancos/trace/preestados/observaciones/witness, reporte de procedencia y histogramas de pares exactos.

**C5.T3.** Ejecutar `bash scripts/r3-banked-critical-path.sh`. Rechazar captura antigua, hashes alterados, banco erróneo o par (bank,PC) cambiado aunque conserve recuento total.

**Salida:** `BANK_IDENTITY_AT_EVERY_NATIVE_PRESTATE_VERIFIED` solo tras evidencia real completa + gate A0.6.4 nativo PASS. Esto NO certifica IRQ, bus completo, sincronización ni que el juego sea jugable.

## Árbol de decisión y alternativas

| Observación | Decisión |
| --- | --- |
| Firma >0xff, falta de marcador, fallo de formato o registers | **STOP**; aislar `b@`, radix y `tracelog` antes de MAME completo |
| Firma byte válida pero discordante con ROM/banco activo | **STOP**; investigar mapeo temporal de memoria y espacio CPU |
| Mini-probe sin cambio de banco | **INCONCLUSIVE**; ampliar cobertura mínima, no certificar transición |
| Hook exacto por instrucción no disponible | Alternativa B: instrumentar explícitamente MAME depurador/C++ en proceso privado |
| Datos privados inaccesibles | Alternativa C: continuar validación ROM-free; ningún PASS nativo |
| Mini-probe contrastado PASS | GO a **una** captura completa preservada |
| Captura completa y witness 1:1 PASS | GO a A0.6.4; R4 solo según gates específicos |

## Riesgos críticos / control

1. **Falso PASS** por enmascarar valores o usar datos de frame como banco de instrucción → parser fail-closed y comprobación independiente.
2. **Captura obsoleta o sobrescrita** → namespaces privados, manifiestos/hashes de corrida, no borrar evidencia anterior.
3. **Mini-probe de 2 frames sin cambio bancario** → ampliar cobertura controlada o disparar transición observada; no confiar en un resultado vacuo.
4. **Gates ROM-free no ejecutados** → C1 no cerrado hasta disponer de resultados reproducibles; inspección estática no basta.
5. **Confundir avance técnico con juego completo** → separar los estados A0.6.3, A0.6.4 y R4.

**Próxima tarea:** C1.T5, sin pedir intervención. Después C2 es el primer requisito privado; no preparar una captura completa antes del resultado diferencial C3.

## Actualización R2.A (2026-10-24)

Se preparó una alternativa de doble oráculo en
[a063-r2-oracle-checkpoint.md](a063-r2-oracle-checkpoint.md): parche diagnóstico
MAME 0.289, símbolo de solo lectura del banco activo y validador 1:1 de
firma ROM frente a entrada real en una sola acción tracelog. Todo en rama
feature/a063-r1-forensics-contract. **Estado ROM-free PREPARED; ejecución
nativa y A0.6.3 PASS siguen BLOCKED.**
