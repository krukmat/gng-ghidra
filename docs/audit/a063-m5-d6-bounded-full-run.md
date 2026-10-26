# M5.D6 — corrida full acotada y conservación de la evidencia anterior

Fecha: 2026-10-26. Rama: `feature/a063-r1-forensics-contract`.

Dirección actual: mantener los gates de boot/B4/VRAM intactos y probar una
corrida completa de cuatro frames en un volumen nuevo, después de validar
y versionar la implementación. No recortar trazas ni actualizar los hashes
de la captura anterior para adaptarlos a código nuevo. T3 usará exclusivamente
la misma corrida nueva que supere T2.

Tareas: [handoff D6](a063-m5-d6-full-native-handoff.md).
Entrada: [captura D6 v1 y bloqueo B4](a063-m5-d6-t2-native-checkpoint.md).

## Diagnóstico previo, solo lectura

Sobre la captura `gng-a063-private-capture-arm64-full-d6-v1`, con las fuentes
de captura todavía intactas, se revalidaron postflight, autenticación ROM,
offsets de firma y SHA de la acción. Se ejecutaron únicamente las funciones
puras de parsing y comparación full, sin emitir witness ni manifest:

- 179.924 comparaciones E nativo ↔ firma ROM autenticada; cero discrepancias.
- Dos epochs explícitas, una escritura del selector y una transición
  post-selector verificada.
- Resultado del comparador: `A063_FULL_NATIVE_BANK_PROVENANCE_PASS`.
- El wrapper sigue bloqueado por el contrato de boot; este diagnóstico RO
  no cierra el workflow T3 ni certifica A0.6.4.

Los contadores acumulados en los callbacks de frame permiten elegir una
duración candidata sin exportar PC, registros ni secuencias de banco:

| Callbacks observados | Muestras sprite | Muestras VRAM | Muestras selector | Lecturas objetivo | Resets |
| --- | --- | --- | --- | --- | --- |
| 2 | 768 | 2.197 | 0 | 100 | 1 |
| 4 | 768 | 4.096 | 1 | 100 | 1 |
| 8 | 1.280 | 4.096 | 1 | 100 | 1 |
| 30 | 2.304 | 4.096 | 1 | 100 | 1 |

Esto justifica probar cuatro frames. Los callbacks no atribuyen instrucciones
a frames ni prueban por sí solos una futura captura: el nuevo run debe
superar todos los parsers, contratos y gates con sus propios artefactos.

Una copia de las fuentes públicas del commit de captura `e89e79a` se conserva
en `/private/tmp/gng-d6-frozen-e89e79a-8vhq0w4t`. No contiene ROMs ni trazas.
Permite inspeccionar de nuevo v1 con su evaluador congelado después del cambio
de implementación; v1 y sus manifests privados no se modifican.

## Cambios de implementación

- Launcher: `--frames N` explícito, default 4, entero canónico entre 2 y 30.
  Opciones duplicadas, ausentes o inválidas fallan antes de Docker. El inner
  revalida el valor y lo propaga al probe, manteniendo reset y taps originales.
- El runner full directo usa también cuatro frames por defecto. No se cambia
  el límite 2–30 de Lua ni se omiten instrucciones del run capturado.
- T3 escribe sus nuevas revalidaciones offline en un directorio propio,
  creado una sola vez, para conservar los reportes B4/VRAM que produzca T2.
  Las rutas canónicas del witness, manifest e inputs full se mantienen.
- Tests ROM-free con dobles de argv/env comprueban límites, propagación,
  orden de validación, colisiones y parada ante fallos. No ejecutan Docker
  ni MAME y no contienen ROM.

## Condiciones de ejecución

Antes de la captura: suite completa ROM-free PASS, `git diff --check` PASS,
cambios versionados y launcher `--check` satisfactorio. Nuevo volumen v2;
v1 se conserva. MAME existente, imagen ARM64 fijada, fuentes/ROM/MAME RO,
red deshabilitada y logs brutos solo en volumen privado.

Comando preparado:

```bash
bash scripts/a063-full-native-capture.sh --run --frames 4 --volume gng-a063-private-capture-arm64-full-d6-v2
```

El cambio afecta `SOURCE_FILES`: una nueva captura con preflight nuevo es
necesaria para validar este código, aunque v1 conserve su integridad con las
fuentes antiguas. Nunca se recicla su postflight ni su evidencia bancaria.

## Validación de implementación

Suite completa `a063-r2b-romfree.sh`: exit 0,
`A063_R2B=ROMFREE_CHECKS_PASS_NOT_NATIVE_NOT_A063_CERTIFIED`.
149 tests Node PASS y 176 ejecuciones de tests Python PASS (incluyen suites
históricas repetidas). Los tests nuevos/extendidos incluyen nueve del launcher,
tres del runner full y siete del workflow offline. Revisión independiente de
propagación y preservación sin bloqueadores; `git diff --check` PASS.

Se usó una copia pública aislada en
`/private/tmp/gng-d6-bounded-romfree-1qew86cy`, sin ROM ni evidencia nativa.
Log ROM-free: `/private/tmp/gng-d6-bounded-romfree.log`. Se compararon hashes
de todos los archivos de código y tests con los de la copia ejecutada.

En este checkpoint de implementación, la nueva captura y T3 siguen pendientes.
