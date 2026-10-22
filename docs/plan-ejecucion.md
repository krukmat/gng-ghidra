# Plan operativo v2 — del fotograma real al juego recompilado

**Fecha de revisión:** 2026-10-22  
**Fuente de verdad de tareas:** [issues R0–R6](https://github.com/krukmat/gng-ghidra/issues?q=is%3Aissue+is%3Aopen) y este documento.  
**Historial de visores V0–V1.3:** [roadmap anterior](roadmap.md); **contrato técnico R0:** [frame-oracle.md](frame-oracle.md).

## 1. Objetivo y cambio de estrategia

Entregar *Ghosts 'n Goblins* ejecutando **lógica original MC6809 recompilada a JS/TS**, sin un intérprete de opcodes MC6809 como motor del producto. La ROM sigue siendo privada, en el Mac del operador. MAME o un núcleo MC6809 independiente pueden usarse **exclusivamente como oráculo de laboratorio**.

**Se congela la expansión de rutinas aisladas del pipeline Ghidra P-code → IR → JS.** No se elimina el trabajo realizado ni se descarta Ghidra: el pipeline existente sigue como referencia y Ghidra ayuda a descubrir bloques, CFG y bancos. Se evalúa una **vía alternativa de recompilación directa instrucción 6809 → bloques JS** contra el mismo oráculo. La elección final dependerá de evidencia diferencial, no de preferencias arquitectónicas.

La prioridad ya no es producir más escenas de diagnóstico. **V1.2 fue rechazado visualmente**: su collage determinista de tiles auténticos no es un nivel real. Ningún fixture se podrá presentar como fotograma ejecutado.

## Estado vigente — 22/10/2026: R2.2.B1 PASS y B2.a desarrollado

**R2.2.B1 validado en MAME real:** soft reset observado una vez, 17.135 snapshots MC6809 sin errores sintácticos, 100 lecturas/12 escrituras MMIO; las barreras de `after`, bus por instrucción, banco post-handler, SYNC e IRQ permanecen abiertas.

**R2.2.B2.a listo para validar en Mac:** se observa el bus de selección de banco `0x3e00` con el tap MMIO existente y se cuentan sus escrituras; **no** se afirma cambio de banco completado. El contrato técnico está en [R2 Execution Trace Contract](r2-execution-trace-contract.md#r22b2a--bank-select-mmio-instrumentación-preparada-validación-real-pendiente). Tras conservar los datos previos, ejecutar una sola sonda nueva:

```bash
git pull --ff-only
mkdir -p out/r2/mame-probe-soft-reset-pass
cp -R out/r2/mame-probe/. out/r2/mame-probe-soft-reset-pass/
GNG_R2_PROBE_SOFT_RESET=1 bash scripts/r2-mame-probe.sh
python3 - <<'PY'
import json
from pathlib import Path
j=json.loads(Path("out/r2/mame-probe/capabilities.json").read_text())
print(json.dumps({
    "status": j["status"],
    "bank_control": j.get("bank_control"),
    "bank_control_writes_observed": j["capabilities"].get("bank_control_writes_observed"),
    "observed_bank_switch_edges": j["capabilities"]["observed_bank_switch_edges"],
    "blockers": j["blockers"]
},indent=2))
PY
```

Los archivos privados del debugger, ROM y JSONL se conservan bajo `out/` y no se comparten. Un valor cero de escrituras a `0x3e00` en 4 frames es un hallazgo legítimo, no un error inventado. R2.2 no está cerrada.

---

## Estado verificado R2.2.B1 — 22/10/2026: `tracesym` operativo

El operador confirmó una ejecución real de la sonda nativa MAME `gngb` **sin soft reset**: `17.281` preestados / `17.281` marcadores válidos, `0` malformados, `61` PC distintos. `PRE_INSTRUCTION_FORMAT_PARSED` y `PARTIAL_NATIVE_INSTRUMENTATION` superan el gate de **preestado**, pero no el contrato integral R2.1. El parser aislado no certifica procedencia por sí mismo. La ejecución R2.2.B2 está pendiente.

**Siguiente gate:** validar el soft reset separado (conservando primero la evidencia sin reset). `r2_probe_report.py` ahora exige solicitud → notificación en orden, sin duplicados; CI ROM-free PASS.

```bash
git pull --ff-only
mkdir -p out/r2/mame-probe-no-reset-pass
cp -R out/r2/mame-probe/. out/r2/mame-probe-no-reset-pass/
GNG_R2_PROBE_SOFT_RESET=1 bash scripts/r2-mame-probe.sh
cat out/r2/mame-probe/capabilities.json
cat out/r2/mame-probe/pretrace-report.json
```

La copia local preserva `cpu.trace` y `pre-instruction.jsonl` sin publicarlos. **Solo enviar los JSON de resúmenes, no datos CPU.** R2.2.B2 sigue exigiendo bus, registros `after`, IRQ y SYNC reales.

---

## R2.2.B1 — Corrección del soft reset y diagnóstico privado del trace

La primera ejecución MAME con soft reset informó `[LUA ERROR] attempt to use a closed file`, duplicación de contadores y **16.892 marcadores nativos** no parseables. **R2.2.B1 BLOCKED**, independientemente de `MAME_EXIT=0`. Se añadió cierre idempotente/guardia de reentrada y validación shell fail-closed; parser ahora informa anchos y nombres de campos sin revelar valores.

**Próximo paso no destructivo** (aprovecha `out/r2/mame-probe/cpu.trace` existente sin iniciar MAME):

```bash
git pull --ff-only
python3 scripts/r2_pretrace_report.py --dir out/r2/mame-probe
python3 - <<'PY'
import json
from pathlib import Path
r=json.loads(Path("out/r2/mame-probe/pretrace-report.json").read_text())
print(json.dumps({
  "status":r["status"],
  "markers_seen":r.get("markers_seen"),
  "malformed_markers":r.get("malformed_markers"),
  "malformed_shapes_redacted":r.get("malformed_shapes_redacted",[])
},indent=2))
PY
```

Si el informe contiene shapes útiles, corregir parser según formato **real** y no adivinar anchuras. **No volver a correr MAME con reset** hasta fijar eso. Conservar `cpu.trace`, ROM y `pre-instruction.jsonl` solo localmente en `out/`.

---

## Actualización R2.2.B1 — 22/10/2026: trazas preinstrucción estructuradas

La sonda R2.2.A fue probada por el operador en MAME real: instrucciones, CPU y MMIO observables, pero `INSTRUMENTATION_BLOCKED` para reset inicial, registros por instrucción, bus completo, bancos, SYNC e IRQ.

Se añadió [R2.2.B1](r2-execution-trace-contract.md#r22b1--preestado-real-por-instrucción-controlado-22102026): `tracelog` del debugger para todos los nueve registros **preinstrucción**, parser `r2_pretrace_report.py` fail-closed y soft reset **opcional** observado tras enganchar Lua. CI ROM-free PASS; no hay traza real de B1 validada todavía. Su salida estructurada `gng.r2.pre-instruction.v1` **no** sustituye el contrato completo `gng.r2.cpu-trace.v1`.

**Siguiente comando del operador:**

```bash
git pull --ff-only
GNG_R2_PROBE_SOFT_RESET=1 bash scripts/r2-mame-probe.sh
cat out/r2/mame-probe/pretrace-report.json
cat out/r2/mame-probe/capabilities.json
```

Conservar `cpu.trace` y `pre-instruction.jsonl` dentro de `out/`. Bloque siguiente R2.2.B2: instrumentar `after`, bus e IRQ/SYNC realmente observados; no fingirlos.

---

## Actualización R2.2.A — 22/10/2026: sonda independiente preparada

Se implementó el diagnóstico `scripts/r2-mame-probe.sh`: proceso MAME separado con `-debug`, traza nativa `noloop` y observaciones Lua de registros, MMIO, banco y frame; `scripts/r2_probe_report.py` genera una matriz de capacidades **sin afirmar equivalencia CPU**. CI ROM-free valida el analizador y casos fail-closed. La prueba real en Mac sigue pendiente.

**Próxima validación local:** `git pull --ff-only && bash scripts/r2-mame-probe.sh`; devolver solo `out/r2/mame-probe/capabilities.json` o el resumen textual y las líneas de error de MAME, **no el archivo `cpu.trace` ni memoria/ROM**.

Si la sonda confirma datos nativos, abordar R2.2.B (correlación por instrucción y detección IRQ/SYNC); hasta ello R2.2 no está aceptada. [Contrato y cobertura](r2-execution-trace-contract.md).

---

## Estado de verificación 22/10/2026 — R0 y R1 cerrados, inicio de R2

El operador aportó screenshot del frame **1700** `gngb`: el comparador entre MAME original y JavaScript devuelve **0/57.344 píxeles diferentes (0,00%)**. El frame **1660** también mostró **0/57.344** y se reprodujo en dos corridas con hashes SHA-256 **MATCH** en PNG, FG, BG, sprites DMA y paleta. El vídeo privado (256×224, 2.102 frames) muestra transición hasta gameplay.

**R0 #1 y R1 #2 CERRADOS.** La equivalencia es del renderer a partir de VRAM original; NO significa que la lógica del juego esté recompilada.

**R2.1 CONTRACT_DEFINED:** [especificación versionada JSONL](r2-execution-trace-contract.md) y validador ROM-free `python3 scripts/r2_trace_contract.py <ruta-a-trace.jsonl>` (siempre reporte `reference_execution_verified=false`). Las pruebas sintéticas fallan de forma cerrada ante secuencias discontinuas, campos falsos y bus/IRQ incompleto.

**R2.2 PENDIENTE:** instrumentar una fuente CPU independiente que capture reset → SYNC → primera IRQ con PC, registros, RAM/MMIO, banco y eventos de frame. El comparador independiente previo de rutinas 0x622c/0x6755 (120 vectores con entrada sintética) es antecedente útil pero NO es la traza continua de runtime exigida en R2.

**Único siguiente bloque:** construir el capturador de laboratorio R2.2 sin alterar el bot Blackbox ni incluir MAME/ROM en el runtime JS. No repetir R0/R1 por rutina.

---

## Estado de verificación 22/10/2026 — historial R0 cerrado, R1.5 pendiente (superado)

El operador repitió la captura real `gngb` frame `1660` y contrastó los manifests privados: `foreground`, `background`, `sprites`, `palette` y `reference` dieron **MATCH** SHA-256 en dos ejecuciones independientes. Por tanto, se aceptan R0.1–R0.5 y se cierra [R0 #1](https://github.com/krukmat/gng-ghidra/issues/1). El resultado JS del frame 1660 permanece **0/57.344** píxeles distintos (revisión visual del operador).

**Única tarea abierta antes de pasar a R2:** R1.5, repetir la comparación JavaScript↔MAME con un segundo estado auténtico de gameplay (frame sugerido `1700`), conservando `out/reference/frame-1660-original/` localmente. Si el segundo frame no alcanza pixel-perfect, depurar con un diff real y mantener R1 abierto. No se ha demostrado todavía ejecución de lógica MC6809 recompilada.

---

## Actualización operativa — 22/10/2026: R1 primer fotograma exacto

**Evidencia del operador en Mac:** el navegador comparó un fotograma auténtico `gngb` frame **1660** de MAME, contra el renderer JS alimentado con FG/BG, DMA sprites, scroll X=12/Y=0, paleta y gráficos de la ROM original, y registró **0 / 57.344 píxeles diferentes (0,00%)**. Antes de corregir los bitplanes eran **9.813 / 57.344 (17,11%)**. Se corrigió la prioridad de bits de plano 2/3/4 bpp para seguir `src/emu/drawgfx.cpp` de MAME. Una captura del comparador visual valida el primer frame, no todo el juego.

**Estado del gate:** R0.1–R0.3 y revisión visual R0.5 probadas; **R0.4 reproducibilidad con hashes en una segunda corrida pendiente**. R1.1–R1.4 (primer frame) verificadas; **R1.5 segundo fotograma distinto pendiente**. Mantener [R0 #1](https://github.com/krukmat/gng-ghidra/issues/1) y [R1 #2](https://github.com/krukmat/gng-ghidra/issues/2) **abiertas** hasta completar sus gates. R2 (diferencial de ejecución MC6809) y posteriores siguen sin demostrar.

**Siguiente secuencia operativa:** (1) archivar la carpeta privada `out/reference/mame/` del frame 1660, (2) repetir una vez el frame 1660 usando el plan inmovilizado y comparar hashes nativos, (3) conservar esa evidencia y capturar un frame distinto de gameplay (p. ej. 1700), comparar 256×224 en JS. No subir ni ROM ni PNG ni VRAM ni HTML con bytes privados a Git.

**Aviso:** el contenido de la sección de 21/10/2026 siguiente es histórico y sus instrucciones de repetir el primer intento de captura ya no son la acción prioritaria.

---

## Actualización operativa R0 — 21/10/2026

**Evidencia del operador:** `bash scripts/r0-blackbox-baseline.sh`
ya ejecuta la partida real de GNGb y **Arthur se mueve**.
La ruta funcional usa el plan gameplay y el Lua original de Blackbox fijado
al commit `99722c3900b63e13185c52824c0adec3df7f44c1`, con la única
adaptación conocida de botones ataque/salto. **No volver al bot
experimental** de `scripts/visual-real-frame.sh`.

**Siguiente tarea R0:** ejecutar `bash scripts/r0-blackbox-frame.sh`.
Este modo conserva el autoplayer original y añade un observador de
vídeo/FG/BG/DMA/paleta/scroll para producir
`out/reference/mame/manifest.json` y
`out/visual/frame-compare.html` a partir del **mismo** run.
El addon Lua y la igualdad JS/MAME aún requieren verificación local.
R0 se cierra solo tras validar los datos de vídeo reales.
El baseline sin addon permanece reproducible con su comando original.

## 2. Estado comprobado al redactar este plan

| Elemento | Estado | Interpretación |
| --- | --- | --- |
| V0/V1.1 | Visores implementados, revisión local parcial | Gráficos ROM / sprites diagnósticos; no gameplay |
| V1.2 | Código implementado, **rechazado visualmente** | Mosaico sintético; no se mejora como objetivo |
| R0 | **CERRADO** | Imagen, FG/BG/DMA/paleta auténticos; frame 1660 reproducible (cinco hashes MATCH) |
| R1 | **CERRADO (renderer)** | Dos fotogramas auténticos 1660 y 1700: **0/57.344** píxeles de diferencia en ambos |
| R2 | **R2.1 contrato y validador; R2.2+ pendientes** | Falta instrumentación y traza genuina reset → SYNC → primera IRQ |
| R3 | No demostrado | No hay recompilador directo validado de un tramo real significativo |
| R4/V2–R6/V4 | Bloqueados | No existe primer frame generado, interacción ni juego jugable |

Un **CI verde** acredita pruebas públicas/sintéticas, pero no certifica captura real, igualdad de píxeles, ejecución original ni gameplay.

## 3. Secuencia de trabajo, tareas y subtareas

Los plazos son **timeboxes orientativos en días laborables desde el inicio**, no fechas prometidas; dependen de poder ejecutar MAME y la ROM local. Cada issue contiene la checklist detallada, dependencia y aceptación. No abrir trabajo posterior para maquillar un gate bloqueado.

### R0 — Captura real y verificable · D1–D3 · [Issue #1](https://github.com/krukmat/gng-ghidra/issues/1)

**Tarea:** obtener un fotograma auténtico y su memoria de vídeo asociada.

- **R0.1:** verificar MAME, driver gngb/gng y chips ROM por CRC; no elegir driver por nombre ZIP.
- **R0.2:** ejecutar `bash scripts/r0-blackbox-frame.sh` usando como base el gameplay verificado; no utilizar el bot previo. Diagnosticar fallos en la captura sin volver a cambiar Coin/Start.
- **R0.3:** validar PNG 256×224, FG/BG, buffer DMA de sprites, paleta, scroll, manifest y hashes.
- **R0.4:** repetir captura en condiciones idénticas y comprobar reproducibilidad.
- **R0.5:** revisar fotograma auténtico y registrar resultado sin subir recursos privados.

**Entrega:** `out/reference/mame/` (local). **GO:** evidencia completa y reproducible. **STOP:** preflight/captura fallida, DMA ausente o estado incoherente. **No significa equivalencia del renderer.**

### R1 — Igualdad del renderer con fotogramas reales · D3–D7 · [Issue #2](https://github.com/krukmat/gng-ghidra/issues/2)

**Tarea:** reconstruir en JS el mismo fotograma que generó MAME, usando **sus bytes reales de VRAM**, no un collage.

- **R1.1:** abrir `out/visual/frame-compare.html` con el frame de R0.
- **R1.2:** medir y conservar localmente diff de píxeles, porcentaje, driver/frame y hashes.
- **R1.3:** depurar BG, FG, sprites, crop, paleta RGB, scroll, prioridades y sincronización DMA.
- **R1.4:** corregir renderer y añadir regresiones ROM-free.
- **R1.5:** contrastar un segundo fotograma real para evitar una coincidencia accidental.

**Entrega:** comparación visual y diff cuantitativo. **GO:** cero píxeles distintos para un frame estable y segundo frame contrastado. **STOP:** diferencias estructurales/no explicadas. Si aparece una imagen reconocible pero persisten diferencias, es **avance parcial**, no igualdad aceptada. El objetivo de D7 es un frame real reconocible; la igualdad estricta puede bloquear el cierre del gate.

### R2 — Oráculo diferencial de ejecución · D6–D10 · [Issue #3](https://github.com/krukmat/gng-ghidra/issues/3)

**Tarea:** capturar y comparar ejecución CPU auténtica, separada del renderer.

- **R2.1:** definir esquema de traza (PC, opcode, registros, CC, RAM/MMIO, banco, IRQ/FIRQ, frame).
- **R2.2:** instrumentar una referencia independiente del código generado.
- **R2.3:** capturar secuencia desde reset hacia SYNC y primera IRQ, con entradas/condiciones fijadas.
- **R2.4:** implementar diff que señale la **primera divergencia** y no continúe silenciosamente.
- **R2.5:** añadir CI con fixtures sintéticos; trazas reales exclusivamente en `out/`.

**Entrega:** formato, capturador y comparador reproducibles. **GO:** traza determinista y detector probado con errores deliberados. **STOP:** ausencia de eventos, trazas parciales ambiguas o validación circular.

### R3 — Prueba de recompilación directa 6809 → JS · D8–D14 · [Issue #4](https://github.com/krukmat/gng-ghidra/issues/4)

**Tarea:** decidir con evidencia si la recompilación estática es viable para el juego.

- **R3.1:** extraer bloques básicos/CFG y bytes exactos de ROM con Ghidra + decoder.
- **R3.2:** generar funciones JS por bloque y un dispatcher de **direcciones de código**, no un intérprete de opcodes.
- **R3.3:** modelar registros/flags, RAM, ROM bancarizada y MMIO explícito con fail-closed.
- **R3.4:** integrar SYNC, IRQ/FIRQ y cambios de banco observados; no saltar eventos.
- **R3.5:** comparar tramo contiguo **reset → primera interrupción atendida**, incluyendo escrituras.
- **R3.6:** comparar fidelidad y esfuerzo frente al pipeline P-code actual y emitir **GO/NO-GO**.

**Entrega:** demo Node y reporte de primera divergencia. **GO:** tramo real con interrupción, checkpoints y escrituras equivalentes, sin intérprete. **NO-GO al D14:** no hay prueba suficiente o la complejidad exige atajos no verificables. Si falla, **replantear el alcance con el operador**, sin convertir el producto a emulador de forma encubierta.

### R4 / V2 — Primer frame generado por JS recompilado · Semanas 3–4 · [Issue #5](https://github.com/krukmat/gng-ghidra/issues/5)

**Tarea:** que la memoria del fotograma proceda del **código original recompilado**, no de una instantánea inyectada.

- **R4.1:** completar arranque, bancos, dispositivos e interrupciones hasta primer vblank.
- **R4.2:** conectar RAM/MMIO y buffer DMA del JS generado con renderer R1.
- **R4.3:** ejecutar avance determinista de frames e inputs fijados.
- **R4.4:** comparar memoria, eventos y píxeles con R0/R2.
- **R4.5:** entregar demo local y regresiones sin ROM en Git.

**Entrega:** primer frame V2 auténtico del JS generado. **GO:** fotograma causado por ejecución recompilada y contrastado. **STOP:** composición manual o estado de vídeo precargado como sustituto.

### R5 / V3 — Primer control jugable · Semanas 5–8 · [Issue #6](https://github.com/krukmat/gng-ghidra/issues/6)

**Tarea:** Arthur responde a controles mediante lógica original recompilada.

- **R5.1:** mapear inputs hardware a teclado/gamepad.
- **R5.2:** crear loop determinista con replay de entradas.
- **R5.3:** recompilar rutas observadas de movimiento, salto, animación y colisión.
- **R5.4:** comparar posiciones, estados y frames con el oráculo.
- **R5.5:** verificar interacción local y documentar limitaciones.

**Entrega:** demo V3 con izquierda/derecha y salto. **GO:** comportamiento real reproducible; **STOP:** desplazamientos o animaciones hardcodeados.

### R6 / V4 — Port completo · Sin fecha cerrada · [Issue #7](https://github.com/krukmat/gng-ghidra/issues/7)

**Tarea:** convertir la primera interacción en partida completa.

- **R6.1:** niveles, enemigos, proyectiles, físicas, colisiones, vidas y transiciones.
- **R6.2:** audio/Z80 y sincronización tras estabilizar gameplay.
- **R6.3:** rendimiento y fidelidad de prioridades, scroll y paletas.
- **R6.4:** empaquetado sin distribuir ROM.
- **R6.5:** regresiones de sesiones completas con inputs reproducibles.

**Entrega:** port jugable validado, no solo un frame o una demo de movimiento.

## 4. Dependencias y política de avance

```text
R0: captura real ──→ R1: renderer igual al frame ──┐
       │                                            │
       └───────────→ R2: traza CPU ──→ R3: GO/NO-GO ├──→ R4/V2 ──→ R5/V3 ──→ R6/V4
```

R2 puede prepararse durante la depuración R1, pero **R4 exige R1 y R3 aceptados**. R3 necesita R2. Un gate bloqueado no se etiqueta PASS por tener CI verde.

## 5. Reglas operativas y definición de terminado

1. **Un solo objetivo observable por entrega**: comando local, resultado, evidencia y límite explícito.
2. **Tareas y subtareas máximo dos niveles**: una issue por gate con checklist y enlace a evidencia, no backlog de rutinas arbitrarias.
3. **ROM privada:** ZIP, dumps RAM/VRAM, PNG originales, trazas con bytes ROM y HTML con gráficos ROM en `out/`; nunca commit ni adjuntos públicos.
4. **CI sin ROM:** pruebas de esquema, compilador, renderer y diff con datos sintéticos. **Validación con ROM/MAME:** ejecución manual en Mac, reportada separadamente.
5. **Fail closed:** no completar estados desconocidos con valores ficticios; no afirmar equivalencia sin comparación independiente.
6. **Ritmo:** revisión al terminar R0, R1 y al D14. El resultado del D14 determina la arquitectura de la siguiente fase, no una decisión previa.
7. **V1.3 anterior** (mostrar inicialización de sprite RAM traducida) queda como prueba técnica opcional dentro de R3/R4, **no** como hito visual prioritario.

## 6. Próxima acción exacta

**Ingeniería:** R2.2.A ha entregado una sonda MAME real y verificación ROM-free. R2.2.B requiere aún instrumentación fiable de cada instrucción y señales SYNC/IRQ. No confundir una muestra de MMIO o un fichero debugger `trace` con equivalencia CPU.

**Operador — ahora, primer test de capacidades MAME con ROM local:**

```bash
git pull --ff-only
bash scripts/r2-mame-probe.sh
cat out/r2/mame-probe/capabilities.json
```

La sonda es independiente del bot y se ejecuta por separado; devuelve `PARTIAL_NATIVE_INSTRUMENTATION` o `INSTRUMENTATION_BLOCKED`, **nunca** `R2=PASS`. Evidencia en `out/`, no subir `cpu.trace`, ROM o memoria al repositorio.
