# H3-F2 — Diagnosticar el primer impacto cerca de X=5464

**Estado:** PENDIENTE. **Dirección vigente:** identificar la causa del impacto
antes de ampliar la búsqueda de acciones. Esta tarea pertenece al laboratorio
H3 del [plan de contenido](../plan-contenido-h3-h4-2026-10-27.md), paso 5.
No reanuda el bot de `bot/`.

## Objetivo y evidencia de entrada

Determinar qué rutina y condición llevan al estado `0x9c64` sin armadura,
y comprobar una maniobra dirigida únicamente si se identifica una causa.
Checkpoint de código: `c328405` o descendiente con sus cambios presentes.

- Cinta privada: `out/h3/boss/search-p1-7290.json`; SHA-256 de archivo
  `bdd0129156f01e2e5aba963fdce20924a5b911566dc178d979a8be22cb6b156d`.
- Conserva el prefijo de `search-p1-7300.json` y el poke de laboratorio
  `1840:2120:114:1`. Reproducirlo exactamente; no introducir otros pokes.
- El inspector observa X=5464/Y=79/scroll=5080, fase 1 y 2 vidas en 7290;
  una reanudación en 7291 ya observa handler `0x9c64`, sin armadura.
  **7290–7291 es una frontera candidata:** verificar el orden de captura de
  `onFrame`, la RAM actual y el contador antes de atribuir un ciclo exacto.
- El decremento a una vida llega después. La columna visible y la meseta no
  prueban la causa. Tampoco hay jefe, combate o puerta funcional demostrados.
- `h3_boss_search.mjs` ya incluye `0x9c64` en la poda de muerte. No repetir
  barridos generales: las variantes anteriores están descritas en el plan.

## Ejecución y límites

Un agente, secuencial. Al iniciar otra sesión, pedir cuota restante 5h/7d y
esperar, salvo que ambos números ya se hayan dado; estimar el bloque en ambas
unidades. Sin MAME ni g7. Mantener congelados engine, AOT, runtime, renderizador
y bundles. Cambios permitidos: scripts de diagnóstico H3, documentación y
tests mínimos si una herramienta cambia. Instrumentación temporal en memoria
del laboratorio; no editar ni recompilar el bundle certificado.

1. Validar hash y bundle g6. Reproducir hasta 7301 con
   [h3_boss_inspect.mjs](../../scripts/h3_boss_inspect.mjs) para fijar las
   convenciones de frame y la transición candidata. Si falta la cinta o el
   bundle, registrar la dependencia y parar; no regenerar una búsqueda larga.
2. Inspeccionar solo el código relacionado con la escritura del handler en
   `0x0510–0x0511`. Instrumentar su primera entrada en `0x9c64` y, si hace
   falta, su predecesor inmediato. Limitar la traza detallada a 7240–7301;
   permitir como máximo una ampliación de 60 frames hacia atrás si el origen
   queda fuera. Máximo dos replays de diagnóstico desde reset: baseline y
   traza instrumentada, sin contar los candidatos del paso siguiente.
3. Registrar PC/banco/ciclo, valor anterior y nuevo, condición de la rama y
   operandos o referencia a objeto/celda cuando existan. Si no puede atribuirse
   la causa, marcar `UNKNOWN` y terminar con un único siguiente experimento
   propuesto. No convertir coincidencias visuales en causalidad.
4. Solo con causa identificada, probar como máximo **tres maniobras P1**,
   desde el mismo prefijo anterior al evento, hasta 240 frames por variante.
   Explicar qué condición intenta cambiar cada una. Conservar baseline y
   cintas sin sobrescribir los originales. No ampliar haz ni hacer rejillas.

Presupuesto de ejecución: hasta 15 minutos de pared para replays/trazas y
candidatos; si se alcanza, guardar lo obtenido y cerrar el bloque.

## Entrega y aceptación

Actualizar el plan con causa demostrada o `UNKNOWN`, evidencia verificable y
un siguiente paso. Mantener trazas, RAM, imágenes y cintas privadas en `out/h3/`;
publicar solo herramientas, hashes y conclusiones. Verificar que la
instrumentación conserva el estado del baseline al final de la ventana.

Separar resultados: evitar la entrada fatal durante el horizonte es una
mejora local; avance exige superar X=5464 y mantenerse al menos 60 frames por
encima sin estado fatal ni pérdida de vida. Ninguno demuestra por sí solo
jefe derrotado o fase completada. Toda afirmación adicional necesita su señal
observada. Pruebas acotadas de las herramientas modificadas, commit y push;
informe breve en castellano con límites pendientes.

## Prompt para retomar

```text
Continúa H3, paso 5, con docs/agents/h3-phase2-first-hit-task.md.
Lee primero esa tarea y el tramo correspondiente del plan de contenido.
En sesión nueva pide cuota restante 5h/7d y espera si no se dieron ambos datos.
Un agente, secuencial; sin MAME ni g7; engine y bundles congelados.

Usa la cinta privada out/h3/boss/search-p1-7290.json y valida su hash.
Verifica la frontera candidata 7290–7291 y las convenciones de captura:
X=5464 precede a 0x9c64 sin armadura, pero su causa sigue sin demostrarse.
Localiza la escritura a 0x0510–0x0511 y la condición que la dispara mediante
una traza AOT corta. Respeta los límites de frames, replays y tiempo de la
tarea. No repitas búsquedas amplias ni atribuyas la muerte a la columna.

Solo si identificas la causa, prueba hasta tres maniobras P1 dirigidas desde
el mismo prefijo, 240 frames como máximo cada una. Si falta evidencia, cierra
con UNKNOWN y un único experimento siguiente. No afirmes jefe, combate,
puerta funcional o fase completada sin una señal observada que lo sostenga.
Actualiza la nota, verifica los cambios, haz commit y push. Reporta breve.
```
