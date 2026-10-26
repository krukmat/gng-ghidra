# V3.B2-B — De Coin1 a Start por AOT, sin intérprete

Fecha: 2026-10-26 · rama `main`.

## Resultado previo B2-A — PASS (operador Mac)

```text
GNG_LOCAL_REGRESSION=PASS_ROM_FREE_A0_2_TO_A0_6_3
GNG_LOCAL_REGRESSION=PASS_ROM_FREE_R3_R42H
V3_B2A_WIRING=PASS_ROM_FREE_AOT_CYCLE_ACCURATE
V3_B2A_BUILD=PASS_PRIVATE_AOT_NO_ORACLE
V3_B2A_BLOCKS=354
V3_B2A_NO_INPUT=PASS_600_FRAMES_EQUAL_V2
V3_B2A_COIN_STATUS=INPUT_ROUTE_UNCOMPILED
V3_B2A_COIN_SYSTEM_READS=183
V3_B2A_COIN_ACTIVE_READS=2
V3_B2A_COIN_FIRST_CHANGED_FRAME=421
V3_B2A_COIN_FRAMES=492
V3_B2A_INPUT_CPU_PATH=PASS_REAL_COMPILED_GNG_REACTION
V3_B2A_LOCAL=PASS
```

El programa original **observa Coin1**, cambia estado desde frame
421 y alcanza una ruta nueva `UNCOMPILED` alrededor de frame 492.
No implica crédito registrado, partida iniciada ni Arthur controlable;
demuestra causalidad de entrada y necesidad de ampliar AOT.

## Alcance del bloque B2-B

**B2-B.T1 — Tape de interacción.** `src/v3_b2b_tape.mjs`
versiona y hashea secuencias absolutas de 1000 frames:
`coin` (420–422), `start` (530–532) y
`controls` (además derecha, botón1, izquierda, botón2 entre 650–752).
`tests/test_v3_b2b_tape.mjs` es ROM-free.
Los botones representan tentativamente ataque/salto, según driver
gngb; su efecto de gameplay se certificará aparte.

**B2-B.T2 — Descubrimiento *offline*.**
`scripts/v3_b2b_discover.mjs` arranca desde la imagen privada y
los 354 bloques certificados en `out/v3/b2a/frozen`.
Incorpora el banco/PC faltante desde `coin-smoke.json`, compila
sólo durante **build**, reinicia en frío y expande hasta
`FRAMES_DONE` o 48 iteraciones. Si encuentra RAM ejecutable
adicional, busca su origen único en el código ROM verificado;
si no es único, bloquea la operación.

**B2-B.T3 — Congelar + regresión V2.** Solo tras completar
el tape: bundle privado independiente `out/v3/b2b/frozen/`.
Debe reproducir exactamente los primeros 600 frames y eventos
de V2 sin entradas, mantener congruencia del nuevo programa
AOT y repetir 1000 frames dos veces en frío con resultado igual.

**B2-B.T4 — Comprobar valor de producto.** Contrastar
`coin`, `start` y `controls` bajo el mismo artefacto:
primera diferencia `coin → start`, primera diferencia
`start → controles` y lecturas activas SYSTEM/P1.
Una lectura activa sin cambio de estado no se declara
jugabilidad. Ni siquiera diferencia entre tapes implica
equivalencia con MAME: esa prueba pertenece a V3.B1.T4.

**B2-B.T5 — Gate local.**
```bash
git switch main
git pull --ff-only
bash scripts/v3_b2b_local.sh
```

Marcadores de éxito esperados si GnG realmente cubre todas
las rutas y responde a Start:
- `V3_B2B_NO_INPUT=PASS_600_FRAMES_IDENTICAL_V2`
- `V3_B2B_REPLAY=PASS_TWO_FROZEN_1000_FRAME_RUNS`
- `V3_B2B_DISCOVERY=PASS_1000_FRAMES_AOT_OFFLINE`
- `V3_B2B_COIN_START=PASS_CAUSAL_INPUT_EFFECT_NOT_NATIVE_CERTIFIED`
- `V3_B2B_LOCAL=PASS`

Si se detiene, **conservar `out/v3/b2b/`**:
`discovery-report.json` guarda causas/bancos/PC/semillas
privadas, y la salida de consola solo muestra estado/cobertura.
No borrar automáticamente ni repetir el build sobre el mismo
`frozen/`; no subir esos datos a GitHub.

## Dependencias de siguiente bloque

Si Start ya modifica la partida, abordar primero el diferencial
MAME para `Coin → Start`. Si quedan bloques `UNCOMPILED`,
completar su descubrimiento en build antes de intentar un control
visual de Arthur. Descartar optimizaciones visuales irrelevantes
hasta poder demostrar movimiento/salto causado por CPU.

## B2-B.Foundation — Compatibilidad de semillas históricas (26/10/2026)

El Mac reportó:
`V3_B2B_DISCOVERY=BLOCKED_FOUNDATION_SEEDS_INVALID`.
El bloqueo ocurre **antes** de entrar en el bucle de expansión AOT.

El origen es una divergencia contractual: el builder original
`scripts/v3_b2a_build.mjs` acepta semillas con `pc` entero
y `bank`/`overlay` válidos, incluso si un bloque es inerte
o metadatos históricos no afectan el PC. El nuevo B2-B aplicaba
`seedOK` para **nuevos targets** al conjunto histórico entero.

Corrección: `src/v3_b2b_foundation.mjs` reproduce el validador
de entrada original, sin alterar el fichero de semillas. Recompila
el grafo B2A con los mismos bytes privados, reset vectors y
compilador; compara tanto el número de bloques como el SHA-256
**exacto** de `program.mjs` después de su import rewrite contra
el manifiesto del paquete privado verificado.
Cualquier deriva real debe fallar con
`V3_B2B_FOUNDATION_AOT_MISMATCH`, nunca silenciarse.
La validación estricta de **nuevas** direcciones sigue intacta
en `seedOK`.

El gate esperado es
`V3_B2B_FOUNDATION=PASS_EXACT_FROZEN_AOT`, antes de empezar
`V3_B2B_DISCOVERY_ITERATION`. Se incluyen seis fixtures ROM-free
de semillas históricas, metadatos inertes, drift y falsificaciones.
**No se ha ejecutado todavía la regresión Mac ni el build privado.**

## B2-B.Resume — Checkpoint 48 conservado (26/10/2026)

Resultado Mac:
```text
V3_B2B_FOUNDATION=PASS_EXACT_FROZEN_AOT
V3_B2B_FOUNDATION_BLOCKS=354
V3_B2B_FOUNDATION_SEEDS=49
V3_B2B_DISCOVERY_ITERATION=48
V3_B2B_DISCOVERY_BLOCKS=621
V3_B2B_DISCOVERY_FRAMES=892
V3_B2B_DISCOVERY=BLOCKED_ITERATION_LIMIT
```

**Evidencia:** avance auténtico de 354 a 621 bloques (+267);
892 frames de la secuencia Coin/Start/controles. El límite
de 48 iteraciones es administrativo, no un fallo de MC6809.
No declarar juego completo ni aprobación de Start únicamente
porque el CPU alcance frame 892.

**Cambio operativo:** `bash scripts/v3_b2b_local.sh` reconoce
`out/v3/b2b/discovery-report.json` y llama a `--resume`.
El checkpoint se valida fail-closed: esquema, perfil/hashes de tape,
semillas históricas exactas, primera ruta B2-A, 48 targets únicos,
último `UNCOMPILED`, count de bloques reproducible al excluir
la última seed aún no compilada, overlays verificables. Compilar
una vez el conjunto recuperado no significa repetir las 48
ejecuciones previas; la primera nueva corrida es **iteración 49**.
Límite por tanda nueva: **64 iteraciones adicionales**. Si
persiste `UNCOMPILED`, el siguiente `--resume` continúa donde
se guardó sin recomenzar. No se aumentó la duración del runtime
ni se añadió intérprete.

Los informes previos se archivan antes de promover la nueva
versión en `out/v3/b2b/history/discovery-iteration-N.json`.
Los nuevos overlays descubiertos se guardan únicamente en
el reporte privado como bytes necesarios para reconstruirlos.
Los reportes viejos que mencionen overlays adicionales **sin
sus bytes** fallan expresamente con
`V3_B2B_RESUME_OVERLAY_PROVENANCE_MISSING`, en vez de
inventar o sobrescribir ROM.

**Gates locales:** `V3_B2B_RESUME=PASS_ATTESTED_CHECKPOINT`,
`V3_B2B_RESUME_FROM_ITERATION=48` y
`V3_B2B_DISCOVERY_ITERATION=49`. Luego alcanzar
`FRAMES_DONE`, pasar verificación frozen y gates
Coin/Start, o conservar otro checkpoint para la próxima tanda.

## Cierre de seguridad adicional: bundles verdaderamente ejecutables

Al completar los 1000 frames del tape `controls`, el proceso
también ejecuta por separado las rutas de `coin` y `start`
sobre el mismo AOT. Si alguna encuentra `UNCOMPILED` o
`RAM_CODE_UNMAPPED`, incorpora su destino a la siguiente
ronda de **compilación offline**; no promueve el paquete ni
simula la partida.

La salida publica `V3_B2B_DISCOVERY_MISSING_PROFILE` y
`V3_B2B_DISCOVERY_PROFILE_FRAMES` cuando corresponda.
El paquete `frozen` se construye provisionalmente bajo
`out/v3/b2b/work-*/candidate-frozen/` y solo se mueve
a `out/v3/b2b/frozen/` tras comprobar no-input parity V2,
replay determinista de 1000 frames y rutas independientes
Coin/Start. Todos estos resultados usan CPU MC6809 AOT real.
