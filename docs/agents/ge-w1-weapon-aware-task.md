# GE-W1 — Weapon-Aware Go-Explore (implementación sin certificar)

**Rama:** `feature/ge-w1-weapon-aware-progression` (derivada de `main` en `cee21397f1af97c2922510a14a454d9e357b43ef`).
**Referencia operativa única:** [docs/go-explore/README.md](../go-explore/README.md), en especial §§3, 6, 8 y 10.
**Estado:** lógica implementada; integración con bundle g6 y regresión con artefactos privados **pendientes**. Fase visible 6 **NO** completada.

## Objetivo y alcance

Prevenir el falso avance de la fase visible 6 cuando el juego exige el Shield/Cross: `0x73=3`; el intento observado llevaba `0x73=4` y retrocedió `0x72:5→4` en el frame **45814**. No modificar CPU recompilada, motor, ROM, bundle ni RAM. Solo lectura de RAM y selección/clasificación de entradas P1.

## Tareas

- [x] **T1 — Estado/identidad:** `lookBoss` incorpora `weapon: RAM[0x73]`; en fase RAM 5, `cellKey` diferencia armas sin cambiar las claves antiguas de fases anteriores. El haz incluye `weapon` en deduplicación.
- [x] **T2 — Contrato de progresión:** `src/h3_weapon_policy.mjs` expresa `requiredWeapon=3`, detecta retrocesos y distingue transición futura candidata de final verificado. No bloquear todos los disparos: se requieren para conseguir drops. **Detección exacta de inicio de boss-room no validada.**
- [x] **T3 — Preferencia de arma:** Go-Explore reserva 80% de las selecciones a celdas con escudo cuando existen (20% a alternativas), y pone el escudo primero en `bestRank`. Haz: prioridad lexicográfica por escudo antes de la heurística existente.
- [x] **T4 — Rollback:** `5→4` con arma distinta de 3 se poda como `INVALID_WEAPON_ROLLBACK`, nunca `PHASE_ADVANCED`; otros retrocesos también se podan. Ambos buscadores capturan el arma inmediatamente **antes** de la transición. `replay` puede dar `MATCH` (determinismo) e informa `H3_REPLAY_PHASE_GUARD`; no confundir con aceptación.
- [ ] **T5 — Regresión completa:** tests unitarios del contrato realizados fuera del Mac (3/3 PASS) y pruebas aisladas de código real PASS. **Pendiente** ejecutar suite completa en el repo local y replay del artefacto privado en g6; sin estas pruebas no afirmar integración certificada.

## Evidencia y límites de ejecución

- El árbol remoto `main` no contiene `AGENTS.md`; los `AGENTS.md` existentes solamente en el Mac no son accesibles desde esta sesión. Se deben leer antes de ejecutar en local.
- Comando **ejecutado** en un entorno temporal, sobre el mismo código del módulo puro y su test:
  ```sh
  node --test /mnt/data/ge-w1-work/tests/test_h3_weapon_policy.mjs
  ```
  Resultado: **3 tests / 3 PASS**.
- Validación de sintaxis de los seis archivos modificados mediante parser JavaScript: **6/6 SYNTAX_OK** (validación estática; no ejecución con bundle).
- Ejecución aislada de `src/h3_explore.mjs` con dependencias simuladas: arma 3 y 4 generan claves diferentes; la ruta con escudo tiene prioridad; `phaseOutcome(5,4,4)=INVALID_WEAPON_ROLLBACK`. Selección de 200 celdas con semilla 77: **161** con escudo y **39** alternativas.
- No hubo reproducción de `out/h3/boss/search-p5-45828.json`, de su vídeo, ni prueba end-to-end con bundle g6. No hubo `H3_POKE`, `finalize`, `verify_h3_phase.sh 6`, creación de cinta final ni cambio de `main`.
- Cambios de GitHub: branch + commits sobre ella; archivos actualizados `src/h3_weapon_policy.mjs`, `src/h3_explore.mjs`, `scripts/h3_explore.mjs`, `scripts/h3_boss_search.mjs`, tests y este README. La verificación remota se hizo mediante lecturas de archivos y comprobación de sintaxis, no mediante comandos CLI locales.

## Comandos a ejecutar posteriormente **(NO EJECUTADOS)**

Usar el registrador de §3 para las verificaciones que involucren cintas o bundle. Leer antes todos los AGENTS aplicables.

```sh
cd /Users/matias/gng-ghidra
git fetch origin
git switch feature/ge-w1-weapon-aware-progression
node --test tests/test_h3_weapon_policy.mjs tests/test_h3_explore.mjs
bash scripts/h3_run_logged.sh 6 node scripts/h3_explore.mjs replay out/h3/explore/tape-fase5-completa-36091.json
bash scripts/h3_run_logged.sh 6 node scripts/h3_explore.mjs replay out/h3/boss/search-p5-45828.json
```

**Aceptar T5 solamente cuando:** ambos replays den `MATCH`, el de la candidata reporte `H3_REPLAY_PHASE_GUARD` con `INVALID_WEAPON_ROLLBACK` en 45814 y no se haya alterado ningún prefijo/cinta ni el comportamiento certificado de fases 1–5. La traza causal de la ROM y el pickup legítimo de escudo corresponden a otro bloque; no ejecutarlos dentro de GE-W1.
