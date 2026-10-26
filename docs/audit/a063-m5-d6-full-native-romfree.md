# M5.D6 — full-oracle implementado; validación ROM-free

Fecha: 2026-10-26. Rama exclusiva: `feature/a063-r1-forensics-contract`.

Actualización posterior: T2 se ejecutó una vez con MAME exit 0 y postflight
íntegro, pero wrapper exit 2 por contrato de boot/B4. Ver
[checkpoint T2](a063-m5-d6-t2-native-checkpoint.md). Este documento conserva
el checkpoint histórico T0/T1 anterior a esa captura.

Dirección de este checkpoint histórico: completar D6.T0–T1 antes de cualquier
preflight/captura D6.
T2 requiere una instrucción expresa del operador después de revisar este
checkpoint. T3 depende de T2 y consume exclusivamente esa misma captura.
Tareas ejecutables: [handoff T0–T3](a063-m5-d6-full-native-handoff.md),
[launcher T2](../../scripts/a063-full-native-capture.sh),
[gates offline T3](../../scripts/r3-banked-critical-path.sh).

## T0 — baseline protegido

- Entrada: `0799fdb7db89ffa2af069fa2edbebaad39aa70f1`.
- Contexto `colima`, endpoint Unix local; imagen Linux ARM64 existente
  `sha256:a3bd689f9d867b51cd4a25f01b3dfd8ed0218b53f09347a714271e6cd964c255`.
- SHA-256 del MAME existente verificado mediante lectura:
  `80c447cd81fa91be8bf3159e22dedab157798a4f1a189e6680849179b0ac282d`.
- v2 leído únicamente con `readonly`: postflight completo, MAME exit 0,
  `A063_ORACLE_MINIPROBE_NATIVE_MATCHED_NOT_FULL_A063`.
- Contrato de inmutabilidad: v1 y v2 no se montan RW, eliminan ni reutilizan;
  MAME permanece RO y no se recompila. `main`, ROMs y evidencias previas
  permanecen fuera del trabajo de implementación.
- Había un directorio anidado `gng-ghidra/` sin seguimiento; se conserva.

## T1 — contratos implementados

1. Runner full explícito `--full-oracle`: preflight `--oracle --full-oracle`,
   acción atómica de doce expresiones (nueve registros, dos `b@`, E nativo),
   treinta frames dentro del límite existente 2–30, taps originales de
   sprite/video/MMIO y un soft reset observado. Colisiones de evidencia
   abortan antes de preparar una captura. `--capture-only` omite provenance
   full y static codegen; mantiene las validaciones originales de captura.
2. Integridad: opt-in full restringido a `out/r2/mame-probe` y al preflight
   canónico, creado una sola vez; redirecciones por symlink se rechazan.
   Acción, binario explícito, todos los
   artefactos y fuentes se verifican de nuevo. El freeze incluye los wrappers,
   gates y dependencias locales que autentican ROM y gráficos. La integridad
   por hashes sigue sin constituir atestación independiente del emulador.
3. Epochs: el notificador real de reset escribe un delimitador en el mismo
   stream nativo y una notificación TSV. Se exigen dos epochs no vacías,
   ordenadas, con un único reset solicitado/observado. No se usa frame ni PC
   muestreado para atribuir instrucciones a una epoch.
4. Provenance: igualdad E↔par ROM autenticado para cada prestate, también
   fuera de la ventana bancaria. Se comprueban secuencia, línea física,
   registros, firmas, operandos de la acción y conteos. Transiciones de reset
   no cuentan como writes. El contrato soporta STA/STB extended al selector,
   seguido por su próximo prestate en la misma epoch; exige una transición
   real, conteos de writes completos y muestras ordenadas compatibles con
   valor/banco previo/epoch. Cobertura incompleta produce `INCONCLUSIVE`.
5. Witness, oracle full, reporte y manifest se crean exclusivamente en privado
   tras PASS, sin sobrescribir evidencia anterior. El manifest vincula ROM,
   traza, TSV, capabilities, preflight, postflight, witness y ambos reportes.
   A0.6.4 exige rutas canónicas, postflight vigente, señal full explícita,
   histogramas exactos y las mismas dos epochs. Nunca compara registros
   atravesando un reset; conserva los gates reales sprite/MMIO/VRAM.

Los contratos mini conservan su rechazo de resets. La API Lua y el escape
`tracelog "\\n..."` se comprobaron por lectura de la fuente pública local de
MAME 0.289; esto no sustituye la futura prueba nativa del delimitador.

## Validación

Estado: **D6.T0 PASS; D6.T1 PASS_ROM_FREE_ONLY**. La suite completa
`TMPDIR=/private/tmp bash scripts/a063-r2b-romfree.sh` terminó con exit 0 y
`A063_R2B=ROMFREE_CHECKS_PASS_NOT_NATIVE_NOT_A063_CERTIFIED`:
149 tests Node PASS, 162 ejecuciones de tests Python PASS (incluyen suites
históricas repetidas), replay sintético 17/17 y `git diff --check` PASS.
Los tests full nuevos incluyen 14 casos de oracle y 5 del launcher; el static
gate ejecuta 8 casos, y trace/integridad 36, incluidos cuatro rechazos de
directorios redirigidos por symlink.

Los tests sintéticos no usan ROM ni ejecutan una captura MAME. La suite se
ejecutó sobre una copia de fuentes públicas en
`/private/tmp/gng-d6-romfree-gy5opw3u`, sin montar ROMs ni reutilizar `out/`
del host. Log final local ROM-free: `/private/tmp/gng-d6-romfree-suite-final.log`.
Se fijó el PATH del entorno aislado a Python 3.15.0 y Node 26.11.1 instalados;
el primer intento seleccionó Python 3.9 y falló por `hashlib.file_digest`
usado ya por el extractor. La selección de runtime resolvió ese fallo.

Casos: dos epochs; E ausente, alterado, duplicado o 5+; firma corrupta;
PC repetida con seq/registros/línea distintos; reset sin delimitación;
selector post-write incompatible; conteos/muestras del tap inconsistentes;
hash MAME/fuente/artefacto alterados; ausencia de sprite tap; artefactos
preexistentes; rutas alternativas; manifest de otra captura; launchers sin
ejecución ni creación de volumen por defecto.

## T2 — único comando preparado, NO ejecutado

Después de aceptar T1 y autorizar expresamente la captura, desde el checkout:

```bash
bash scripts/a063-full-native-capture.sh --run --volume gng-a063-private-capture-arm64-full-d6-v1
```

El launcher comprueba rama, HEAD, árbol versionado limpio y que todas las
fuentes congeladas están versionadas. Rechaza un volumen existente y usa una
etiqueta de propiedad para detectar creación concurrente. No elimina volúmenes
ni permite nombres D5/MAME. Una captura parcial se conserva; el siguiente intento
requiere otro nombre nuevo `full-d6-vN`.

Su único `docker run` fija la imagen anterior, `--context colima`,
`--network none`, `--pull never`, `--platform linux/arm64`, filesystem RO,
repositorio/`.git`/ROM/MAME RO y un volumen nuevo como `/workspace/out` RW
con `volume-nocopy`. Usa `SDL_AUDIODRIVER=dummy`, Xvfb y timeout 180 s con
10 s de terminación; comprueba el SHA de MAME antes y después. Los logs quedan
en `out/private-runner/`; la terminal recibe únicamente el código agregado.

La comprobación sin captura es:

```bash
bash scripts/a063-full-native-capture.sh --check
```

Ejecutada tras el commit de implementación `60cb4cf`:
`D6_CAPTURE_LAUNCHER=CHECK_PASS_CONFIGURATION_ONLY_NOT_CAPTURED`.
No creó volúmenes, preflight ni captura. El código está versionado localmente;
no se ejecutó push.

## T3 — preparado, pendiente de T2

Dentro de otro contenedor local con el MISMO checkout congelado, MAME RO y
el MISMO volumen T2 como `/workspace/out` RW, ejecutar:

```bash
GNG_R3_MAME_BIN=/mame/mame0289/gnga063 bash scripts/r3-banked-critical-path.sh --full-oracle
```

Mantener los logs de esa ejecución en el propio volumen privado. El workflow
verifica el postflight antes de crear reportes, revalida provenance full,
MMIO/VRAM y finalmente static codegen con el gate real de sprite de dos epochs.
Colisiones de witness/reporte/static output abortan y preservan la evidencia.
No se traslada un witness D5 ni se cambia a rutas mini-smoke.

## Estados y límites

`A063_FULL_NATIVE_BANK_PROVENANCE_PASS` está implementado como resultado del
gate full, pero NO observado sobre una captura D6 real en este checkpoint.
`A064_GATE_PASS_WITH_LIMITATIONS` no es una salida implementada ni se reclama.
El static gate conserva sus estados efectivos, incluido
`BANKED_CODEGEN_WITH_NATIVE_CHECKPOINT_PREFIX_ONLY` y divergencias explícitas.

A0.6.3/A0.6.4 permanecen `NOT_CERTIFIED`: faltan T2/T3. Incluso un futuro PASS
no demuestra bus completo, fetch CPU, IRQ/SYNC, ejecución continua, primer
frame autónomo ni videojuego jugable. Las instrucciones o writes sin cobertura
del contrato permanecen `INCONCLUSIVE`/bloqueados.

Próximo checkpoint: revisión de T1 y autorización expresa de una captura T2
en volumen nuevo; no se ha creado ningún preflight nativo D6.

## Archivos de este bloque

- `scripts/a063-full-native-capture.sh`
- `scripts/a063-full-native-inner.sh`
- `scripts/a063-r2b-romfree.sh`
- `scripts/a063_bank_oracle_gate.py`
- `scripts/a063_capture_integrity.py`
- `scripts/a063_trace_contract.py`
- `scripts/r2-mame-probe.lua`
- `scripts/r2-mame-probe.sh`
- `scripts/r3-bank-provenance-capture.sh`
- `scripts/r3-banked-critical-path.sh`
- `scripts/r3_bank_provenance.py`
- `scripts/r3_banked_static_gate.mjs`
- `tests/test_a063_capture_integrity.py`
- `tests/test_a063_full_native_launcher.py`
- `tests/test_a063_full_oracle.py`
- `tests/test_a063_trace_contract.py`
- `tests/test_r3_banked_static_gate.mjs`
- `docs/audit/a063-m5-d6-full-native-handoff.md`
- `docs/audit/a063-m5-d6-full-native-romfree.md`
