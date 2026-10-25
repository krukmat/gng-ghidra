# A0.6.3 / M5.D5 — delimitación del oráculo

**Fecha:** 2026-10-25
**Actualización posterior (25/10/2026):** la recaptura v2 ya se ejecutó y pasó **`A063_ORACLE_MINIPROBE=PASS_SAMPLED_INSTRUCTIONS_ONLY_NOT_FULL_A063`**, con 41.426 preestados, MAME exit=0 y postflight íntegro. La sección de recaptura siguiente es **histórica; NO ejecutar de nuevo**. Continuar en [M5.D6 handoff](a063-m5-d6-full-native-handoff.md). **A0.6.3/A0.6.4 siguen pendientes.**

**Rama:** `feature/a063-r1-forensics-contract`
**Causa:** `CONFIRMED` — falta un separador al final del formato de `tracelog`.
**Error reproducido offline:** `A063_ORACLE_BANK_OUT_OF_RANGE`.
**Estado:** `D5_FIXED_ROMFREE_NOT_NATIVE`; `D5_RECAPTURE_REQUIRED`.
**A0.6.3 / A0.6.4:** `NOT_CERTIFIED`.

## Evidencia real, antes de cambiar fuentes

Se inspeccionó Docker/Colima local con `--network none`, imagen existente
`gng-a063-m5:local`, y montajes de repositorio, MAME y captura de solo lectura.
No se ejecutó MAME, `make` ni `evaluate()`; esta última puede escribir un resultado.
El binario coincidió con el SHA del [handoff original](a063-m5-d5-oracle-out-of-range-handoff.md).
`verify_postflight()` confirmó `A063_POSTFLIGHT_CHAIN_INTACT_NOT_BANK_PROVENANCE`
antes de editar fuentes vinculadas al preflight.

| Contador permitido | Resultado |
|---|---:|
| Preestados / marcadores CPU / marcadores E | 41.426 / 41.426 / 41.426 |
| Tokens E válidos 0..4 | 0 |
| Tokens E inválidos 5..255 | 0 |
| Tokens E inválidos >255 | 41.426 |
| Marcadores ausentes, duplicados o malformados | 0 |
| Histograma de anchuras hexadecimales de E | 6 dígitos: 41.426 |
| Ordinal del primer marcador inválido | 1 |
| Filas con seis dígitos seguidos del delimitador de desensamblado | 41.426 |
| Filas cuyo token completo coincide con banco autenticado de dos dígitos + PC de la misma instrucción de cuatro dígitos | 41.426 |

La autenticación de los cinco bancos y offsets y el parser estricto de fingerprints
pasaron, manteniendo el enlace 1:1 de secuencia, PC, nueve registros y línea física.
La comprobación de concatenación fue un predicado diagnóstico agregado: no produjo
una captura corregida ni alimentó `compare()`. El parser original sigue rechazando
la captura. No se publican valores E, PC, registros, ROM, secuencias ni hashes privados.

## Mecanismo confirmado en MAME 0.289

Se consultó la implementación local del tag `mame0289`, commit
`f34f02505e32c1993c6a782b6814232cbfc74e36`:

1. `scripts/a063_trace_contract.py::build_action()` acababa el formato en
   `E=%02X`, sin separador antes de la comilla de cierre.
2. `src/emu/debug/debugcmd.cpp:717–723`: `execute_tracelog()` formatea y llama
   a `trace_printf("%s", buffer)`, sin añadir espacio ni salto de línea.
3. `src/emu/debug/debugcpu.cpp:2115–2126`: el trazador ejecuta la acción primero
   y escribe inmediatamente `"%s: %s\n"`, empezando por el PC de la instrucción.
   `tracer::vprintf()` (2178–2182) tampoco inserta un separador.
4. Dos dígitos de E y cuatro del PC forman un único token hexadecimal de seis
   dígitos. `parse_driver_entries()` lo interpreta entero y aplica correctamente
   el límite 0..4. `%02X` es anchura mínima, no un recorte.

Esto explica todas las filas observadas y reproduce el error con datos inventados.
En modo sin oráculo, el mismo defecto afecta al último campo `S1`.

**Hipótesis descartadas como causa de este fallo:** el registro de la lambda
capturante selecciona el getter (`express.h:197–200`, `express.cpp:418–421`);
no se convierte en una constante booleana. El getter consulta el banco vivo.
Las doce expresiones más el formato caben en `MAX_COMMAND_PARAMS=128`
(`debugcon.h:26`). El parser no está inventando ni truncando el token.
No se ha demostrado una discrepancia entre índices bancarios válidos.

## Corrección y pruebas ROM-free

Cambio de producción mínimo: un espacio literal al final del formato que emite
`build_action()`, después del último campo tanto en modo oráculo como en modo
legacy. Mantiene una sola acción y una línea por instrucción; conserva las doce
u once expresiones. No cambia el parser, el símbolo C++, los rangos ni los gates.
No requiere recompilar MAME.

`tests/test_a063_oracle_pipeline.py` renderiza el formato real de `build_action()`
con registros y cinco bancos inventados, seguido inmediatamente del PC y texto de
desensamblado sintéticos, en el orden del trazador de MAME. Cubre:

- 375 filas, los cinco bancos y PCs de borde; extracción CPU y ambos parsers reales.
- Modo legacy: `S1` también queda separado del PC.
- Retirar el separador reproduce el rechazo original, sin máscaras ni recuperación.
- Valores E realmente fuera de rango siguen rechazándose aun con separador.

Validación local completada:

```bash
python3 -m unittest discover -s tests -p 'test_a063_oracle_pipeline.py' -v
TMPDIR=/private/tmp bash scripts/a063-r2b-romfree.sh
```

Resultado: integración **9/9 PASS**; gate
`A063_R2B=ROMFREE_CHECKS_PASS_NOT_NATIVE_NOT_A063_CERTIFIED`, con 146 tests Node,
125 ejecuciones de tests Python (incluye suites repetidas por el gate existente)
y replay sintético 17/17. Antes del fix, las nuevas pruebas positivas reprodujeron
`A063_ORACLE_BANK_OUT_OF_RANGE` y, en modo legacy,
`A063_NATIVE_SIGNATURE_EXCEEDS_BYTE`.

El primer intento del gate con el entorno macOS por defecto se detuvo en un test
previo de exportación: comparación entre `/var/...` y su ruta canónica
`/private/var/...`. El gate completo pasó al usar `TMPDIR=/private/tmp`; no se
cambió el test ni se omitió ninguna comprobación. `git diff --check` pasó.

Estos tests son sintéticos: `ROMFREE_PASS` nunca implica `NATIVE_MATCHED`.
Los fixtures anteriores escribían el desensamblado antes de los marcadores y no
ejercitaban esta frontera entre ambas escrituras.

## Recaptura necesaria; recompilación innecesaria

El productor y `a063_trace_contract.py` cambian. Su hash pertenece a
`SOURCE_FILES` y está congelado en el preflight original; ese checkpoint no
certifica el productor corregido. Se conserva como evidencia histórica del fallo.
No se reinterpreta ni reescribe la captura antigua para obtener un PASS.

La próxima ejecución debe usar el mismo binario validado y un **volumen nuevo**,
por ejemplo `gng-a063-private-capture-arm64-delimited-v2`, montado como
`/workspace/out`. Así los runners mantienen sus rutas internas exactas y crean
un preflight nuevo sin tocar `gng-a063-private-capture-arm64-v1`.
El nuevo volumen debe ser inexistente antes de crearlo; una repetición debe
rechazarlo, preservando incluso intentos parciales. Repositorio y MAME se montan
de solo lectura, red desactivada, ROM privada local; logs solo en el volumen nuevo.
El checkout debe estar limpio en archivos versionados para el postflight.

Comando del siguiente checkpoint, **preparado pero no ejecutado**. Ejecutar desde
el checkout raíz una vez commiteados los cambios. Usa el contexto local Colima,
rechaza un volumen v2 ya existente y solo imprime el código agregado de salida.
La captura v1 no se monta. Un fallo conserva v2; no se debe borrar para reintentar.

```bash
bash <<'D5_RECAPTURE'
set -euo pipefail
TASK_ROOT="$(git rev-parse --show-toplevel)"
TASK_VOLUME=gng-a063-private-capture-arm64-delimited-v2
task_docker() { docker --context colima "$@"; }

test "$(git branch --show-current)" = feature/a063-r1-forensics-contract
test -z "$(git status --porcelain --untracked-files=no)"
test -d "$TASK_ROOT/.git"
test -r "$TASK_ROOT/roms/gng.zip"
task_docker info >/dev/null
task_docker image inspect gng-a063-m5:local >/dev/null
task_docker volume inspect gng-a063-mame0289-arm64-v1 >/dev/null
if task_docker volume inspect "$TASK_VOLUME" >/dev/null 2>&1; then
  printf 'D5_RECAPTURE=BLOCKED_NEW_VOLUME_ALREADY_EXISTS\n'
  exit 2
fi
task_docker volume create "$TASK_VOLUME" >/dev/null

task_docker run --rm -i --pull never --network none \
  --platform linux/arm64 --read-only \
  --tmpfs /tmp:rw,nosuid,nodev,size=512m \
  --tmpfs /root:rw,nosuid,nodev,size=64m \
  --mount "type=bind,src=$TASK_ROOT,dst=/workspace,readonly" \
  --mount "type=bind,src=$TASK_ROOT/roms,dst=/workspace/roms,readonly" \
  --mount "type=volume,src=$TASK_VOLUME,dst=/workspace/out" \
  --mount type=volume,src=gng-a063-mame0289-arm64-v1,dst=/mame,readonly \
  --env GNG_R3_MAME_BIN=/mame/mame0289/gnga063 \
  --env GNG_A063_ORACLE_FRAMES=8 \
  --env GNG_R2_PROBE_SOFT_RESET=0 \
  --env GIT_CONFIG_COUNT=1 \
  --env GIT_CONFIG_KEY_0=safe.directory \
  --env GIT_CONFIG_VALUE_0=/workspace \
  --env GIT_OPTIONAL_LOCKS=0 \
  --env PYTHONDONTWRITEBYTECODE=1 \
  --workdir /workspace gng-a063-m5:local bash -s <<'INNER'
set -euo pipefail
umask 077
mkdir /workspace/out/private-runner
exec 3>&1
exec > /workspace/out/private-runner/recapture.log 2>&1
trap 'task_rc=$?; printf "D5_RECAPTURE_EXIT=%d\n" "$task_rc" >&3' EXIT
test ! -e /workspace/out/r3/a063-oracle-smoke
test ! -e /workspace/out/r3/a063-oracle-preflight
test -z "$(git status --porcelain --untracked-files=no)"
test "$(git branch --show-current)" = feature/a063-r1-forensics-contract
python3 - <<'PY'
import hashlib
from pathlib import Path
binary = Path('/mame/mame0289/gnga063')
expected = '80c447cd81fa91be8bf3159e22dedab157798a4f1a189e6680849179b0ac282d'
with binary.open('rb') as stream:
    assert hashlib.file_digest(stream, 'sha256').hexdigest() == expected
PY
xvfb-run -a -e /workspace/out/private-runner/xvfb.log \
  bash scripts/a063-native-oracle-miniprobe.sh
INNER
D5_RECAPTURE
```

`D5_RECAPTURE_EXIT=0` requiere después revisar el resultado privado agregado
`private-a063-oracle-check.json` del volumen v2; no se debe publicar ese archivo.
El comando no reemplaza la revisión de los criterios de aceptación siguientes.

Al terminar se verificó de nuevo, solo lectura, que los siete artefactos originales
y el preflight coincidían con los hashes del postflight congelado y que el binario
no cambió. No se creó un resultado de oráculo sobre la captura antigua.

En esta sesión no se lanzó una captura ni se compiló. Coste adicional: 0 EUR.
Aceptar después únicamente el gate nativo completo del mini-oráculo: todas las
entradas en 0..4, comparación auténtica 1:1, al menos 256 preestados, dos bancos,
un control write y una transición sin reset. Incluso ese PASS no certifica por
sí solo la captura completa A0.6.3 ni A0.6.4.
