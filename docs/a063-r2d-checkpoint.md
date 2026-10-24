# R2.D — Checkpoint de ejecución sin Mac

Fecha: 2026-10-24. Rama exclusiva: `feature/a063-r1-forensics-contract`.
**Decisión: `R2D_BLOCKED_EXTERNAL_EXECUTION`**. No confundir con PASS global
ni con `ROM_FREE_READY`.

## R2.D1–D7: ejecución y evidencia

| Task | Progreso de preparación | Evidencia observada | Estado |
|---|---:|---|---|
| D1 — Gate robusto | 100% | `bash -n` PASS; `--mame-source` inexistente rechazo exit 2; mock de orquestación 3/3 PASS (ELF válido sintético, símbolo ausente y ejecutable antiguo). Prevalece `BLOCKED` en los negativos. | PASS_ORCHESTRATOR_MOCK |
| D2 — Host Linux reproducible | 100% | `scripts/a063-r2d-linux-preflight.sh` ejecutado: Python 3.13.5, Node 22.16, GCC 14.2; smoke real C++20 de getter dinámico 5 entradas PASS; mínimo 8 GiB libres. Blob Git del preflight local = `2ab4250bbd4606b4b99271d9b67a856bcb9de18c` (idéntico al publicado). | PASS_BASIC_TOOLCHAIN_NOT_MAME |
| D3 — Checkout privado | 20% | Árbol remoto íntegro listado por GitHub (204 entradas / 1.438.251 bytes de blobs); `git ls-remote` falla con `Could not resolve host: github.com`; `curl api.github.com` también falla. El conector GitHub permite leer/escribir rama, **no** ejecutar procesos remotos ni clonar mediante el contenedor. | BLOCKED_NETWORK_AND_REMOTE_EXECUTION |
| D4 — Regresión integral | 50% | Reejecución en espejo parcial: `32/32` tests A063 PASS; replay `17/17` PASS sintético, con 5 bancos/375 prestates; pipeline Node/Python del checkout íntegro NO ejecutado; test nuevo `test_a063_oracle_pipeline.py` aún pendiente de ejecutar en checkout auténtico. | PARTIAL_ISOLATED_PASS |
| D5 — MAME 0.289 real | 65% preparación, 0% build real | Código oficial `mame0289` auditado; nuevo gate comprueba tag **y commit** `f34f02505e32c1993c6a782b6814232cbfc74e36` del tag anotado, parche exacto, ejecutable ELF generado en build reciente, `-version`, driver `gngb` y cadena `gng_a063_bank`; NO se ha compilado MAME completo. | BUILD_BLOCKED_FULL_SOURCE_UNAVAILABLE |
| D6 — Auditoría de evidencias | 100% de lo disponible | Captura única por `mktemp` fuera del checkout con permisos 700; registro de commits, logs, versión y SHA-256. Mock 3/3 confirmó que los fallos no producen `ROM_FREE_READY`. Sin evidencias de MAME real. | PASS_AVAILABLE_EVIDENCE_ONLY |
| D7 — Checkpoint | 100% emitido | Este documento declara de forma explícita el bloqueo y define condición falsable de salida. | BLOCKED, DOCUMENTED |

**Certeza subjetiva de desbloqueo A0.6.3: 85%**, sin elevar a 90%:
no hay regresión completa ni compilación real y, menos aún, ejecución
nativa con ROM privada. Las pruebas con mocks NO aumentan la certeza de
comportamiento real de MAME.

## Cambios ya versionados

- `scripts/a063-r2c-linux-gate.sh`: SHA fijo del commit upstream
  `mame0289` más comprobación de tag, árbol limpio, ejecución real de
  `make SUBTARGET=gnga063 SOURCES=src/mame/capcom/gng.cpp REGENIE=1`,
  control ELF, `-version`, `-listfull gngb`, cadena `gng_a063_bank`, antigüedad de binario,
  SHA-256 y logs. Se corrigieron dos posibilidades de falsos negativos
  `SIGPIPE` bajo `set -o pipefail`.
- `scripts/a063-r2d-linux-preflight.sh`: prueba independiente reproducible
  de Python, Node, herramientas Unix, espacio y compilación C++20.
- La regresión R2.C existente incorpora `tests/test_a063_oracle_pipeline.py`,
  pero los resultados de ese test NO están attestados aún sobre checkout completo.

## Ejecución necesaria en Linux autorizado

Sin GitHub Actions, sin ROM y sin tocar `main`. El host debe poder
clonar el repositorio privado mediante credenciales del usuario,
almacenadas fuera de scripts y logs. Entorno recomendado: instancia Linux
temporal con dependencias de compilación MAME y espacio suficiente.

```bash
git clone --branch feature/a063-r1-forensics-contract \
  git@github.com:krukmat/gng-ghidra.git
git clone --branch mame0289 --depth 1 \
  https://github.com/mamedev/mame.git mame0289
cd gng-ghidra
bash scripts/a063-r2d-linux-preflight.sh
bash scripts/a063-r2c-linux-gate.sh \
  --mame-source ../mame0289 --jobs 2
```

Es necesario que el repositorio MAME esté preparado con las bibliotecas de
desarrollo que exige su build en esa distribución. El preflight comprueba
herramientas y C++20, **no** que todas las dependencias MAME estén instaladas.

## Condiciones de salida

1. El clone de gng-ghidra coincide con la rama y está limpio;
   `bash scripts/a063-r2b-romfree.sh` termina con ambos marcadores de
   PASS y la regresión Python/Node completa PASS.
2. `scripts/a063_oracle_replay.py` confirma `17/17` en ese checkout.
3. El árbol MAME auténtico corresponde al commit upstream fijado, el
   parche aplica limpiamente y la compilación real sale con código cero.
4. Se obtiene un ELF de MAME 0.289 fresco con driver `gngb` y símbolo
   `gng_a063_bank`; se generan manifiesto SHA-256 y logs comprobables.
5. **Solo entonces:** `R2C_ROM_FREE_READY_NOT_NATIVE`. La ROM privada,
   la captura nativa `R2.A5` y la validación integral A0.6.3 siguen
   siendo posteriores.

Privacidad: no se han publicado ROM, instrucciones reales, trazas de CPU,
secretos ni credenciales; no se usaron GitHub Actions; no se modificó
`main` ni se hizo merge.
