# Seguimiento D6 — efectos bancarios y contrato IRQ/SYNC

Fecha: 2026-10-26. Rama: `feature/a063-r1-forensics-contract`.

Dirección actual: implementar la familia bancaria `LEA_INDEXED` pendiente,
certificar las escrituras de RAM principal y obtener evidencia independiente
de IRQ/SYNC/VBlank y estado inicial. Después se podrá medir ejecución JS/TS
continua hasta un primer frame. [Tareas siguientes](#tareas-siguientes).
El [cierre D6](a063-m5-d6-native-closure.md) conserva sus resultados originales;
este diagnóstico no promociona el estado de A0.6.4.
Actualización: la tarea 1 quedó resuelta como diagnóstico en
[`LEA_INDEXED`](a064-lea-indexed-codegen.md); los resultados de abajo se conservan.

## Objetivos y resultados de este bloque

| Objetivo | Evidencia verificable | Estado |
| --- | --- | --- |
| Precisar la cobertura pendiente usando la misma corrida | D6 v2 montado RO; 11 roles SHA256 y cadena fuentes/binario verificados | Cerrado como diagnóstico |
| Clasificar los efectos bancarios sin inventar bus nativo | 2.477 stores `STA_INDEXED`; 2.477 bytes predichos en `MAIN_RAM` | Destino identificado; prueba nativa pendiente |
| Comparar registros de las stores antes excluidas | 2.477 checkpoints adicionales coincidentes; cero divergencias | Comparación por paso, con preestado nativo |
| Endurecer el contrato temporal IRQ/SYNC | Reset obligatorio, ciclos monótonos por epoch y SYNC emparejado | Implementado y validado ROM-free |
| Demostrar estado inicial y primer frame autónomo | No hay nueva evidencia que cierre esos contratos | Pendiente |

La muestra sin codegen pertenece a la familia indicativa `LEA_INDEXED`.
La clasificación describe opcodes observados; no demuestra semántica de un
postbyte ni habilita ejecución especulativa.

## Diagnóstico offline reproducible y sin escrituras

Archivos añadidos:

- `scripts/r3_banked_effect_profile.mjs`: función pura con familias/regiones
  permitidas, particiones exactas y sinks de escritura predictivos.
- `scripts/r3_d6_followup_diagnostic.mjs`: lector de las rutas canónicas D6;
  rechaza symlinks en archivos o ancestros, verifica los 11 hashes y el
  postflight antes de generar módulos exclusivamente en memoria.
- Sus dos suites sintéticas, integradas en `scripts/r3-local-regression.sh`.

Comando dentro del entorno privado con fuentes congeladas y volumen RO:

```bash
node scripts/r3_d6_followup_diagnostic.mjs --mame-bin /mame/mame0289/gnga063
```

No arranca MAME ni genera archivos de evidencia. Solo imprime familias,
regiones, estados, contadores y booleanos; los fallos exportan un marcador
fijo, sin errores privados del subproceso.

La ejecución real utilizó las fuentes capturadas `9cb19f5`, archivadas en
`/Users/matias/.cache/gng-d6/frozen-9cb19f5-d_8oiz64`, más los dos módulos
nuevos de diagnóstico. Los archivos nuevos no forman parte del cierre
atestiguado de la captura; el diagnóstico conserva ese alcance explícito.
La imagen ARM64 fijada, el volumen D6 v2 y el volumen MAME existente se
usaron sin red y en solo lectura. No se montaron las evidencias D5 o D6 v1.

| Partición de las muestras bancarias | Cuenta |
| --- | ---: |
| Muestras totales | 7.434 |
| Con codegen ejecutadas por el diagnóstico | 7.433 |
| Checkpoints de registros coincidentes | 7.432 |
| Checkpoints divergentes | 0 |
| Sin siguiente preestado | 1 |
| Comparaciones omitidas por frontera de reset | 0 |
| Sin codegen | 1 |
| Stores con registros comparados | 2.477 |
| Escrituras byte predichas en RAM principal | 2.477 |
| Escrituras certificadas por este diagnóstico contra taps nativos | 0 |

Se cumple `7.432 + 1 + 1 = 7.434`. Los 7.432 incluyen los 4.955
checkpoints del gate original y los 2.477 registros de stores adicionales.
No son pasos autónomos encadenados: cada instrucción parte de su propio
preestado MAME. Los reportes originales, incluido
`BANKED_CODEGEN_WITH_NATIVE_CHECKPOINT_PREFIX_ONLY`, no se reescribieron.

## Contrato ejecutable IRQ/SYNC

`scripts/r3_native_irq_report.mjs` exige un `CPU_RESET` antes de cualquier
otro marcador y ciclos no decrecientes dentro de cada epoch. Un nuevo reset
puede reiniciar el contador y cancela esperas/afirmaciones previas. Todas
las entradas SYNC se emparejan con su salida o cancelación por reset;
esperas anidadas, salidas huérfanas y finales incompletos se rechazan.

Una línea desactivada pierde su afirmación candidata. Para clasificar wake
enmascarado se consideran todas las líneas activas al salir; no se omite
una NMI u otra línea sin máscara. Entrada IRQ/vector antes de la salida SYNC
también se rechaza. Se distinguen SYNC totales, salidas del sitio objetivo
y esperas canceladas por reset.

Los 19 tests dirigidos son sintéticos. El parser mantiene falsas las
banderas de autenticación del binario, equivalencia IRQ de JS, bus completo,
cold reset y juego jugable. No se ejecutó el launcher histórico IRQ, que
reutiliza rutas de captura anteriores. El binario MAME protegido no se
recompiló; su oráculo bancario no aporta por sí mismo estos marcadores IRQ.

## Validación ejecutada

- Tests dirigidos: perfil 9/9, CLI 7/7 e IRQ/SYNC 19/19 PASS.
- Suite `a063-r2b-romfree.sh` completa: exit 0, 184 tests Node PASS,
  176 ejecuciones Python PASS (incluyen suites históricas repetidas),
  `A063_R2B=ROMFREE_CHECKS_PASS_NOT_NATIVE_NOT_A063_CERTIFIED`.
- Ejecución en copia pública aislada, sin ROM, captura o binario MAME.
  El primer intento se detuvo por omisión del Dockerfile en esa copia;
  se añadió el archivo público y la ejecución integral posterior pasó.
- Diagnóstico privado RO: exit 0, 11 roles SHA256 y cadena íntegros;
  comparación y predicción locales, sin nueva captura ni archivos generados.

## Tareas siguientes

1. **Codegen:** inspeccionar en privado el modo real de `LEA_INDEXED`,
   implementar únicamente la semántica respaldada y validarla con fixtures
   sintéticos de registros/flags y el mismo witness en solo lectura. Conservar
   las fuentes D6 congeladas al verificar su cadena original.
2. **RAM principal:** diseñar tap nativo acotado para las stores identificadas,
   enlazar orden/epoch y exigir cobertura completa de dirección, dato y
   máscara. Un match de registros o la predicción de escrituras no sustituye ese
   tap. Probar runner/contrato antes de autorizar otra captura; el gate de
   boot actual sigue requiriendo su cobertura exacta y debe preservarse.
   Tarea preparada, no ejecutada: [RAM nativa](../agents/a063-main-ram-native-tap-task.md).
3. **IRQ/SYNC/VBlank/estado inicial:** preparar un entorno y destino nuevos,
   separados del binario/evidencia protegidos. La aceptación deberá enlazar
   hash de binario/fuentes, run y epoch; observar reset, líneas, SYNC y
   frontera VBlank con orden temporal independiente. Distinguir cold reset
   de soft reset y de origen del estado previo a los taps.
4. **Primer frame:** definir una única semilla CPU/banco/líneas con origen
   demostrado y memoria conocida por escritura o evidencia inicial. Exigir
   RAM, VRAM, buffer sprite, paleta y scroll necesarios sin asumir cero;
   `LAB_SYNTHETIC` y `PRE_TAP_UNATTESTED` siguen siendo orígenes no nativos.
   Ejecutar JS/TS continuamente, sin reinyectar registros del oráculo, hasta
   una frontera de frame autenticada y comparar el resultado independiente.

Este bloque prepara y acota las dependencias; no ejecuta una captura nueva
ni certifica las tareas 1–4.
