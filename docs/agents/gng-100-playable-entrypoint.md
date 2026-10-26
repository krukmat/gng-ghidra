# ENTRYPOINT — Ghosts ’n Goblins 100% jugable

**Propósito:** handoff operativo y puerta de entrada para un modelo sucesor de mayor capacidad.
**Repositorio:** `krukmat/gng-ghidra` · **Rama:** `main` · **Checkpoint:** 26/10/2026.
**Plan de dependencias y aceptación:** [G0–G7 / H0–H6](../plan-100pct-jugable-2026-10-26.md).

> **MANDATO INVARIABLE: lograr el 100% de jugabilidad auténtica de Ghosts ’n Goblins.**
> **TODO ESTE PLAN ES SUGERIDO Y MODIFICABLE:** el modelo sucesor puede cambiar fases, dependencias, tareas, algoritmos, herramientas y orden de ejecución cuando la evidencia demuestre una vía mejor. NO puede sacrificar la jugabilidad real ni declarar éxito sin verificarlo.

## 1. Qué significa 100% y qué no

**100% jugable:** arrancar el hardware representado desde reset, insertar moneda, iniciar partida, controlar a Arthur, combatir, saltar, morir, reaparecer, avanzar por todas las fases y jefes, completar los recorridos que exige el juego y llegar al desenlace auténtico. Incluye créditos, puntuación, armadura/vidas, game over, armas, enemigos, colisiones, scroll, efectos visuales, audio/música, modos 1P/2P que ofrezca la revisión original, estabilidad y partidas prolongadas.

**No significa:** alcanzar 100% de bloques ROM estáticos, 1.500/6.000 frames de un tape, un hash de estado diferente, un sprite decorativo o un mero `PASS_CPU_ACTIVE_READ`. Para declarar jugabilidad hacen falta evidencia **funcional visible**, controles y resultados del motor original.

**Restricciones de fidelidad que no se negocian:**
- CPU MC6809 de la revisión original recompilada **AOT** a JS/TS; no intérprete de opcodes en runtime, ni reemplazar lógica de juego por scripts, cuadros pregrabados o animaciones artificiales.
- MAME **solo** como oráculo externo de laboratorio; referencias reproducibles con la **misma revisión ROM**, DIP, reset y timing de entradas. No incorporar MAME al producto.
- ROM y gráficos privados permanecen en Mac; no subir a GitHub `roms/`, `out/`, dumps de RAM/VRAM, screenshots del juego, derivados de ROM u otros artefactos protegidos.
- Mantener bundles congelados y checksums verificados: nuevos descubrimientos AOT en paquetes privados nuevos, con rollback. No modificar uno certificado para “pasarlo”.
- Criterios de aceptación basados en comportamiento real. Un modelo puede cambiar la implementación, **pero no reinterpretar la evidencia para lograr PASS**.

## 2. Estado factual de partida

| Componente | Evidencia reportada | Qué sigue abierto |
| --- | --- | --- |
| CPU / vídeo | AOT MC6809 ejecuta código original desde reset, primer frame auténtico 311. V2 tiene 290 frames pixel-exact (311–600) | Paridad durante escenas de juego no certificada |
| B2-D | 1.654 bloques, perfiles `lateCoin`, `lateStart`, `lateControls` 1.500 frames cada uno, doble replay, regresiones ROM-free PASS | No demuestra partida humana controlable |
| Controles | Pausa VBlank real en frame 311. Sesión humana: **22 lecturas Coin1** y, en segunda sesión, **17 Start1** | No hay crédito visible ni transición al juego acreditados |
| ~~Bloqueo crítico~~ **RESUELTO (V3.B3)** | `HALT_UNCOMPILED` frame 496, bank 3, `0x519D`, reproducido con Coin de 22 frames desde 311 y superado. [Informe V3.B3](../v3-b3-playable-2026-10-26.md) | — |
| **V3.B3 (2.266 bloques)** | Coin → «PRESS START» → Start → intro → Arthur en la fase 1, controlable (andar, scroll, lanza, salto, agacharse, perder armadura, morir/respawn); 3 bots de 5 min sin `UNCOMPILED`; runner en vivo con B3 | MAME 0.288: 7 cintas idénticas byte a byte (hasta 18.000 frames). Falta la sesión humana de 5 min |
| Idle/attract | Superado: perfil `idle` de 6.000 frames en B3 (antes HALT en 1038, `0x6A9D`) | B2-E queda obsoleto |
| Audio | El runtime principal expone un `soundlatch` | Cadena real de sonido y síntesis sin certificar |
| Runtime largo | Sesión en vivo de 36.000 frames (~10 min); el worker libera los snapshots entregados | Cadencia/latencia y sesiones de horas (P7) |

**No inventar porcentaje general de progreso ni fechas.** Lo confirmado es motor/render/lecturas reales, todavía no el primer crédito ni Arthur controlable.

## 3. Plan recomendado y dependencias (completamente revisables)

El modelo sucesor debe **revisar críticamente** este orden en vez de asumir que es óptimo.

| Bloque | Dependencia | Tasks / subtasks (1–2 niveles) | Aceptación GO |
| --- | --- | --- | --- |
| **P0: Captura humana reproducible** | B2-D | T0.1 Instrumentar tecla→ciclo CPU→lectura MMIO. T0.2 Registrar tape privada de Coin desde VBlank 311 y Start cerca de 481, con duraciones **medidas**, no inventadas. T0.3 Reproducir el error `bank=3 PC=0x519D` y fijar ROM/DIPs. | Tape repetible y causa exacta reproducida |
| **P1: Expandir AOT de la ruta temprana** | P0 | T1.1 Crear un nuevo paquete hijo de B2-D; sembrar `bank=3 PC=0x519D`. T1.2 Descubrir rutas exclusivamente durante build offline a partir de la tape. T1.3 Pasar regresión B2-D, checkpoint y firma del paquete. | Superar frame 496 sin `UNCOMPILED` en secuencia humana; no romper rutas previas |
| **P2: Primer gameplay observable** | P1 + oráculo | T2.1 Crédito **visible**, Start consume/inicia partida. T2.2 Arthur aparece y responde a dirección/ataque/salto por código original. T2.3 Prueba de interacción sostenida con controles reales. | **H2, MVP jugable**: crédito, Start, Arthur controlable, sin trampa visual |
| **P3: Primera fase completa** | P2 | T3.1 Enemigos, objetos, disparos, armadura, físicas, colisión y scroll. T3.2 Muerte/respawn/game over y transición de fase. T3.3 Comparar checkpoints con MAME. | **H3**: ganar y perder de forma auténtica, completar fase y continuar |
| **P4: Juego entero** | P3 | T4.1 Capturar y cubrir rutas necesarias de todas las fases, jefes y vidas. T4.2 Primera/segunda vuelta y final real. T4.3 Reintentos y caminos alternativos desde reset. | **H4**: recorrer legítimamente el juego completo |
| **P5: Sonido auténtico** | Escenarios reales P2+ | T5.1 Confirmar la placa sonora del set (Z80/YM2203 en driver de referencia, sujeto a verificación); definir ejecución/síntesis real sin pistas grabadas. T5.2 Sincronizar música/SFX y validar. | Audio original coherente y sincronizado en juego |
| **P6: Paridad visual y modos** | P2/P3 | T6.1 Sprites, paleta, DMA, prioridades y scroll en escenas variadas. T6.2 Verificar 2P, crédito, DIP, game over/controles conforme a la revisión elegida. | Sin defectos críticos observables y modos originales utilizables |
| **P7: Estabilidad y entrega** | P2 para medir; cierre tras P4–P6 | T7.1 Eliminar límite artificial de 6.000 frames y crecimiento sin cota de `records`. T7.2 Cadencia, latencia y sesiones largas. T7.3 Build reproducible con ROM local, batería de regresión y replay de final. | **H6: 100% jugable = P4+P5+P6+P7 PASS** |

**Ruta crítica sugerida:** P0 → P1 → P2 → P3 → P4; P5–P7 en paralelo solo cuando sea verificable. **Posible cambio válido:** si la retención de snapshots impide un recorrido, adelantar P7; si un defecto gráfico impide verificar crédito, adelantar una parte de P6. B2-E/attract extendido **NO** debe desplazar el bloqueo humano `0x519D` sin una razón demostrable.

## 4. Cómo debe trabajar el modelo sucesor

**Ciclo obligatorio de decisión y ejecución:**

1. **Auditar primero:** `main`, `HEAD`, este ENTRYPOINT, el plan G0–G7, códigos y evidencias. Distinguir hechos del operador, tests aislados, hipótesis y trabajo pendiente. Confirmar que el repositorio no ha cambiado antes de escribir.
2. **Cuestionar hipótesis:** identificar dependencias falsas, rutas AOT incompletas, repetición cara, cobertura espuria y oportunidades de rediseño. El objetivo de producto pesa más que los nombres de bloques vigentes.
3. **Elegir un bloque pequeño:** listar tasks/subtasks (1–2 niveles), dependencia, salida verificable, GO/STOP, rollback y riesgos. Priorizar el **bloqueo funcional** más próximo a que el usuario pueda jugar.
4. **Implementar de forma autónoma:** cambios en `main`, commits concretos, tests ROM-free y documentación. No publicar ROM, paquetes privados ni su contenido. Solo pedir al operador ejecuciones de Mac necesarias para ROM/MAME privados.
5. **Validar sin falsas certificaciones:** CPU/bus, comportamiento observable (crédito, sprites en movimiento, transición, final), referencia nativa y reproducibilidad. Si falla, conservar artefactos/checkpoints, clasificar `BLOCKED` y continuar por el fallo específico.
6. **Replanificar con evidencia:** cualquier parte del plan se puede modificar, eliminar, fusionar o sustituir. Registrar **Decisión → evidencia → opciones → impacto en 100% jugable → criterio GO**. No insistir en una táctica por haberla documentado.
7. **Cerrar cada checkpoint:** reportar `HEAD`, ficheros, tareas GO/PARTIAL/BLOCKED, comandos locales mínimos, nuevo cuello de botella y siguiente bloque. Actualizar esta entrada si la ruta crítica cambia.

**Antiobjetivos:** incrementar el número de bloques como fin; aumentar horizontes idle solo por completar números; confundir BUS_READ con GAMEPLAY; inyectar RAM/VRAM para mostrar créditos o Arthur; reescribir un bundle certificado; declarar paridad nativa con tests ROM-free; prometer ejecución asíncrona.

## 5. Primer bloque de ejecución (COMPLETADO 26/10/2026 → V3.B3)

> Estado: P0 y P1 GO; P2.T1 GO en el motor AOT local; MAME y la sesión humana de 5 min, pendientes.
> **Método vigente:** descubrimiento AOT de una pasada desde cintas (`scripts/v3_b3_discover.mjs`). Para cubrir una ruta nueva hay que añadir una cinta en `src/v3_b3_tapes.mjs` y reconstruir B3 en otro directorio. No se debe volver a iterar semilla a semilla.

### Texto original del bloque

**P0+P1: `EARLY_COIN_START_BANK3`** — máxima prioridad hasta tener crédito/Start real.

- **P0.T1** Instrumentar cronología *humana* con tiempos y ciclos exactos (tecla activa, envío, aplicación en `SharedArrayBuffer`, lecturas reales); generar `input-tape` privado y hash.
- **P0.T2** Reejecutar desde reset con pausa equivalente: confirmar `frame=496, bank=3, pc=0x519D`. Si difiere, diagnosticar timing antes de expandir código.
- **P1.T1** Derivar paquete AOT privado nuevo desde B2-D sin alterar B2-D, sembrando `bank=3, pc=0x519D`; descubrir siguientes `UNCOMPILED` **solo offline**, con checkpoints/resume.
- **P1.T2** Conservar paridad de tapes ya certificados, integridad SHA-256 y reglas ROM-private; no promocionar con `FRAMES_DONE` aislado.
- **P2.T1** Ejecutar Coin y Start **humanos** en navegador: confirmar crédito y transición visual, luego Arthur controlable. Si aparece otro PC, regresar a P1 con esa evidencia.

**GO del primer bloque:** crédito y Start **observados en la lógica y pantalla del juego original**. **STOP:** no reproducibilidad, deriva MAME/revisión de ROM, regresión B2-D, nuevo estado inventado o rutas sin compilar. Los detalles del siguiente bloque pueden cambiar si un diagnóstico nuevo demuestra otro cuello de botella.

## 6. Prompt de arranque para el modelo sucesor

> Trabaja como arquitecto principal y ejecutor de `krukmat/gng-ghidra`. El **objetivo invariable** es terminar Ghosts ’n Goblins original con **100% de jugabilidad auténtica**, no preservar un plan ni maximizar bloques. Lee `docs/agents/gng-100-playable-entrypoint.md` y `docs/plan-100pct-jugable-2026-10-26.md`; inspecciona `main` y las evidencias. El plan es **sugerido: tienes mandato de revisarlo y cambiarlo** si existe una vía mejor, dejando razones y gates. Mantén CPU MC6809 AOT real, ROM privada, bundles certificados y MAME solo como oráculo externo. Actúa autónomamente en el repo con tasks/subtasks de 1–2 niveles y criterios GO/STOP; pide pruebas locales solo cuando sean indispensables. Prioriza reproducir y superar el bloqueo humano `bank=3 pc=0x519D frame=496` en Coin/Start, salvo que demuestres una dependencia previa más importante. Después verifica crédito, Start y Arthur controlable; prosigue por fases, audio, modos y estabilidad hasta 100%. No confundir entrada de bus ni hashes con jugabilidad. Mantén el checkpoint y replanifica con evidencia.
