# G5-FAST B2 — Primera familia de codegen: ED block transfer

Repo: krukmat/gng-ghidra · Rama main · 2026-10-27

## Entrada confirmada por operador

- B0+B1 aprobado en Mac: **44/44 Node PASS, 11/11 Python PASS**, ROM SHA1_MATCH, guardia de privacidad PASS.
- CFG estático: 13 instrucciones compiladas, 1 frontera PC=250 (0x00FA), ED_EXTENDED_PREFIX / ED_BLOCK_TRANSFER.
- Sigue sin haber audio del juego, YM2203 PCM ni paridad MAME certificada.

## B2 parcial — alcance implementado

| Task | Entregable | Estado |
| --- | --- | --- |
| B2.T1 | Factorización de la familia ED_BLOCK_TRANSFER en un único branch estático del AOT; semántica elegida en compilación, no intérprete en runtime | IMPLEMENTED |
| B2.T2 | LDI / LDD / LDIR / LDDR con lectura (HL), escritura (DE), HL/DE ±1, BC−1, wrap 16 bits, flags no documentados y repetición de 1 byte por step | IMPLEMENTED |
| B2.T3 | Pruebas independientes de registros, RAM, ciclos, flags y loop; comparación diferencial MAME en hardware real | SYNTHETIC_PASS / NATIVE_PENDING |

La familia de transferencia ejecuta **16 T-states** para LDI/LDD, **21 T-states** para LDIR/LDDR mientras BC != 0 y **16** al completar; las instrucciones repetitivas permanecen en el mismo PC por iteración para permitir un futuro scheduler de interrupciones. Los flags S, Z y C se conservan; H/N se limpian, P/V depende de BC después del decremento, F3/F5 provienen de A + byte transferido. Valores avalados por especificaciones clásicas Z80 y referencias de instrucción: https://asm-editor.specy.app/documentation/z80/instruction/ldir y https://asm-editor.specy.app/documentation/z80/instruction/lddr.

**Limitaciones:** El contador de refresco R, interrupciones entre iteraciones, cronología precisa de transacciones de bus y paridad registro-a-registro con MAME NO han sido verificados. Los offsets de lectura/escritura en el bus generados para el laboratorio necesitan comparación nativa. No declarar Z80 completa incluso si el CFG deja de encontrar bloqueos.

## Evidencia de pruebas

- 4 nuevas pruebas sintéticas para LDI, LDD, LDIR y LDDR con contadores, overflow 16-bit, flags F3/F5, lectura/escritura y 16/21 T-states.
- Fixtures previos ED_BLOCK_TRANSFER que asumían falta de soporte actualizados para ED_BLOCK_COMPARE (sigue sin implementar).
- 34/34 pruebas sintéticas de compiler/frontier report ejecutadas PASS en un harness JS aislado. **No** equivalen a los tests de Node en Mac ni a paridad MAME.
- No se ha accedido a la ROM privada, ni a PCM/WAV nativo. No hay cambios en MC6809, engine, bot, GitHub Actions ni ROM en Git.

## Un solo gate del operador Mac

    git checkout main && git pull --ff-only
    node scripts/audio_fast_checkpoint.mjs

Esperado: GNG_AUDIO_G5_FAST_CHECKPOINT_V1 con Node/Python regresión PASS y un NUEVO conjunto de familias en z80_scan; G5 sigue NOT_CERTIFIED. Compartir solo el JSON resumido de consola. No enviar out/audio, gg2.bin, tapes, codegen ni audio original.

## Siguiente decisión tras el gate

1. Implementar en lotes las familias efectivamente bloqueantes que revele el escáner; evitar opcode-a-opcode si hay varias familias.
2. Mantener B3 paralelo como camino crítico hacia primer WAV YM2203 generado en laboratorio desde escrituras nativas, sin esperar Z80 completa.
3. No declarar audio durante gameplay hasta conectar Z80→YM→PCM y cotejar eventos/timestamps contra MAME.
