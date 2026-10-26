# R3.5.B2.T4 — preflight de fuente MAME existente (sin captura)

Fecha: 2026-10-26; rama `feature/a063-r1-forensics-contract`.

**Objetivo acotado:** obtener evidencia de la señal que despierta
`SYNC` en `0x6016`, para continuar la ejecución recompilada JS/TS
desde `0x6017`. Sin una nueva investigación de MAIN_RAM.

## T4.1 — Comprobación RO en Mac

En el checkout feature actualizado:

```bash
git pull --ff-only
bash scripts/r35-t4-source-preflight.sh
```

El preflight inspecciona Colima Linux ARM64, imagen ya fijada, el volumen
`gng-a063-mame0289-arm64-v1` montado **solo lectura**, el checkout público
MAME `mame0289` en el commit
`f34f02505e32c1993c6a782b6814232cbfc74e36`, la aplicación exacta
del parche bancario existente y el SHA del ejecutable protegido. Solo monta
`scripts/` y `patches/` RO, **no** ROM, `out/` ni capturas.
No crea nuevos volúmenes, checkout, compilación, logs nativos ni imagen.

Salida esperada si hay fuente cacheada:

```text
R35_T4_SOURCE=PASS_CACHED_MAME0289_PATCHED_RO
R35_T4_INSTRUMENTED_BINARY=NOT_BUILT
R35_T4_NATIVE_EVIDENCE=NOT_CAPTURED
```

Un resultado `BLOCKED_...` identifica un prerrequisito faltante.
No usar el volumen MAME original como destino de parches o build.

## T4.2 — Requisitos mínimos del build aislado

Después del PASS del preflight: copiar/clonar la fuente pública a un
**workspace MAME independiente** sin reutilizar el volumen original en RW;
generar el overlay ya implementado con
`scripts/r3_prepare_native_mame_hook.py`; comprobar que los anchors coinciden;
aplicar al workspace aislado y compilar ahí un ejecutable distintivo.
Registrar SHA, commit, origen del parche y arquitectura.

El binario bancario original no se modifica. **T4.2 no está ejecutada**;
requiere acceso a Docker/Colima en el Mac. No lanzar el wrapper legacy sobre
un checkout con `out/r2/mame-probe` existente.

## T4.3 — Gate de captura separado

El wrapper `scripts/r3-native-irq-verify.sh` exige
`GNG_R35_NATIVE_T4_APPROVED=EXPLICIT_OPERATOR_B2_T4`, checkout aislado y
destinos vacíos antes de una corrida. El parser existente reportará correlación
de `SYNC_ENTER`, `LINE_DELIVERED`, `SYNC_EXIT` y reset por epoch.
No subir logs privados, ROM, registros, direcciones ni datos del binario.

## T4.4 — Decisión funcional

PASS nativo implica observación de la señal de salida, no equivalencia JS
automática ni demostración de fuente VBlank. El gate hacia el primer frame
requiere conectar la reanudación a un runtime JS/TS continuo, sin reinyectar
preestados desde MAME en cada instrucción.

**Estado validado por operador (26/10/2026):**
`R35_T4_SOURCE=PASS_CACHED_MAME0289_PATCHED_RO`,
`R35_T4_INSTRUMENTED_BINARY=NOT_BUILT` y
`R35_T4_NATIVE_EVIDENCE=NOT_CAPTURED`.
T4.1 PASS. T4.2 tiene scripts y pruebas de preparación/build aislado
publicados ([checkpoint](r35-b2-t4-build-2026-10-26.md)), pero todavía
no se han ejecutado en el Mac. T4.3/T4.4 siguen pendientes.
