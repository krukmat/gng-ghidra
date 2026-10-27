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


## B2.T4 — EI y frontera de interrupciones (27/10/2026)

**Nuevo gate verificado por operador en Mac:** B0+B1+B2 ED transfer pasó Node **48/48** y Python **11/11**, ROM SHA1_MATCH, privacidad PASS. AOT pasó de 13 a 20 instrucciones estáticas; nueva frontera en PC=267 (0x010B), familia EI. Todavía no se han observado audio reproducible ni paridad MAME.

Cambios publicados:
- src/gngb_z80_static_codegen.mjs compila EI (0xFB) a IFF1=true, IFF2=true, PC+1 y +4 T-states. EI no modifica flags. La prohibición de aceptar IRQ hasta DESPUÉS de completar la siguiente instrucción se representa por eiDelay=2, sin ejecutar ni aceptar interrupciones.
- El compilador DI (0xF3) limpia IFF1, IFF2 y cualquier EI pendiente (eiDelay=0).
- src/gngb_z80_irq_boundary.mjs añade stepZ80AotAtBoundary(...) para decrementar la ventana de EI en cada instrucción terminada y canAcceptZ80MaskableIrq(...) como PREDICADO de elegibilidad, no servicio de interrupciones. EI+RET, EI+DI y EI+EI se contemplan sin aceptar IRQ prematuramente.
- tests/test_gngb_z80_irq_boundary.mjs incluye seis casos sintéticos. El runner único incorpora el nuevo archivo.
- **40/40** tests sintéticos del compilador, del informe de fronteras y de EI pasan en ejecución aislada JS. El conjunto integral de tests Node+Python del Mac todavía está pendiente para este commit.

Semántica basada en Zilog Z80 CPU User Manual: https://www.zilog.com/docs/z80/z80cpu_um.pdf — EI activa ambos flip-flops de inmediato pero retrasa la aceptación de solicitudes INT pendientes hasta terminar la instrucción posterior.

**Límites de certificación:** El helper no está integrado en un scheduler Z80 runnable, y no implementa reconocimiento o despacho IRQ, IM0/1/2, reset real, NMI, contador R ni paridad de temporización MAME. Invocar bloques AOT directamente NO constituye una ejecución IRQ válida; el estado eiDelay=2 es rechazado por el helper hasta que su consumidor use el ciclo completo.

### Próximo checkpoint Mac

    git pull --ff-only origin main
    node scripts/audio_fast_checkpoint.mjs

Enviar únicamente GNG_AUDIO_G5_FAST_CHECKPOINT_V1. La siguiente frontera reportada determina qué familias incorporar. No enviar ROM ni archivos out/audio. B3 YM2203 y PCM continúa como ruta crítica paralela al AOT.
