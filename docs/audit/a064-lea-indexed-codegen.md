# A0.6.4 — `LEA_INDEXED`: codegen acotado y diagnóstico RO sobre D6 v2

Fecha: 2026-10-26. Rama: `feature/a063-r1-forensics-contract`. Base: `a9cb692`.

Dirección actual: la cobertura de codegen de la ventana bancaria de D6 v2
queda completa como diagnóstico. El siguiente checkpoint es la prueba nativa
de las escrituras en RAM principal, preparada y no ejecutada en
[tarea RAM nativa](../agents/a063-main-ram-native-tap-task.md). Este bloque no
reescribe el [cierre D6](a063-m5-d6-native-closure.md) ni el
[seguimiento RO](a063-post-d6-critical-gaps.md), y no promociona A0.6.4.

## Objetivos y resultados

| Objetivo | Evidencia verificable | Estado |
| --- | --- | --- |
| Modo real de la muestra pendiente | Sonda privada RO: `LEAX`, modo indexado `ZERO` (`,R`), base `U`, no indirecto, 2 bytes dentro de la ventana; su única muestra tiene siguiente preestado secuencial en la misma epoch | Determinado |
| Semántica respaldada | `compileIndexedLea`: LEAX/LEAY/LEAS/LEAU solo con `,R`; resto rechazado | Implementado |
| Tests ROM-free | 5 tests sintéticos nuevos; 4 mutaciones detectadas | PASS sintético |
| Suite integral | 189 tests Node y 176 ejecuciones Python | PASS sintético |
| Mismo witness D6 v2 | 7.434/7.434 muestras con codegen; 7.433 checkpoints coincidentes; 0 divergencias | Diagnóstico RO, sin evidencia nativa nueva |

## Cambio

- `scripts/r3_static_trace_probe.mjs`: nueva `compileIndexedLea(op,postbyte)`.
  `compileAt` la usa para los opcodes LEA después del caso atestiguado
  `LEAY_MINUS_1`, que no cambia. Solo acepta el postbyte no indirecto `,R`
  con base X/Y/U/S. Según el datasheet MC6809, el destino recibe la base;
  LEAX/LEAY cambian solo Z y LEAS/LEAU no cambian flags. `,R` no lee memoria
  ni modifica la base. Siguen rechazados offsets de 5/8/16 bits, `,R+`,
  `,R++`, `,-R`, `,--R`, `A/B/D,R`, relativos a PC, todos los indirectos,
  codificaciones ilegales y cualquier instrucción que cruce `0x6000`.
  El armado de NMI al cargar S no se modela, igual que en `LDS_IMM`.
- `scripts/r3_banked_effect_profile.mjs`: la allowlist admite
  `LEAX/LEAY/LEAS/LEAU_INDEXED`; el perfil exige que no escriban memoria.
- `tests/test_r3_lea_indexed.mjs`, incorporado a `scripts/r3-local-regression.sh`.

`r3_static_trace_probe.mjs` pertenece a `SOURCE_FILES`. El candidato queda
fuera del cierre de fuentes de D6 v2; una captura futura con este código
tendrá un cierre nuevo.

## Pruebas — PASS sintético, no nativo

- Dirigidos: nuevo archivo 5/5. Consumidores de `compileAt` y del perfil,
  incluido `test_r3_static_trace_probe.mjs`, que no está en el runner: 79/79.
- Cubren dirección efectiva, registro destino, Z frente a flags intactos,
  ausencia de efecto lateral, base igual a destino, rechazo exhaustivo de los
  256 postbytes por opcode, entradas inválidas, frontera bancaria y perfil.
- Mutación en copia temporal: Z en LEAS/LEAU, aceptar `,R+`, intercambiar
  U/S y modificar la base fueron detectadas por 2, 2, 5 y 3 tests.
- `TMPDIR=/private/tmp bash scripts/a063-r2b-romfree.sh` en copia pública
  aislada de los 281 archivos versionados más el test nuevo, con ambos
  Dockerfile y sin ROM, `out/`, captura ni MAME: exit 0, 189 tests Node PASS,
  176 ejecuciones Python PASS,
  `A063_R2B=ROMFREE_CHECKS_PASS_NOT_NATIVE_NOT_A063_CERTIFIED`.
  Host: Node v22.23.0, Python 3.15.0, git 2.50.1.

## Diagnóstico RO sobre el mismo witness

Un único contenedor local con la imagen fijada, sin red, rootfs y montajes
RO. Primero se inspeccionan ambos volúmenes: `docker run` crearía un volumen
inexistente. El SHA256 de `/mame/mame0289/gnga063` coincidió con el protegido.

```bash
IMG=sha256:a3bd689f9d867b51cd4a25f01b3dfd8ed0218b53f09347a714271e6cd964c255
docker --context colima run --rm --pull never --network none \
  --platform linux/arm64 --read-only --cap-drop ALL \
  --security-opt no-new-privileges --tmpfs /tmp:rw,nosuid,nodev,size=64m \
  --mount type=bind,src=$HOME/.cache/gng-d6/frozen-9cb19f5-d_8oiz64,dst=/workspace,readonly \
  --mount type=volume,src=gng-a063-private-capture-arm64-full-d6-v2,dst=/workspace/out,readonly,volume-nocopy \
  --mount type=volume,src=gng-a063-mame0289-arm64-v1,dst=/mame,readonly \
  --mount type=bind,src=$PWD/scripts,dst=/candidate/scripts,readonly \
  --mount type=bind,src=$PWD/src,dst=/candidate/src,readonly \
  --env PYTHONDONTWRITEBYTECODE=1 --workdir /workspace "$IMG" bash -c '
    node scripts/r3_d6_followup_diagnostic.mjs --mame-bin /mame/mame0289/gnga063 &&
    node /candidate/scripts/r3_d6_followup_diagnostic.mjs --mame-bin /mame/mame0289/gnga063'
```

- Fase A, autenticación: fuentes congeladas `9cb19f5` más los dos módulos de
  diagnóstico ya archivados. Verifica 11 roles SHA256, `SOURCE_FILES`,
  postflight y binario, y reproduce el resultado anterior.
- Fase B, candidato, proceso separado: mismo cwd y evidencia, módulos desde
  `/candidate/scripts`. El verificador de cadena sigue siendo el congelado;
  `SOURCE_FILES` no se reemplaza y el árbol congelado no cambió.

| Partición de muestras bancarias | Fase A congelada | Fase B candidato |
| --- | ---: | ---: |
| Roles SHA256 / cadena congelada | 11 / true | 11 / true |
| Muestras en ventana bancaria | 7.434 | 7.434 |
| Pares banco/PC con codegen | 6 de 7 | 7 de 7 |
| Con / sin codegen | 7.433 / 1 | 7.434 / 0 |
| Checkpoints de registros coincidentes | 7.432 | 7.433 |
| Checkpoints divergentes | 0 | 0 |
| Sin siguiente preestado | 1 | 1 |
| Fronteras de reset omitidas | 0 | 0 |
| `LEAX_INDEXED` ejecutadas / coincidentes / escrituras | familia ausente; 1 muestra `UNSUPPORTED_BANKED_OPCODE` | 1 / 1 / 0 |
| Escrituras byte predichas en `MAIN_RAM` | 2.477 | 2.477 |
| Escrituras certificadas contra taps nativos | 0 | 0 |

Se cumple `7.433 + 1 + 0 = 7.434`. Ambas fases conservan
`D6_FOLLOWUP_DIAGNOSTIC_ONLY_NOT_NATIVE_EFFECT_PROOF` y
`BANKED_EFFECT_PROFILE_PREDICTED_WRITES_ONLY`; las banderas de escrituras
nativas, bus, IRQ/SYNC, runtime autónomo y juego siguen en false.
SHA256 del candidato evaluado:

- `scripts/r3_static_trace_probe.mjs`: `b828517313f104faa4f081f5331a03c272760f431157f767534d6f7fce323cac`
- `scripts/r3_banked_effect_profile.mjs`: `a9a57c0430129f4cdb2e4ee3ae372f1d9bff757067589074377a348e9a0c8d67`
- `scripts/r3_d6_followup_diagnostic.mjs`: `0a70f2610eb4d57f41f11f17e005c0c843f461afd693d4069de59a803f6ebe83`

## Límites

- Evidencia nativa: solo la corrida D6 v2 original. La fase B es un
  diagnóstico del código candidato sobre esos preestados, no una captura.
- La muestra LEA, como las demás, parte de su propio preestado MAME. No hay
  ejecución encadenada ni autónoma.
- No se ejecutó `r3-banked-critical-path.sh`, porque escribe en el volumen.
  Sus reportes originales, incluido
  `BANKED_CODEGEN_WITH_NATIVE_CHECKPOINT_PREFIX_ONLY`, siguen vigentes.
- `compileAt` también sirve a ROM fija. Un LEA `,R` de ROM fija pasaría a ser
  compilable; perfil A0 y gates de ROM fija no se reevaluaron.
- Sin certificar: stores en RAM principal, IRQ/SYNC/VBlank, estado inicial,
  ejecución continua, primer frame y juego jugable.

## Preservación

`main`, D5, D6 v1 y D6 v2 intactos; D6 v2 y MAME montados solo RO. Sin MAME,
captura, rebuild, red ni escritura en volúmenes. Sondas y lanzadores privados
quedaron fuera del repositorio. Solo se exportaron nombres de familia/modo,
estados, contadores y booleanos.

## Siguiente checkpoint

[Prueba nativa de RAM principal](../agents/a063-main-ram-native-tap-task.md):
contrato y gate ROM-free primero; después, autorización explícita del
operador para una única captura nueva en un volumen nuevo.
