# R2.A1–A4: oracle bancario nativo (MAME 0.289)

Fecha: 2026-10-24. Estado: IMPLEMENTADO EN RAMA; COMPILACION Y CAPTURA NATIVAS PENDIENTES.

## Qué se implementó

- R2.A1: instrumentación basada en el hook nativo device_debug::instruction_hook y el symbol_table de la CPU.
- R2.A2: patches/mame0289-a063-bank-oracle.patch añade un símbolo de solo lectura gng_a063_bank que devuelve m_mainbank->entry(), sin modificar bankswitch_w ni el mapa de memoria.
- R2.A3: scripts/a063_bank_oracle_gate.py rechaza firmas >255, identidad real fuera de 0..4, registros CPU desalineados, marcadores faltantes/duplicados y desacuerdo con ROM en una sola instrucción.
- R2.A4: scripts/a063-native-oracle-miniprobe.sh ejecuta una captura aislada con binario diagnóstico explícito y cadena de integridad preflight/postflight.

Referencias MAME 0.289: https://github.com/mamedev/mame/blob/mame0289/src/emu/debug/debugcpu.cpp ; https://github.com/mamedev/mame/blob/mame0289/src/emu/debug/express.h ; https://github.com/mamedev/mame/blob/mame0289/src/mame/capcom/gng.cpp

## Validación ROM-free

  git switch feature/a063-r1-forensics-contract
  git pull --ff-only
  bash -n scripts/r2-mame-probe.sh scripts/a063-native-oracle-miniprobe.sh
  python3 -m unittest discover -s tests -p 'test_a063_oracle.py' -v
  bash scripts/r3-local-regression.sh

## Compilación y prueba privada en macOS (requiere el operador)

Usar checkout SEPARADO de mamedev/mame en el tag exacto mame0289 (no una rama más reciente). Requiere dependencias y toolchain MAME/macOS.

  MAME_SRC="$HOME/src/mame-0289"
  python3 scripts/a063_patch_mame_oracle.py --mame-source "$MAME_SRC"
  python3 scripts/a063_patch_mame_oracle.py --mame-source "$MAME_SRC" --apply
  (cd "$MAME_SRC" && make -j6 SOURCES=src/mame/capcom/gng.cpp)
  export GNG_R3_MAME_BIN="$MAME_SRC/mame"
  "$GNG_R3_MAME_BIN" -version
  bash scripts/a063-native-oracle-miniprobe.sh

El path del ejecutable generado por MAME debe verificarse: no asumir que siempre es $MAME_SRC/mame. El comando de build no ha sido ejecutado en este entorno.

## Gates falsables

- PASS MINI: banco del driver coincidente con las huellas ROM en TODOS los prestates, 256 o más instrucciones, dos bancos distintos, escritura 0x3e00 observada y sin reset.
- INCONCLUSIVE: menos de 256 prestates, un banco, ausencia de escritura o reinicio. NO elevar A0.6.3.
- BLOCKED: falta símbolo, desalineación de PC/CPU/línea, cualquier firma fuera de byte o cualquier desacuerdo entre fuente ROM y banco MAME.
- PASS MINI NO ES PASS A0.6.3: la captura completa y su witness 1:1 siguen pendientes.

Los únicos reportes permitidos fuera de out/ son diagnósticos agregados sin ROM, registros CPU, trazas, offsets, firmas ni secuencia de bancos.
GitHub Actions prohibidos. No alterar main ni reutilizar capturas R2.

Estado de salida: R2_A1_A4_PREPARED_NATIVE_VALIDATION_REQUIRED.
