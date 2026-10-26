# M5.D6.T2 — captura nativa íntegra; wrapper bloqueado por gate offline

Fecha: 2026-10-26. Rama: `feature/a063-r1-forensics-contract`.

Actualización posterior: D6 v2 pasó T2/T3 con el gate original y full-oracle
nativo PASS; ver [cierre y límites](a063-m5-d6-native-closure.md).
Este documento conserva el checkpoint histórico de D6 v1, que no se modifica.

Dirección de este checkpoint histórico: conservar la captura D6 existente y revisar el bloqueo del
contrato de boot antes de continuar con T3. No recapturar ni relajar el gate
para obtener PASS. T0 está PASS y T1 está `PASS_ROM_FREE_ONLY`; T2 produjo
evidencia completa con postflight íntegro, pero su comando terminó en 2.
Por ello **no se declara T2 PASS completo**. T3 no se ha ejecutado y
**A0.6.3/A0.6.4 permanecen NOT_CERTIFIED**.

Tareas y criterios: [handoff D6](a063-m5-d6-full-native-handoff.md).
Implementación validada: [checkpoint T0/T1](a063-m5-d6-full-native-romfree.md).

## Ejecución autorizada

El operador autorizó expresamente T2 después de revisar T1 y el comando.
Presupuesto comunicado: 71% restante de 5 h, 96% semanal. Estimación previa
de este bloque: 3–7 puntos de la ventana de 5 h y menos de un punto semanal.

Checkout de captura congelado:
`e89e79acfba702de5399ea2cf5e66884022487f5`.
Árbol versionado limpio antes de ejecutar; se conservó el directorio anidado
`gng-ghidra/` sin seguimiento.

El precheck devolvió
`D6_CAPTURE_LAUNCHER=CHECK_PASS_CONFIGURATION_ONLY_NOT_CAPTURED`.
Se ejecutó exactamente una vez:

```bash
bash scripts/a063-full-native-capture.sh --run --volume gng-a063-private-capture-arm64-full-d6-v1
```

Resultado agregado del launcher: **`D6_CAPTURE_EXIT=2`**.
El volumen nuevo se conserva completo y no se reutilizará. No se han hecho
reintentos. Las comprobaciones posteriores montaron esa evidencia y MAME
exclusivamente en lectura. Los volúmenes D5 no se montaron durante este bloque.

La imagen ARM64, los montajes RO de repositorio/ROM/MAME, red deshabilitada,
timeout y logs privados son los del launcher validado en T1. Los logs brutos
permanecen en `out/private-runner/` dentro del volumen; las trazas, observaciones
y demás artefactos privados no se publican.

## Resultados agregados verificados

| Comprobación | Resultado |
| --- | --- |
| MAME exit observado por el wrapper | 0 |
| Preflight con opt-in full-oracle | true |
| Postflight `capture_artifacts_complete` | true |
| Acción real coincide con preflight | true |
| Configuración full observada | true |
| Árbol versionado limpio durante la captura | true |
| HEAD observado coincide con el checkout de captura | true |
| Revalidación RO de la cadena completa | `A063_POSTFLIGHT_CHAIN_INTACT_NOT_BANK_PROVENANCE` |
| SHA MAME coincide con el baseline protegido | true |
| Marcador de error Lua ausente | true |
| Preestados / marcadores parseados | 179.924 / 179.924 |
| Marcadores malformados | 0 |
| Frames observados | 30 |
| Reset controlado observado | 1 |
| Delimitador nativo de reset | 1, epoch esperada |
| Lecturas MMIO observadas | 100 |
| Escrituras MMIO observadas | 12 |
| Escrituras del selector bancario observadas | 1 |
| Escrituras VRAM observadas | 4.096 |
| Escrituras sprite observadas | 2.304 |

La revalidación utilizó `a063_capture_integrity.verify_postflight()` en modo
RO: volvió a comprobar artefactos, preflight, fuentes congeladas, acción real,
binario y configuración full/reset. El SHA MAME verificado sigue siendo
`80c447cd81fa91be8bf3159e22dedab157798a4f1a189e6680849179b0ac282d`.
Estos contadores no certifican identidad bancaria 1:1, bus ni codegen.

## Causa precisa del exit 2

El fallo ocurrió después de la ejecución y postflight satisfactorios de MAME.
Aunque el runner superior recibió `--capture-only`, su wrapper existente
`r3-mmio-read-capture.sh` invoca automáticamente el gate B4 offline.
Ese gate produjo:

```text
GNG_R36_B4_UNMAPPED=BLOCKED R3_FRONTIER_MISSING_COMPLETE_NATIVE_BOOT_WRITE_PROOF
```

Cadena de llamadas: B4 → `runNativeBootWriteGate()` →
`inspectNativeSyncPrestates()` → `inspectPostBootFrontier()`.
El último contrato exige exactamente 768 muestras sprite nativas entre
dos epochs, 384 por epoch y cero escrituras adicionales.

El reporte privado de boot, creado por el wrapper antes del bloqueo, permite
identificar la discrepancia sin exponer datos de la traza:

| Evidencia de boot | Primera epoch | Segunda epoch |
| --- | --- | --- |
| Bytes de boot esperados | 384 | 384 |
| Muestras nativas registradas | 384 | 1.920 |
| Secuencia de boot coincide de forma única | true | true |
| Otras escrituras nativas sin verificar por ese gate | 0 | 1.536 |

El diferencial de boot emitió `PASS_BOOT_SPRITE_RAM_WRITE_BYTES`, pero ese
resultado acotado no cumple el contrato más estricto del frontier/B4 por
las 1.536 escrituras adicionales de la segunda epoch. No se han eliminado
muestras, recortado la traza ni modificado contratos.

El gate final de VRAM no llegó a ejecutarse después del bloqueo B4.
El workflow T3 `r3-banked-critical-path.sh --full-oracle` no se invocó.
Se comprobó que no existen resultado full-oracle, witness de banco,
manifest de evidencia bancaria, reporte bancario ni directorio banked-codegen.

## Próximo checkpoint

Revisar el contrato de boot frente a esta captura larga, conservando todas
las escrituras y las exigencias de comparación. Resolver el bloqueo mediante
un cambio revisable y probado, o documentar que el contrato actual requiere
otra captura; no decidir una recaptura por un exit 2 genérico.
La identidad bancaria 1:1 y A0.6.4 se evaluarán en T3 sobre evidencia de la
misma corrida y con las fuentes congeladas correspondientes.

Este checkpoint solo añade documentación saneada. No modifica código sujeto
a `SOURCE_FILES`, binario MAME, ROMs, evidencias D5, captura D6 ni `main`.
