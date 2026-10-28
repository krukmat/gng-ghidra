# H3-S2 — Sonda TAS: vida del cíclope y paso a la fase 2

**Estado:** PENDIENTE (28/10/2026). Sigue a [H3-S1](h3-tas-probe-s1-task.md) (GO).
Pertenece al [plan de contenido](../plan-contenido-h3-h4-2026-10-27.md).

## Objetivo

Extender [h3_explore.mjs](../../scripts/h3_explore.mjs) para que derrote al
cíclope de la fase 1. El resultado es una cinta desde reset, solo con entradas,
en la que `0x72` pasa de 0 a 1.

## Datos de partida

- **Cinta de S1:** `out/h3/explore/tape-s1-5348-arena.json` (sha `f5cbb0c7…`,
  RAM `8ad5a998…`). Llega a la arena en el frame 5348 con fase 0, checkpoint 1,
  X=3458, scroll 3072, 3 vidas y sin armadura.
- **Rendimiento:** g6 explora a unos 18.000 fps. S1 tardó 64 s.
- **Celdas:** dentro de la arena la X apenas progresa. Sin una señal del jefe,
  el explorador va a ciegas, como le pasaba al haz.

## Pasos

1. **Prefijo.** Añadir un modo `explore --from <cinta>` que reproduzca la cinta
   de S1 hasta su `goalFrame` y explore desde ahí. Las máscaras del prefijo
   pasan a formar parte de la cinta final. No se usan pokes.
2. **Localizar la vida del jefe (validación barata).**
   - Explorar en la arena, solo con disparo y movimiento.
   - En cada impacto sobre el jefe, comparar la RAM antes y después. Sirven como
     pista la puntuación BCD `0x68–0x6B` y los objetos del área `0x0500+`.
   - Candidato: un byte que solo decrece con los golpes y no cambia sin ellos.
   - Confirmarlo en al menos 2 ramas independientes.
3. **Señal.** Añadir la vida del jefe a la celda (o al peso de selección) y
   explorar hasta que `0x72` cambie. Máximo 30 minutos de reloj.
4. **Guardar y comprobar.** Guardar la mejor cinta, con los mismos campos que
   en S1. Replay independiente desde reset, sin restore, dos veces.
5. **Test.** Ampliar `tests/test_h3_explore.mjs` con lo nuevo que sea puro.

## GO / STOP

- **GO:** la cinta desde reset hace pasar `0x72` de 0 a 1, sin pokes y sin
  perder vidas, y el replay independiente da MATCH de hash y señal. Anotar
  el frame de la transición y la dirección de la vida del jefe.
- **STOP:** se da cualquiera de estos casos.
  - No se encuentra el byte de vida del jefe tras la validación barata.
  - `0x72` no cambia en 30 minutos.
  - Aparece no determinismo.
  - Aparece HALT o `UNCOMPILED`: se registra y no se corrige.

## Límites

Los mismos de S1:

- Un agente, secuencial. Al empezar, pedir la cuota 5h/7d y esperar.
- **Prohibido:**
  - Usar MAME o crear g7.
  - Tocar engine, AOT, runtime, renderer o bundles.
  - Hacer pokes o escrituras de RAM o estado.
  - Añadir `cfg/` o `gng-ghidra/`.
  - Hacer commit de `program.mjs` o de derivados de la ROM.
  - Tocar los cambios de audio sin commit.
- **Salidas:** privadas, en `out/h3/explore/`.

**Presupuesto:** ~15–20 % de la ventana de 5h y ~3 % del semanal. Avisar antes
de superarlo.

## Después (fuera de esta tarea)

- **S3:** certificar F-1. Doble replay de la cinta completa, paridad MAME con
  [v3_b3_oracle.mjs](../../scripts/v3_b3_oracle.mjs) en la entrada de fase, el
  jefe y la transición, y ramas de muerte con respawn y de game over con
  continue.
- **Fase 2:** si el explorador se atasca en X≈5450, diagnóstico H3-F3.

## Entrega

- Plan actualizado (GO o STOP) con métricas: ramas, celdas, frames, tiempo de
  reloj, dirección de la vida del jefe y frame de la transición.
- Hashes de las cintas.
- Tests, commit y push a main. Los commits terminan con
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Informe breve en castellano, con barras de progreso.

## Prompt para retomar

```text
Ejecuta docs/agents/h3-tas-probe-s2-task.md en /Users/matias/gng-ghidra.
Lee primero esa tarea. Pide la cuota 5h/7d y espera.
Un agente, secuencial; sin MAME ni g7; respeta los límites de la tarea.
Actualiza el plan, verifica, haz commit y push. Reporta breve.
```
