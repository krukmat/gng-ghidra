# A0.6.3 — Unblock bank-per-instruction provenance

## Evidencia ya adquirida (22/10/2026)

- 17.135 registros de preinstrucción nativos, y 17.135 líneas con ambos marcadores `GNG_R2_PRE` + `GNG_A06_BANKSIG`.
- Divergencias PC/registros/línea: **0**.
- Pares donde al menos un campo de firma excede 0xFF: **17.135**.
- Fallo estricto: `A063_NATIVE_SIGNATURE_EXCEEDS_BYTE`.
- La correspondencia CPU está alineada, **pero no hay asignación de banco autenticada por instrucción**. A0.6.3 y certificación nativa A0.6.4 continúan BLOCKED.

Referencia externa (MAME 0.289):
- https://docs.mamedev.org/debugger/index.html: `b@` lee **1 byte** del espacio de programa y suprime efectos secundarios.
- https://github.com/mamedev/mame/blob/master/src/emu/debug/debugcmd.cpp: `tracelog` aplica formato tipo printf; `%02X` es ancho mínimo.
- https://docs.mamedev.org/luascript/ref-mem.html: Lua `memory.banks[tag].entry` expone el índice activo **en el instante de consulta**, no automáticamente por instrucción.

## Ruta crítica

### N1 — Forense sobre evidencia privada ya guardada (sin ejecutar MAME)

Desde la raíz del repositorio en la máquina que conserva `out/r2`, `out/r3` y la ROM local:

```bash
git pull --ff-only
bash scripts/r3-local-regression.sh
python3 scripts/r3_bank_provenance.py diagnose
```

El diagnóstico es agregado y no exporta bytes, registros ni ROM. Leer:
- `first_signature_values_exceed_byte` y `second_signature_values_exceed_byte`.
- `nonbyte_upper_bit_shape_counts`.
- `private_rom_fingerprint_crosscheck_performed`.
- `native_pairs_matching_full_width_authentic_fingerprint` frente a `native_pairs_matching_authentic_fingerprint_only_after_lowbyte_mask`.
- Desalineaciones CPU/PC/línea.

Si cualquiera de las 17.135 firmas completas excede 0xFF, **no** ejecutar `report` en modo permisivo, no aplicar `& 0xff`, no declarar A0.6.3 PASS. Un parecido tras máscara es solamente una pista.

### N2 — Corregir el origen, si las firmas siguen inválidas

Revisar **localmente** `out/r2/mame-probe/start-debugger.txt` y el trace privado para determinar:
1. Si la acción MAME evaluó exactamente dos expresiones `b@` en la ventana `0x4000…0x5fff`, asociadas a la CPU `:maincpu`.
2. Si la conversión/formato de argumentos imprimió un valor distinto de la lectura de 8 bits.
3. Si hay fallo de expresión, espacio de memoria equivocado, o dato ya corrupto.
4. Si pueden recuperarse las 17.135 firmas íntegras del mismo archivo **sin interpretación/truncamiento inventado**.

Si las lecturas nativas no son de 8 bits, corregir el origen del script/debugger y repetir una **única captura MAME privada** con:

```bash
bash scripts/r3-bank-provenance-capture.sh
```

El wrapper conserva backups de evidencia anterior. Verificar primero que los bancos ROM siguen CRC-autenticados y que el fichero `out/` no se exporta a GitHub. No ejecutar una recaptura mientras sea posible reutilizar el archivo anterior íntegro.

### N3 — Aceptación 1:1 y desbloqueo de A0.6.4

La tarea A0.6.3 solo se cierra si:
- Cada preestado tiene exactamente un par de bytes válido `0..255` que identifica inequívocamente uno de los **cinco** bancos autenticados.
- `seq`, PC, nueve registros CPU y línea nativa coinciden **1:1**.
- Cambios de banco observados no se atribuyen falsamente a un opcode de selector; reset y escrituras se distinguen.
- El reporte `BANK_IDENTITY_AT_EVERY_NATIVE_PRESTATE_VERIFIED`, el witness privado y los hashes de origen son coherentes para la misma corrida.
- El gate A0.6.4 coteja **cada** par (banco, PC, recuento) con el informe, no solamente los totales.

Después, en esa misma máquina y con esa evidencia:

```bash
bash scripts/r3-banked-critical-path.sh
```

### Ruta alternativa: banco activo MAME directo

MAME Lua expone `memory.banks[tag].entry`, pero leerlo por frame **no prueba identidad por instrucción**. Solo adoptar esa ruta si se implementa y verifica un hook del estado activo en cada frontera MC6809, independiente de los bytes `b@`. No sumar estado de un frame a 17.135 preestados ni inferir banco inicial.

## Política mientras no existe acceso a los ficheros privados

Trabajo posible: tests ROM-free, endurecimiento de parser, formato de captura, reportes, mutaciones adversariales y revisión del código MAME. No publicar ROM/trace/witness, no activar GitHub Actions y **no** fabricar PASS nativos desde fixtures. La ejecución de N1/N2/N3 depende de acceso legítimo a los datos privados y un MAME compatible; no puede certificarse solo con el repositorio público.
