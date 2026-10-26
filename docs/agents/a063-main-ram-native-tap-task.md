# Tarea preparada — prueba nativa de escrituras en RAM principal

**Checkpoint T1.1–T1.4 (26/10/2026):** el operador confirmó suite ROM-free integral PASS mediante los marcadores `GNG_LOCAL_REGRESSION=PASS_ROM_FREE_A0_2_TO_A0_6_3`, `GNG_LOCAL_REGRESSION=PASS_ROM_FREE_R3_R42H` y `A063_R2B=ROMFREE_CHECKS_PASS_NOT_NATIVE_NOT_A063_CERTIFIED`. Auditoría de fuentes completada y `watchpoint+tracelog` evaluado sin afirmar causalidad. **`--check` del launcher aún pendiente en Mac; no existe autorización T2.** [Revisión T1](../audit/a063-main-ram-native-tap-t1-review.md).

**Checkpoint T0 (26/10/2026):** implementación ROM-free y 9/9 tests Node dirigidos PASS; inspección estática 19/19 PASS. **Suite integral BLOCKED_ENV_MISSING_CHECKOUT**, no T0_FULL_PASS. Sin ROM/MAME/Docker/captura, T1/T2/T3 no iniciadas. Ver [reporte T0](../audit/a063-main-ram-native-tap-t0.md).

Estado original: tarea preparada el 2026-10-26. Ninguna captura puede
empezar sin autorización explícita del operador para ese bloque.

Contexto: tras [`LEA_INDEXED`](../audit/a064-lea-indexed-codegen.md), D6 v2
tiene 7.434/7.434 muestras bancarias con codegen. Hay 2.477 stores
`STA_INDEXED` con una escritura byte predicha en `MAIN_RAM`
(`0x0000–0x1dff`) y ninguna certificada por un tap nativo. El gate A0.4 de
VRAM documenta que los taps no traen un PC emisor fiable; el pre-trace actual
tampoco registra ciclos. Ese enlace es el problema central de esta tarea.

## Objetivo

En una corrida nueva y autenticada, demostrar que cada escritura predicha en
RAM principal por las stores de la ventana bancaria coincide con exactamente
un evento nativo (dirección, dato y máscara) enlazado a la misma ocurrencia
de instrucción, orden y epoch. Si no se puede, bloquear con causa concreta.

## Preservación

- Rama exclusiva; `main` sin cambios y sin push.
- D5, D6 v1 y D6 v2 sin escrituras; D6 v2 solo RO como referencia.
- MAME: volumen `gng-a063-mame0289-arm64-v1` RO, binario
  `/mame/mame0289/gnga063`, SHA256
  `80c447cd81fa91be8bf3159e22dedab157798a4f1a189e6680849179b0ac282d`.
  Sin rebuild ni parche nuevo del binario.
- Volumen nuevo propuesto: `gng-a063-private-capture-arm64-ram-tap-v1`,
  creado solo por el launcher después de `--check`.
- Imagen local fijada, sin red; repo, `.git`, ROM y MAME RO.
- `r2-mame-probe.lua`, `r2-mame-probe.sh` y los launchers están en
  `SOURCE_FILES`: commit, árbol limpio y fuentes congeladas antes de capturar.
- Solo se exportan familias, regiones, estados, contadores y booleanos.

## T0 — Contrato y gate ROM-free, sin MAME

1. **Enlace escritura → instrucción.** Elegir con fixtures sintéticos:
   - preferida: un ordinal o contador de ciclos común a pre-trace y tap,
     solo si el código público de MAME 0.289 confirma que la API Lua lo
     expone sin recompilar;
   - alternativa más débil: secuencia ordenada única por epoch, como A0.4,
     declarada explícitamente como tal.
   El PC leído dentro del tap no es prueba de causalidad.
2. **Tap acotado:** `install_write_tap` sobre `0x0000–0x1dff` de la CPU
   principal. Registra epoch, ordinal, dirección, dato, máscara y el enlace
   elegido, solo en el volumen privado. Los taps de sprite, VRAM y B4 y su
   cobertura exacta no cambian.
3. **Gate offline** (nombre propuesto `scripts/r3_native_main_ram_write_gate.mjs`):
   - exige la misma corrida y manifest;
   - recalcula las predicciones con el codegen desde cada preestado;
   - compara 1:1 dirección, dato y máscara `0xff`, sin faltantes, extras ni
     duplicados;
   - no atribuye a las stores escrituras de pila u otras instrucciones;
   - reporta solo agregados.
4. **Tests sintéticos:**
   - casos del gate: coincidencia, falta, sobra, dato, máscara u orden
     erróneos, cruce de epoch, duplicados y escrituras ajenas intercaladas;
   - contratos de launcher e inner;
   - preservación de B4, VRAM y sprite.
5. `TMPDIR=/private/tmp bash scripts/a063-r2b-romfree.sh` PASS en copia
   pública aislada, con dependencias públicas y Dockerfile.

## T1 — Autorización del operador

Presentar diff revisado, estimación de presupuesto, volumen nuevo y frames
(4, como D6 v2). Sin autorización explícita, la tarea se detiene aquí.

## T2 — Captura única

`--check` con el volumen inexistente y después una sola `--run`. Sin
reintentos a ciegas: un fallo se documenta con su marcador fijo.

## T3 — Gates offline sobre la misma corrida

Primero provenance/full-oracle (11 roles y cadena); después el gate RAM, en
destinos nuevos y sin sobrescribir los reportes de T2.

## Aceptación

- `A063_FULL_NATIVE_BANK_PROVENANCE_PASS` en la corrida nueva.
- B4, VRAM y sprite conservan su cobertura exacta.
- Todas las escrituras predichas en `MAIN_RAM` por stores bancarias quedan
  enlazadas 1:1 a eventos nativos, con cero faltantes, extras y
  divergencias. Se informa la cobertura observada, sin prometer 2.477.
- Una diferencia de recuentos con D6 v2 se documenta como diferencia de
  corrida y no se fuerza.

## No certifica

IRQ/SYNC/VBlank, estado inicial, ejecución continua, primer frame ni juego
jugable. Tampoco stores de ROM fija que el gate no incluya explícitamente.
