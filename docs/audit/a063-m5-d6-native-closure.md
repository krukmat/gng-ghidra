# M5.D6 — full-native bank provenance PASS; static codegen limitado

Fecha: 2026-10-26. Rama exclusiva: `feature/a063-r1-forensics-contract`.

Dirección actual: D6.T0–T3 ejecutadas y cerradas en su alcance de validación.
El banco por preinstrucción queda demostrado para la corrida D6 v2 completa;
el codegen conserva su estado limitado. El siguiente bloque debe resolver
cobertura/efectos pendientes de A0.6.4 y causalidad IRQ/SYNC/estado inicial
antes de demostrar un primer frame autónomo JS/TS. No repetir mini-oráculo
ni crear capturas por inercia.

Tareas y aceptación: [handoff D6](a063-m5-d6-full-native-handoff.md).
Diagnóstico y corrección: [corrida full acotada](a063-m5-d6-bounded-full-run.md).
Historial del primer intento: [D6 v1](a063-m5-d6-t2-native-checkpoint.md).

## Estados efectivos

```text
D6.T0  [██████████] 100% PASS
D6.T1  [██████████] 100% PASS_ROM_FREE_ONLY
D6.T2  [██████████] 100% PASS
D6.T3  [██████████] 100% GATES_EXECUTED_WITH_CODEGEN_LIMITATIONS
```

Las barras describen tareas D6; no representan avance porcentual del juego.
Salidas observadas, sin inventar un nuevo estado del runner:

- `D6_CAPTURE_EXIT=0`.
- `D6_T3_EXIT=0`.
- `A063_FULL_NATIVE_BANK_PROVENANCE_PASS`.
- `BANKED_CODEGEN_WITH_NATIVE_CHECKPOINT_PREFIX_ONLY`.

`A064_GATE_PASS_WITH_LIMITATIONS` sigue sin ser una salida implementada.
No se declara certificación global de A0.6.4, equivalencia completa de CPU,
bus, IRQ/SYNC, ejecución continua, primer frame autónomo ni juego jugable.

## Implementación congelada y validación ROM-free

Commit de implementación:
`9cb19f5a2a5a7abe6bf58c6e36589934b7ad37ab`.

El launcher permite `--frames 2..30`, default 4, con rechazo temprano de
argumentos inválidos/duplicados. El inner vuelve a validar y propaga el valor.
El runner full conserva los contratos originales. T3 crea un directorio
offline nuevo y preserva los reportes del wrapper de captura.

Archivos de implementación/tests/documentación de ese commit:

- `scripts/a063-full-native-capture.sh`
- `scripts/a063-full-native-inner.sh`
- `scripts/r3-bank-provenance-capture.sh`
- `scripts/r3-banked-critical-path.sh`
- `tests/test_a063_full_native_launcher.py`
- `tests/test_a063_full_native_capture_runner.py`
- `tests/test_a063_full_native_offline.py`
- `docs/audit/a063-m5-d6-bounded-full-run.md`

Antes de la nueva captura se ejecutó la suite ROM-free completa en una copia
pública aislada: exit 0, 149 tests Node PASS, 176 ejecuciones Python PASS
(incluyen suites históricas repetidas), replay sintético 17/17,
`A063_R2B=ROMFREE_CHECKS_PASS_NOT_NATIVE_NOT_A063_CERTIFIED`.
Se verificó que los hashes del código/tests coincidían con la copia ejecutada.
`git diff --check` PASS y revisión independiente sin bloqueadores.
Estos resultados sintéticos se mantienen separados de la evidencia nativa.

## T2 — captura nueva completa, cuatro frames

Con el código versionado y el árbol versionado limpio, el launcher `--check`
pasó para un volumen nuevo inexistente. Se ejecutó una sola captura nueva:

```bash
bash scripts/a063-full-native-capture.sh --run --frames 4 --volume gng-a063-private-capture-arm64-full-d6-v2
```

No se recortó la captura de 30 frames ni se modificó el gate de boot para
aceptar escrituras sin verificar. La nueva duración se escogió a partir de
contadores agregados RO y sus propios gates decidieron la aceptación.

| Comprobación | Resultado |
| --- | --- |
| Launcher / MAME exit | 0 / 0 |
| Preestados nativos | 17.135 |
| Frames / reset controlado | 4 / 1 |
| Marcadores malformados / errores Lua | 0 / 0 |
| Escrituras sprite | 768, 384 por epoch, cero adicionales |
| Escrituras VRAM observadas | 4.096 |
| Lecturas objetivo | 100 |
| Escrituras del selector observadas | 1 |
| Gate B4 | `MAME_UNMAPPED_POLICY_MATCHES_NATIVE_TAPS_AND_STATIC_LDA` |
| Gate VRAM | `NATIVE_VIDEO_WRITES_MATCH_GENERATED_STATIC_JS` |
| Pre/postflight, fuentes y acción | íntegros |
| MAME coincide con el SHA protegido | true |

La imagen Linux ARM64 es la ya fijada; repositorio, `.git`, ROM y MAME se
montaron RO, con red deshabilitada y captura en volumen propio RW. Los logs
brutos solo se escribieron en el volumen privado. MAME no se recompiló.

## T3 — gates offline sobre la misma corrida

En un contenedor local con ese mismo checkout congelado y volumen D6 v2,
repositorio/ROM/MAME RO y red deshabilitada, se ejecutó una sola vez:

```bash
GNG_R3_MAME_BIN=/mame/mame0289/gnga063 bash scripts/r3-banked-critical-path.sh --full-oracle
```

El workflow terminó en 0; B4 y VRAM se revalidaron en destinos nuevos bajo
`out/r3/full-native-offline/`, sin sobrescribir sus reportes de T2. El log
privado queda en `out/private-runner/offline-d6.log` dentro del volumen.

| Full-oracle y provenance | Resultado |
| --- | --- |
| Comparaciones E nativo ↔ firma ROM autenticada | 17.135 / 17.135 |
| Discrepancias | 0 |
| Epochs explícitas / preestados por epoch | 2 / 389 y 16.746 |
| Selectores y muestras nativas coherentes | true |
| Transiciones post-selector verificadas | 1 |
| Filas de witness privado | 17.135 |
| Roles del manifest SHA256 de la misma corrida | 11, todos revalidados |
| Postflight íntegro después de los gates | true |
| Resultado | `A063_FULL_NATIVE_BANK_PROVENANCE_PASS` |

La comparación cubre todos los preestados, incluidos los que están fuera de
la ventana bancaria; no atribuye bancos por frame ni trata un reset como
escritura del selector. Witness, manifest y módulos generados permanecen
exclusivamente en el volumen privado.

| Static codegen bancario | Resultado |
| --- | --- |
| Muestras en ventana bancaria | 7.434 |
| Pares banco/PC observados / con codegen | 7 / 6 |
| Muestras con / sin codegen | 7.433 / 1 |
| Checkpoints de registros coincidentes | 4.955 |
| Checkpoints divergentes | 0 |
| Muestras con efectos de memoria aún sin verificar por este gate | 2.477 |
| Muestra sin siguiente frontera nativa | 1 |
| Primera divergencia | ausente |
| Full-oracle de la misma corrida verificado | true |
| Resultado | `BANKED_CODEGEN_WITH_NATIVE_CHECKPOINT_PREFIX_ONLY` |

Cada paso comparado parte de un preestado MAME. La ausencia de divergencias
en esos pasos no demuestra un runtime que progrese de forma autónoma.

## Preservación y límites operativos

- D5 histórico y mini-oráculo válido: no se montaron durante este bloque.
- D6 v1: conservado. Su cadena original volvió a pasar en RO usando las
  fuentes `e89e79a`, preservadas para Colima en
  `/Users/matias/.cache/gng-d6/frozen-e89e79a-gijv1yuq`.
- D6 v2: captura de referencia para este cierre; sin retries ni mezcla
  con witness/manifest de otras corridas.
- Binario MAME existente: mismo SHA protegido antes y después de captura y
  gates. `main` no se modificó, no hubo push ni gasto de infraestructura.
- Las anotaciones posteriores a `9cb19f5` solo cambian documentación; no
  cambian el cierre de fuentes de la captura.

Próximo checkpoint: inspección privada y reporte agregado de la cobertura
pendiente de A0.6.4, junto con un contrato ejecutable para IRQ/SYNC y estado
inicial. Después, demostrar ejecución JS/TS continua hasta un primer frame
sin restaurar registros desde el oráculo en cada instrucción.
