# T5 — Checkpoint de regresión real (24/10/2026)

## Resultado

**Estado global: `BLOCKED_MISSING_CHECKOUT` — no `PASS_ROM_FREE_ONLY`.** El repositorio `krukmat/gng-ghidra` es privado. La conexión GitHub permite leer/publicar archivos, pero la terminal ejecutora no tiene acceso de red/credenciales de clonación; `git ls-remote https://github.com/krukmat/gng-ghidra.git HEAD` falla por DNS. No se cambia la visibilidad, no se usan GitHub Actions, no se utilizan ROM privadas y no se ejecuta MAME.

## Tasks T5

| Task | Estado | Evidencia |
|---|---|---|
| T5.1 — Checkout ejecutable | **BLOCKED_MISSING_CHECKOUT** | `scripts/r42_t5_preflight.py` ejecutado en Python 3.13.5 con Node v22.16.0, exit 2 y siete archivos mínimos ausentes en el entorno aislado; sin .git, sin HEAD clonable. |
| T5.2 — Suite Python controlador (12 tests T4) | **BLOCKED por T5.1** | No se ejecutan los doce tests sin importar su módulo real. **Alternativa ejecutada:** cinco nuevos tests **reales** `tests/test_r42_t5_preflight.py` PASSED (0.006 s): checkout ausente, manifest presente, HEAD incorrecto, Node ausente y fichero del runner faltante. `python3 -m py_compile` de ambos ficheros nuevo PASS. Git blob SHAs comprobados: `7d21592bfe0bb3ed65e0df0fd2e65888f4ee23f3` (script) y `405a9d9951d251f9eed70d917e2044af5d2e6e8e` (tests). |
| T5.3 — Node G/H SHA-256 real | **BLOCKED por T5.1** | No se ha ejecutado `node --test` del repositorio desde un checkout integral. |
| T5.4 — Regresión integral / escala | **BLOCKED por T5.1** | No se ha ejecutado `bash scripts/r3-local-regression.sh` ni la escala 5k/40.001/100k completa de Node. |
| T5.5 — Corrección y checkpoint | **COMPLETADA como diagnóstico, no como certificación** | Preflight ROM-free agregado al runner, cinco pruebas, clasificación fail-closed y este checkpoint. No se inventan fallos de producto ni se declara PASS. |

## Nuevo preflight autónomo

`scripts/r42_t5_preflight.py` verifica: presencia de Git/HEAD, ruta de archivos referenciados por el runner, Node (>=18), Python (>=3.10), HEAD opcional y ausencia de ROM/MAME como dependencia. Sus estados son `BLOCKED_MISSING_CHECKOUT`, `BLOCKED_RUNTIME`, `BLOCKED_HEAD_MISMATCH` o `READY_TO_ATTEMPT_REGRESSION`. Este último **no** equivale a regresión exitosa.

Cuando exista un checkout legítimo, los comandos para cerrar el gate son:

```bash
python3 scripts/r42_t5_preflight.py
python3 -m unittest discover -s tests -p 'test_r42_t5_preflight.py' -v
python3 scripts/r42_validation_closure.py
```

El controlador T1–T3 genera exclusivamente `out/r3/r42-validation-closure.json`. Solo un resultado `PASS_ROM_FREE_ONLY` con tests Node reales y regresión completa puede cerrar la parte ROM-free. El preflight y las pruebas solo preparan y clasifican ese intento.

## Independencia de la validación externa

Se mantienen fuera de T5 los gates MAME Lua F, estado pre-taps G, A0.6.3/identidad bancaria e IRQ/SYNC/frame auténtico. **La limitación actual de T5 es el acceso al checkout**, no la presencia de esas evidencias nativas.

**Decisión:** congelar expansión de tests sintéticos. No crear tareas funcionales sucesivas por falta de checkout; mantener el gate real en estado bloqueado hasta contar con entorno apto.
