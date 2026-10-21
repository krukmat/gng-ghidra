# Plan operativo v2 — del fotograma real al juego recompilado

**Fecha de revisión:** 2026-10-21  
**Fuente de verdad de tareas:** [issues R0–R6](https://github.com/krukmat/gng-ghidra/issues?q=is%3Aissue+is%3Aopen) y este documento.  
**Historial de visores V0–V1.3:** [roadmap anterior](roadmap.md); **contrato técnico R0:** [frame-oracle.md](frame-oracle.md).

## 1. Objetivo y cambio de estrategia

Entregar *Ghosts 'n Goblins* ejecutando **lógica original MC6809 recompilada a JS/TS**, sin un intérprete de opcodes MC6809 como motor del producto. La ROM sigue siendo privada, en el Mac del operador. MAME o un núcleo MC6809 independiente pueden usarse **exclusivamente como oráculo de laboratorio**.

**Se congela la expansión de rutinas aisladas del pipeline Ghidra P-code → IR → JS.** No se elimina el trabajo realizado ni se descarta Ghidra: el pipeline existente sigue como referencia y Ghidra ayuda a descubrir bloques, CFG y bancos. Se evalúa una **vía alternativa de recompilación directa instrucción 6809 → bloques JS** contra el mismo oráculo. La elección final dependerá de evidencia diferencial, no de preferencias arquitectónicas.

La prioridad ya no es producir más escenas de diagnóstico. **V1.2 fue rechazado visualmente**: su collage determinista de tiles auténticos no es un nivel real. Ningún fixture se podrá presentar como fotograma ejecutado.

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
| R0 | Baseline Blackbox con partida y movimiento **verificado por operador**; observador nativo integrado en modo opcional | Pendiente validar screenshot + FG/BG/scroll/DMA/paleta reales y su replay JS |
| R1 | Renderer para memoria capturada disponible | **Equivalencia visual NO establecida** |
| R2 | No demostrado | No hay todavía traza completa de ejecución real con IRQ/bancos |
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

En el Mac, desde la raíz del repositorio:

```bash
git pull --ff-only
bash scripts/visual-real-frame.sh
```

**Si falla:** registrar el mensaje textual exacto y bloquear R0; no volver al mosaico sintético.  
**Si funciona:** abrir `out/visual/frame-compare.html`, revisar MAME vs JS y su diff; solo entonces continuar con R1. **El resultado local aún no está certificado en este plan.**
