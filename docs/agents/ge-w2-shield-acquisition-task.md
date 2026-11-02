# GE-W2 — obtener Shield/Cross legítimamente (fase visible 6)

**Estado:** código implementado; pruebas privadas y búsqueda real PENDIENTES.
**Rama:** `feature/ge-w2-shield-acquisition`, desde GE-W1 certificado en `bdda3bca114847b0dd42bb7874bc34424e0f0893`.
**Referencia operativa única:** `docs/go-explore/README.md` §§3, 5–8 y GE-W2.

## Objetivo

Encontrar una secuencia reproducible **solo P1** en el bundle g6 que obtenga el Shield/Cross (`RAM[0x73]=3`) **antes de los dos jefes de la fase visible 6**. Mantener `RAM[0x72]=5` al obtenerlo. No confundir la obtención del arma con terminar fase 6, alcanzar una sala final o iniciar un segundo ciclo.

## Tasks y dependencias

- [x] **T1 — Auditoría read-only:** `scripts/h3_weapon_probe.mjs` recorre desde reset una cinta existente y registra todo cambio de arma y fase desde el frame indicado; valida RAM SHA y rechaza `H3_POKE`.
- [x] **T2 — Objetivo de adquisición:** `H3_GOAL=weapon` en `h3_explore.mjs` detiene en fase RAM 5 + arma 3; genera cinta de solo entradas y checkpoint verificable. No altera el objetivo histórico predeterminado ni los criterios de fase final.
- [x] **T3 — Tests puros:** `tests/test_h3_weapon_goal.mjs` prueba objetivos, rechazo de semillas inválidas, distinción entre pickup y transición de fase y eventos de arma. Validación preliminar de sintaxis y comportamiento puro fuera del bundle: PASS (no equivale a g6).
- [ ] **T4 — Reproducir la candidata privada:** auditar `search-p5-45828.json` desde frame 36091; registrar cambios de arma, vídeo y RAM; replay `MATCH` y `ramVerified=true`. Si no hay pickup, documentar `NOT_OBSERVED`, no deducir la ubicación.
- [ ] **T5 — Buscar escudo legítimo:** desde `tape-fase5-completa-36091.json`, ejecutar búsqueda acotada con `H3_GOAL=weapon`, sin pokes. Registrar `GO_WEAPON_ACQUIRED` o `NOT_REACHED`. Si se obtiene, replay `MATCH`, comprobación `RAM[0x73]=3`, hashes y vídeo/sprites del pickup. Si no, conservar el mejor checkpoint y explicar opciones de exploración.
- [ ] **T6 — Continuación condicionada:** solo con arma obtenida, reiniciar exploración desde la nueva cinta y verificar si la sala final es accesible. No crear `tape-fase6-completa` ni `fase6.{mp4,json}` sin su gate. No asumir una fase 7.

## Comandos locales a ejecutar, aún NO ejecutados

```sh
cd /Users/matias/gng-ghidra
# Antes: leer AGENTS.md aplicables y docs/go-explore/README.md
git fetch origin && git switch feature/ge-w2-shield-acquisition

bash scripts/h3_run_logged.sh 6 node --test tests/test_h3_weapon_goal.mjs tests/test_h3_weapon_policy.mjs tests/test_h3_explore.mjs
bash scripts/h3_run_logged.sh 6 node --test tests/test_h3_*.mjs
bash scripts/h3_run_logged.sh 6 node scripts/h3_explore.mjs replay out/h3/explore/tape-fase5-completa-36091.json
bash scripts/h3_run_logged.sh 6 node scripts/h3_explore.mjs replay out/h3/boss/search-p5-45828.json
bash scripts/h3_run_logged.sh 6 node scripts/h3_weapon_probe.mjs out/h3/boss/search-p5-45828.json 36091
H3_GOAL=weapon H3_RANK=height bash scripts/h3_run_logged.sh 6 node scripts/h3_explore.mjs explore --from out/h3/explore/tape-fase5-completa-36091.json 1 6000 30
```

**Guardrails:** no escribir RAM, no `H3_POKE`, no tocar ROM/AOT/motor/bundle ni subir `out/`. Guardar comandos y sus argumentos en `out/h3/phase6/commands.log`; no modificar instrucciones operativas fuera del README. Commit/push únicamente de código/tests/docs seguros; no fusionar a `main` antes de gates locales. Evitar ejecutar búsqueda si fallan tests, preflight o replay.
