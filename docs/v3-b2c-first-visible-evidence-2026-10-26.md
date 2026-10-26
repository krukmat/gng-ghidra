# V3.B2-C — Live GnG Engine: ejecución real, no visor de capturas

Fecha: 2026-10-26. Rama: `main`. El primer runner real está
implementado, pendiente de validación en Mac.

## Decisión

**Se descarta el plan anterior** de `idle.html`,
`compare.html`, reproducción de capturas o timeline pregrabada.
Aunque provinieran del AOT, no aportarían una ejecución viva del
juego. Una escena sintética o sprites dibujados por la UI NO
constituyen un avance de GnG.

La única fuente de la pantalla debe ser:

```text
ROM local privada → AOT MC6809 compilado fuera de runtime
                 → createBoard(...): CPU + IRQ + memoria + DMA
                 → snapshot VBlank generado EN VIVO
                 → renderGngbRgba(snapshot, gráficos ROM privados)
                 → framebuffer 256x224 en navegador local
       teclado ─→ bits active-low SYSTEM/P1 ─→ lectura CPU AOT
```

No se usa MAME ni un intérprete MC6809 para ejecutar el juego.
No hay frames prefabricados, animaciones CSS, scripts que
manipulen sprites, estados fingidos ni frames de referencia
inyectados. El renderer existente se conserva.

## Primera implementación: runner real en `main`

- `scripts/v3_b2c_live.mjs`: servidor HTTP *loopback*
  `127.0.0.1:18609` y teclado. Los inputs active-low se
  entregan al worker con memoria compartida, no alteran snapshots
  ni escriben estados de juego directamente.
- `scripts/v3_b2c_engine_worker.mjs`: carga el paquete AOT
  congelado privado, decodifica las ROM gráficas una sola vez
  desde `roms/gng.zip`, ejecuta `createBoard.run()` en
  un worker y obtiene frames del callback auténtico `onFrame`.
  La UI recibe exclusivamente los píxeles producidos al renderizar
  ese estado; la CPU espera confirmación de frame para mantener
  sincronización con la pantalla.
- `src/v3_b2c_live_controls.mjs`: adaptador real de teclas
  con exclusión direccional 4-way y bits active-low. No contiene
  lógica de juego ni animación.
- `tests/test_v3_b2c_live_controls.mjs`: casos ROM-free.

El runner prefiere `out/v3/b2b/frozen` **solo si** su
`discovery-report.json` demuestra 1000 frames, replay y
compatibilidad idle V2; si no, usa
`out/v3/b2a/frozen` con su prueba privada `coin-smoke.json`.

## Tareas del bloque actual

**T1 — Arranque del GnG AOT real**
- T1.1 Verificar bundle privado de la rama V3 y que corresponde
  a B2-A o B2-B certificado; no compilar sobre la marcha.
- T1.2 Worker de CPU único y entrada por puertos, sin usar
  snapshots históricos como fuente de vídeo.
- **PASS:** `V3_B2C_REAL_ENGINE=STARTED` más CPU ejecutando
  bloques MC6809 reales. Este marcador **solo** demuestra arranque.

**T2 — Presentación de estado de vídeo auténtico**
- T2.1 Renderizar únicamente frames VBlank cuyo buffer DMA
  y RAM de vídeo sean conocidos, con sprites/tilemaps,
  paleta y scroll reales.
- T2.2 Mostrar en canvas local los RGBA desde ese renderer
  y rechazar cualquier sustitución por MAME/fotos/mock.
- **PASS:** `V3_B2C_FIRST_FRAME=PASS_REAL_AOT_RENDER`,
  más comprobación visual del operador en el Mac.
  No implica primera partida.

**T3 — Teclado real → hardware → CPU**
- T3.1 `5` Coin1; `1` Start1; flechas, `Z` botón1,
  `X` botón2, usando puertos activos en bajo en tiempo
  real. Suprimir repeticiones y rechazar joystick inválido.
- T3.2 Reportar cuándo la CPU realmente consulta
  `0x3000` con Coin1 activo. El juego —no el frontend—
  determina los cambios posteriores.
- **PASS:** `V3_B2C_COIN=PASS_REAL_CPU_READ`,
  respaldado por una lectura efectiva del AOT.

**T4 — Bloqueo honesto y desbloqueo de partida**
- T4.1 Si los inputs llegan a una ruta aún `UNCOMPILED`,
  **detener** la CPU, mostrar el estado `UNCOMPILED`
  y conservar el último frame real verificado, sin
  fingir progreso de partida.
- T4.2 Alimentar B2-B con el banco/PC de esa ruta;
  recompilar exclusivamente fuera del runtime, desde
  reset. Cambiar al bundle B2-B cuando su gate real pase.
- **PASS:** Coin → Start → movimiento/salto observado
  directamente en el motor, no solo en una comparación
  de hashes; equivalencia MAME con esa secuencia pendiente
  para la certificación funcional V3.

**T5 — Gate local e inspección**
- T5.1 Regresión ROM-free previa, check de scripts y
  adapter 4-way. No tocar los bundles V2 o V3 congelados.
- T5.2 Arranque en Mac, mostrar pantalla real,
  presionar Coin y devolver únicamente marcadores
  de runtime; vídeo/capturas permanecen privadas.
- **PASS de infraestructura:** `V3_B2C_WIRING=PASS_ROM_FREE`.
  **PASS de demostración:** primera imagen real + lectura
  real del control, sin `fake fallback`. Si aparece
  `UNCOMPILED`, queda bloqueada la jugabilidad, no el
  mérito de haber renderizado GnG real.

## Checkpoint real recibido — 26/10/2026

El operador reportó la ejecución **en Mac** del motor, con este
resultado:

```text
GNG_LOCAL_REGRESSION=PASS_ROM_FREE_A0_2_TO_A0_6_3
GNG_LOCAL_REGRESSION=PASS_ROM_FREE_R3_R42H
V3_B2C_WIRING=PASS_ROM_FREE
V3_B2C_AOT_BUNDLE=B2A
V3_B2C_REAL_ENGINE=STARTED http://127.0.0.1:18609
V3_B2C_FIRST_FRAME=PASS_REAL_AOT_RENDER frame=311
V3_B2C_ENGINE=HALT_FRAMES_DONE
```

**Interpretación precisa:** existe evidencia de ejecución real de
CPU AOT y píxeles compuestos de su snapshot n.º 311. `FRAMES_DONE`
no es un fallo de CPU: indica que el primer runner solicitaba
exactamente `manifest.frames=600`, que define una ventana de
certificación, **no la duración de una sesión interactiva**.
Este resultado NO certifica pulsación de moneda, Start, movimiento
o salto por parte del operador: en particular no existe
`V3_B2C_COIN=PASS_REAL_CPU_READ` en esta corrida.

### Corrección posterior (pendiente de ejecutar en Mac)

El worker usa ahora `validateLiveFrames` y recibe
`LIVE_FRAMES=6000` (100 segundos nominales de vídeo a 60 Hz),
independiente del mínimo certificado de 600/1000 frames
que figure en el bundle. Es un máximo acotado por memoria,
**no** un motor ilimitado; termina normalmente al completar
6.000 frames, o antes si encuentra un bloque AOT ausente.
El navegador permite **Reiniciar GnG desde reset**: termina
la CPU previa, libera todos los controles, carga el mismo AOT
congelado y vuelve a ejecutar la inicialización real desde cero.
No reinyecta estado ni empieza directamente en el frame 311.

Se añadieron tests ROM-free de validación de límites en
`tests/test_v3_b2c_session_policy.mjs`; son distintos de
la ejecución privada pendiente.

**Nuevo gate local necesario:** repetir
`bash scripts/v3_b2c_gate.sh` con el commit actualizado
y abrir el runner. Esperados:
`V3_B2C_SESSION_FRAMES=6000` y, tras pulsar `5` cuando el
juego sondea el puerto,
`V3_B2C_COIN=PASS_REAL_CPU_READ`.
Si aparece `HALT_UNCOMPILED`, conservar su banco/PC
para continuar B2-B offline. No usar MAME como fallback.

## Ejecución prevista en el Mac

```bash
git switch main
git pull --ff-only
bash scripts/v3_b2c_gate.sh
node scripts/v3_b2c_live.mjs --serve
```

Abrir `http://127.0.0.1:18609/`. El proceso usa solo
localhost y nunca publica bytes de ROM, scripts AOT o
fotogramas en GitHub. Salida esperada inicial:
`V3_B2C_AOT_BUNDLE=B2A|B2B`,
`V3_B2C_REAL_ENGINE=STARTED`,
`V3_B2C_FIRST_FRAME=PASS_REAL_AOT_RENDER`.
Al pulsar 5 **cuando GnG sondee el puerto**,
`V3_B2C_COIN=PASS_REAL_CPU_READ`.
La disponibilidad de una partida real depende de que el
descubrimiento AOT B2-B complete sus rutas.

## Límites estrictos

- Todavía no hay certificación de partida jugable, ni audio,
  ni entradas MAME diferenciales para START/movimiento.
- Los primeros frames no se muestran como conocidos:
  `rendererUnknownCount` gobierna la disponibilidad.
- El navegador no crea frames. Solo blittea RGBA reales.
- Motor AOT ejecutado hasta su primer bloque ausente, error
  real o límite de frames del paquete; se muestra detención.
- MAME se usa únicamente para gates de comparación externos
  posteriores; **nunca** como engine detrás del navegador.

## Checkpoint B2-C ampliado: ejecución hasta ruta ausente (26/10/2026)

El operador validó nuevamente en el Mac:

```text
GNG_LOCAL_REGRESSION=PASS_ROM_FREE_A0_2_TO_A0_6_3
GNG_LOCAL_REGRESSION=PASS_ROM_FREE_R3_R42H
V3_B2C_WIRING=PASS_ROM_FREE
V3_B2C_AOT_BUNDLE=B2A
V3_B2C_REAL_ENGINE=STARTED http://127.0.0.1:18609
V3_B2C_SESSION=STARTED_1
V3_B2C_SESSION_FRAMES=6000
V3_B2C_FIRST_FRAME=PASS_REAL_AOT_RENDER frame=311
V3_B2C_ENGINE=HALT_UNCOMPILED
```

La sesión **solicitó** 6000 frames, pero alcanzó un bloque AOT
no compilado y se detuvo antes de completar el recorrido.
No conocemos el frame final ni el banco/PC porque la salida
adjunta no contiene `/state.halt`; tampoco se ha acreditado
una lectura Coin1 activa. No convertir este resultado en
`V3_B2C_COIN=PASS_REAL_CPU_READ`.

**Acción prioritaria:** ejecutar el descubrimiento offline
`bash scripts/v3_b2b_local.sh` para completar Coin → Start,
compilar bloques nuevos durante build, y congelar B2B. El
runner B2-C seleccionará ese artefacto **solo tras sus gates
reales**. Se añaden marcadores B2-C de frame/banco/PC/lecturas
para que cualquier ruta restante sea accionable, sin publicar
ROM ni dumps de memoria.

## Checkpoint B2-B completado: port AOT real con Coin, Start y controles

Validación Mac posterior a la reanudación:

```text
V3_B2B_RESUME=PASS_ATTESTED_CHECKPOINT
V3_B2B_RESUME_FROM_ITERATION=48
V3_B2B_DISCOVERY_ITERATION=59
V3_B2B_DISCOVERY_BLOCKS=663
V3_B2B_DISCOVERY_FRAMES=1000
V3_B2B_NO_INPUT=PASS_600_FRAMES_IDENTICAL_V2
V3_B2B_REPLAY=PASS_TWO_FROZEN_1000_FRAME_RUNS
V3_B2B_DISCOVERY=PASS_1000_FRAMES_AOT_OFFLINE
V3_B2B_COIN_ACTIVE_READS=2
V3_B2B_START_ACTIVE_READS=2
V3_B2B_FIRST_START_EFFECT=531
V3_B2B_FIRST_CONTROLS_EFFECT=651
V3_B2B_COIN_START=PASS_CAUSAL_INPUT_EFFECT_NOT_NATIVE_CERTIFIED
V3_B2B_LOCAL=PASS
```

B2-B queda cerrado para sus **tres tapes** de 1.000 frames.
El motor interactivo B2-C seleccionará automáticamente la nueva
imagen `out/v3/b2b/frozen` (663 bloques) en la próxima ejecución,
tras verificar el reporte. No implica que cualquier secuencia
arbitraria en vivo esté ya compilada, ni que Arthur sea controlable
visualmente: comparar hashes de estado tampoco certifica movimiento.

### B2-C.T6 — Prueba directa de entrada desde el teclado hasta la CPU

Se incorporó `src/v3_b2c_port_witness.mjs` al worker AOT
y se expone `busWitness` en `GET /state`. El testigo consume
**solo lecturas observadas del puerto** en los ciclos MC6809
originales (0x3000/0x3001), sin generar entradas de prueba,
mutar RAM o inferir el estado del avatar.

Las muestras activas separan moneda, Start, derecha, izquierda,
arriba, abajo, ataque y salto, con el primer ciclo/PC de CPU.
Contar una muestra de botón activo **no implica** que el motor
haya aplicado desplazamiento, colisión, disparo o salto;
eso queda para la correlación visual y validación diferencial
contra la ROM original/MAME.

Objetivo siguiente del operador: arrancar B2-C con paquete B2B,
pulsar 5 y 1 y probar izquierda/derecha/Z/X durante la ventana
de la partida (no una reproducción precalculada). Verificar
`V3_B2C_AOT_BUNDLE=B2B`, `V3_B2C_BUS_COIN1`,
`V3_B2C_BUS_START1`, `V3_B2C_BUS_P1_RIGHT`, etc.
El render sigue alimentándose únicamente de snapshots vivos
del runtime MC6809; no se publica contenido de ROM.
