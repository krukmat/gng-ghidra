# GE-W1 — Weapon-Aware Go-Explore (auditado en g6)

**Rama:** `feature/ge-w1-weapon-aware-progression` (derivada de `main` en `cee21397f1af97c2922510a14a454d9e357b43ef`).
**Referencia operativa única:** [docs/go-explore/README.md](../go-explore/README.md), en especial §§3, 6, 8 y 10.
**Estado:** T1–T5 completadas; integración y regresión local con bundle g6 **PASS**. Fase visible 6 **NO** completada.

## Objetivo y alcance

Prevenir el falso avance de la fase visible 6 cuando el juego exige el Shield/Cross: `0x73=3`; el intento observado llevaba `0x73=4` y retrocedió `0x72:5→4` en el frame **45814**. No modificar CPU recompilada, motor, ROM, bundle ni RAM. Solo lectura de RAM y selección/clasificación de entradas P1.

## Tareas

- [x] **T1 — Estado/identidad:** `lookBoss` incorpora `weapon: RAM[0x73]`; en fase RAM 5, `cellKey` diferencia armas sin cambiar las claves antiguas de fases anteriores. El haz incluye `weapon` en deduplicación.
- [x] **T2 — Contrato de progresión:** `src/h3_weapon_policy.mjs` expresa `requiredWeapon=3`, detecta retrocesos y distingue transición futura candidata de final verificado. No bloquear todos los disparos: se requieren para conseguir drops. **Detección exacta de inicio de boss-room no validada.**
- [x] **T3 — Preferencia de arma:** Go-Explore reserva 80% de las selecciones a celdas con escudo cuando existen (20% a alternativas), y pone el escudo primero en `bestRank`. Haz: prioridad lexicográfica por escudo antes de la heurística existente.
- [x] **T4 — Rollback:** `5→4` con arma distinta de 3 se poda como `INVALID_WEAPON_ROLLBACK`, nunca `PHASE_ADVANCED`; otros retrocesos también se podan. Ambos buscadores capturan el arma inmediatamente **antes** de la transición. `replay` puede dar `MATCH` (determinismo) e informa `H3_REPLAY_PHASE_GUARD`; no confundir con aceptación.
- [x] **T5 — Regresión completa:** tests dirigidos **13/13 PASS**, suite H3 completa **25/25 PASS**, sintaxis de los cuatro módulos ejecutables **PASS** y los dos replays privados en g6 **MATCH**. La candidata informa `H3_REPLAY_PHASE_GUARD` con `frame=45814`, `from=5`, `to=4`, `weaponAtExit=4` y `outcome=INVALID_WEAPON_ROLLBACK`.

## Evidencia local y límites de ejecución

- El 2026-11-02 se ejecutó en el Mac la suite dirigida (`tests/test_h3_weapon_policy.mjs` + `tests/test_h3_explore.mjs`): **13/13 PASS**. La suite `tests/test_h3_*.mjs`: **25/25 PASS**.
- `node --check` pasó para `scripts/h3_explore.mjs`, `scripts/h3_boss_search.mjs`, `src/h3_explore.mjs` y `src/h3_weapon_policy.mjs`.
- Semilla `out/h3/explore/tape-fase5-completa-36091.json`: `MATCH gen=g6`, cinta `0c3d5e95…`, RAM `18190b0a…`, fase 5 en 36091.
- Candidata `out/h3/boss/search-p5-45828.json`: `MATCH gen=g6`, cinta `67dc51dd…`, RAM `3a37d201…`; guard exacto `45814: 5→4`, arma previa 4, `INVALID_WEAPON_ROLLBACK`.
- La auditoría del delta no encontró un defecto funcional que exigiera cambiar la implementación. La lógica permanece limitada a lectura de RAM y clasificación/selección de entradas.
- No hubo `H3_POKE`, búsquedas nuevas, `finalize`, `verify_h3_phase.sh 6`, creación de cinta final ni modificación de motor, ROM, AOT o bundle. El vídeo diagnóstico no se regeneró; no forma parte del gate T5.
- Todos los comandos de prueba, sintaxis y replay quedaron registrados en `out/h3/phase6/commands.log` (privado, modo `0600`).

## Comandos de aceptación ejecutados

Usar el registrador de §3 para las verificaciones que involucren cintas o bundle. Leer antes todos los AGENTS aplicables.

```sh
bash scripts/h3_run_logged.sh 6 node scripts/h3_explore.mjs replay out/h3/explore/tape-fase5-completa-36091.json
bash scripts/h3_run_logged.sh 6 node scripts/h3_explore.mjs replay out/h3/boss/search-p5-45828.json
bash scripts/h3_run_logged.sh 6 node --test tests/test_h3_weapon_policy.mjs tests/test_h3_explore.mjs
bash scripts/h3_run_logged.sh 6 node --test tests/test_h3_*.mjs
```

**T5 aceptada:** ambos replays dieron `MATCH`; la candidata reportó `H3_REPLAY_PHASE_GUARD` con `INVALID_WEAPON_ROLLBACK` en 45814. Los replays son desde reset y no alteran prefijos ni cintas; la semilla completa hasta RAM fase 5 conserva sus hashes certificados. La traza causal de la ROM y el pickup legítimo de escudo corresponden a otro bloque y no se ejecutaron dentro de GE-W1.
