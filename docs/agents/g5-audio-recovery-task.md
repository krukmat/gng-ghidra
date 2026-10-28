# G5-AUDIO-RECOVERY — Resolver bloqueo real de audio Z80 → YM2203 → PCM

**Estado:** T0–T2 PASS / T3 PENDIENTE DE IMPLEMENTACIÓN, engine autorizado · **Prioridad:** P0 · **Repo:** `krukmat/gng-ghidra` · **Rama:** `main` · **Fecha:** 2026-10-28

**Resultado actual:** audio auténtico Z80 → dual YM2203 → PCM demostrado en el laboratorio privado y reconocido por el operador. La partida sigue sin AudioWorklet conectado. El cierre verificable y el contrato mínimo de integración están al final de este documento; las evidencias de partida siguientes son históricas.

**Dirección vigente:** el operador autorizó conectar el audio al engine («pues conectalo... cual es el problema?») y después pidió estas tareas y un prompt de continuación. Se permite modificar la conexión de audio en el worker, servidor/UI y bundle privado necesario. El bot continúa excluido y la semántica MC6809 no forma parte de esta autorización. No queda un bloqueo de permisos: falta implementar y verificar T3.0–T3.7, detalladas abajo. Los commits `51780ba`, `e5b6fdb` y `1b4805b` contienen T0–T2; no repetir su investigación sin una regresión nueva.

## Objetivo y definición de terminado

Resolver y demostrar el audio *original* de Ghosts ’n Goblins generado por la ejecución real del programa de sonido: entradas de la MC6809 → sound latch/reset → Z80 ejecutando `gg2.bin` → dos YM2203 → PCM no silencioso → reproducción durante una partida. **MAME es oráculo diferencial, nunca fuente de playback de registros YM.**

El laboratorio real Z80→YM→PCM ya está desbloqueado; el entregable pendiente es conectarlo a la partida y demostrar sonido sincronizado de gameplay. No declarar `AUDIO_WORKING` solo porque pasan tests o se genera tráfico YM: la aceptación requiere muestras PCM no nulas, tono reproducible y, para la fase jugable, AudioWorklet conectado durante ejecución real.

## Evidencia verificable de partida

1. **Última ejecución del operador:** `node scripts/audio_live_final.mjs` → `STOP / AUDIO_FINAL_REGRESSION_GATE_STOP`, con `checkpoint:null`, `execution:null`. **Es un STOP anterior a ejecutar la ROM; no confirma ni invalida el nuevo compilador dinámico.** No se conoce el test que falló. Diagnosticarlo **antes** de cambiar código de audio.
2. Última regresión completa confirmada antes de los cambios dinámicos: **126/126 Node y 78/78 Python PASS**, `gg2.bin` SHA1_MATCH. Tras nuevas pruebas de JIT, el total teórico cambió; no dar por aprobado hasta que corra en el Mac.
3. Último ensayo significativo anterior al STOP de regresión: **2.362.941 pasos**, `T=19.787.763`, primer comando nativo aplicado en `T=19.782.194`, **una lectura posterior del sound latch** y STOP `AUDIO_Z80_IRQ_UNCOMPILED_PC`. Aquel ensayo produjo **66.532 escrituras YM** pero **0 FM key-ons, 0 PSG volumen no nulo y WAV totalmente silencioso**.
4. Captura nativa MAME: primera escritura YM en `T=898.884` desde reset; laboratorio Z80 en `T=898.887`, diferencia inicial de 3 T-states **sin paridad completa**. En la ventana comparada MAME produjo **63 FM key-ons** y escrituras de frecuencia/operadores, que faltaron en la ejecución propia. Primer comando *posterior al reset* aproximadamente a `T=19.782.194` (~6,59 s), de ahí que el antiguo corte de 3m T-states fuera insuficiente.
5. Se incorporó resolución de un único bloque AOT al alcanzar un PC de ROM real no compilado, con límites, exclusión de ejecución fuera de ROM y STOP ante opcode no soportado. **19/19 pruebas sintéticas aisladas PASS**, pero **no probado contra `gg2.bin` después del cambio**. No inventar éxito.

## Referencias obligatorias (leer en orden)

- `docs/audio-g5-final-one-shot.md`: historial y criterios del gate integral.
- `scripts/audio_fast_checkpoint.mjs`: causa inmediata de `AUDIO_FINAL_REGRESSION_GATE_STOP`; examinar rama de STOP de Node/Python, escaneo y build, sin filtrar contenidos privados.
- `tests/test_gngb_z80_sound_probe.mjs`, `tests/test_gngb_z80_native_controls.mjs`, `tests/test_gngb_z80_scheduler_lab.mjs`: contratos y regresiones relevantes.
- `scripts/audio_live_final.mjs`: entrada única y síntesis, salida resumida; comprobar que el STOP principal conserva causa secundaria.
- `src/gngb_z80_sound_probe.mjs`, `src/gngb_z80_scheduler_lab.mjs`, `src/gngb_z80_irq_boundary.mjs`, `src/gngb_z80_static_codegen.mjs`: fetch, IRQ, AOT inicial + compilación dinámica de PC real, trampas y semántica.
- `src/gngb_z80_sound_bus.mjs`, `src/gngb_ym_register_health.mjs`, `src/gngb_ym_native_baseline.mjs`: sound latch, contadores FM/PSG y comparación privada.
- `src/audio_ym2203_lab.cpp`, `scripts/audio_ym_native_build.sh`, `src/gngb_audio_pcm_processor.mjs`, `src/gngb_audio_worklet_sink.mjs`: renderer, PCM y destino navegador.
- `src/gngb_audio_main_z80_bridge.mjs`, `src/gngb_runtime.mjs`: integración posterior sin alterar inadvertidamente la CPU principal.
- `docs/audio-b4-live-integration-entry-2026-10-27.md`: contexto de MAME 0.288, reset, `HOLD_LINE`, límites de paridad.

## Plan de ejecución — trabajo real, no nuevos planes

**T0. Recuperar el gate (P0, dependencia de todo lo demás).**
Ejecutar `git status --short`, `node scripts/audio_fast_checkpoint.mjs` y, si STOP, `node --test` sobre los tests declarados por el script y `python3 -m unittest discover -s tests -p 'test_audio_*.py' -v` de forma local. Identificar **el nombre y la aserción exacta** de cada fallo. Corregir implementación o tests obsoletos sin desactivar pruebas ni saltarse gates. Si el problema es un STOP de ROM/scan/build, investigarlo como tal y no atribuirlo a Node sin evidencia. El report público debe contener únicamente nombres de tests, códigos seguros y contadores, jamás bytes/ROM/tape.

**T1. Validar el bloqueo poscomando con ROM local privada (depende de T0).**
Ejecutar `node scripts/audio_live_final.mjs`; conservar el comando original capturado, el reloj relativo al reset y los límites. Confirmar dinámicamente la dirección alcanzada tras el sound latch sin publicar PCs ni opcodes privados. Si falla el AOT on-demand, localizar **la instrucción/semántica exacta**, escribir test ROM-free que la reproduzca y corregirla, sin inventar rutas ni ampliar arbitrariamente familias.

**T2. Validar YM y PCM (depende de T1).**
Para una ejecución continua después de `T=19.782.194`, comparar contadores y secuencia temporal **en privado** con MAME: inicio de eventos FM, key-on, frecuencias, operador, volumen y YM reset. Usar MAME solo como referencia; **no alimentar el sintetizador con YM grabado**. Obtener WAV privado con muestras PCM no nulas generadas únicamente por YM escritos por la Z80. Si no se alcanza, reportar explícitamente la primera divergencia observada y causa probada o hipótesis pendiente.

**T3. Integración jugable (solo cuando T2 pase).**
Conectar el bridge MC6809→Z80 y la cadena PCM→AudioWorklet siguiendo T3.0–T3.7. **La conexión del engine está autorizada; el bot sigue prohibido.** AudioWorklet requiere gesto del usuario y sincronía/underruns medidos. No llamar "jugable con audio" al WAV offline.

## Límites y seguridad

- Trabajar en `main` con commits claros; nunca publicar `gg2.bin`, MAME traces, controles privados, YM crudo, archivos `out/audio/`, fuentes AOT derivadas de ROM ni WAV privados. Todo ello permanece en el Mac bajo `out/audio/`; no enviarlo a agentes cloud. Logs compartidos: JSON sanitizado.
- No desactivar tests, falsificar `audio_working`, usar tapes YM como playback, saltar gate de privacidad ni declarar paridad MAME sin evidencia. No tocar el bot. Evitar cambios de arquitectura si una divergencia concreta basta.
- No pedir otra captura MAME ni otra ronda de barridos estáticos si los datos existentes alcanzan. Ejecutar primero el mínimo experimento discriminante.
- Mantener este documento como contrato único, incluidas las tareas de continuación solicitadas por el operador. Registrar aquí las modificaciones y resultados verificables; no abrir otra cadena de planes.

## Entregables y aceptación

- **A:** regresión real **PASS** en Mac; número de tests y commit reproducibles.
- **B:** ejecución de ROM auténtica sobrepasa el primer comando sin `UNCOMPILED_PC` ni semánticas inventadas; cualquier STOP posterior queda tipificado con causa verificable.
- **C:** el YM escrito por Z80 produce **PCM no silencioso**, comprobado mediante muestras/RMS y oído; comparación MAME suficiente para identificar discrepancias críticas sin declarar paridad no probada.
- **D:** validar conexión MC6809/Z80/dual YM/AudioWorklet, audible y sincronizada durante partida; si no se alcanza, señalar el primer bloqueo técnico real con evidencia. La conexión del engine ya está autorizada.
- **Salida final al usuario:** commit(s), **PASS/BLOCKED**, primera causa real y evidencia, lo que funciona, lo que falta. **No** una cadena de próximos microcheckpoints.

## Cierre ejecutado en Mac — 2026-10-28

### T0 — PASS: regresión diagnosticada y corregida

Node v22.23.0, Python 3.15.0, arm64 macOS. El primer checkpoint reprodujo **129/130 Node y 78/78 Python**. Falló exactamente `G5 runtime AOT rejects actual unknown indirect target without inventing opcode`: `assert.equal(result.status,'STOP_BEFORE_TARGET')` recibió `LAB_ADVANCE_OK`.

Causa probada: `import(data:)` reutilizaba el módulo estático y su `Map`; la resolución dinámica mutaba ese mapa compartido. Una ROM sintética posterior con el mismo prefijo estático ejecutaba bloques de la ROM anterior. Cada sesión recibe ahora `new Map(generated.z80AotBlocks)`. La prueba nueva ejecuta tres ROM sintéticas con prefijo idéntico y comprueba resultados diferentes, sin reutilizar bloques dinámicos. El test original permanece y pasa.

El gate final conserva en STOP el estado secundario, exits, contadores, nombres de tests públicos y causa scan/build. Tres pruebas sintéticas comprueban que no filtra assertions, rutas ni payloads privados, también cuando el hijo escribe su error en stderr.

### T1 — PASS: primer comando superado sin inventar ejecución

Tras T0 se ejecutó `node scripts/audio_live_final.mjs` con el comando capturado original, su reloj relativo al reset y los límites originales de **36m T-states / 5m pasos / 200k escrituras YM**. La resolución dinámica superó el antiguo `UNCOMPILED_PC` y reveló sucesivamente cinco formas realmente ejecutadas: `DEC (IX/IY+d)`, `ADD IX/IY,DE`, `LD (IX/IY+d),n`, `RLCA` y `SET b,(IX/IY+d)` de memoria. Se añadieron exclusivamente esas formas y pruebas ROM-free de flags, tiempos, desplazamientos, wrap y límites; las demás formas siguen fallando de forma explícita. Fixtures antiguas que usaban el ahora soportado LD indexado como sentinel se cambiaron al INC indexado todavía no soportado. Se contrastaron ciclos y flags con el [manual oficial Zilog UM0080](https://www.zilog.com/docs/z80/um0080.pdf).

Ejecución continua final: **3.052.981 pasos**, **T=25.782.197** frente a objetivo **25.782.194** (overshoot 3T), **67 resoluciones dinámicas**, ningún STOP ni familia pendiente. Primer comando en **T=19.782.194**; **4 comandos aplicados**, **477 lecturas del latch posteriores al primero**. IRQ de laboratorio: **2.062 solicitudes / 1.989 ACK**; esto no certifica la fase IRQ nativa.

### T2 — PASS: YM generado por Z80, PCM medido y oído

`node scripts/audio_live_final.mjs` devuelve **`Z80_TO_DUAL_YM_TO_PCM_LAB_PASS_NOT_LIVE_GAME`**. Regresión completa final: **144/144 Node y 78/78 Python PASS**, ROM `SHA1_MATCH`. Renderer reconstruido mediante `bash scripts/audio_ym_native_build.sh out/audio/ymfm`, con Apple clang 21 y ymfm fijado a `81aec25ccbb98f4873a255f7551ac4dadac59b4a`; build PASS (warnings de parámetros sin usar del proveedor).

- **88.610 escrituras YM** nuevas: 44.372 al primer chip y 44.238 al segundo; **63 FM key-ons**, **146 escrituras de frecuencia**, **240 de operadores**, sin volumen PSG no nulo. Los conteos coinciden con MAME en la misma ventana.
- Comparación privada estricta, sin realinear: **88.610/88.610 pares puerto/valor iguales y en el mismo orden**; ningún ordinal difiere. Primera diferencia temporal en el ordinal 1: desfase constante **+12 ticks de 12 MHz = +3 T-states Z80** en todos los pares. No se aplicó una corrección artificial de fase. Esto acredita esa secuencia observada, no paridad completa de CPU/IRQ ni de otras partidas.
- WAV privado mono 62.500 Hz: **537.812 muestras**, **125.347 no nulas**, **peak 15.820**, **RMS 1.868,80**. Solo entraron al renderer escrituras producidas por la Z80 de esta ejecución. MAME se leyó únicamente como oráculo diferencial; no alimentó la síntesis.
- `afplay` local terminó con **exit 0**. El operador respondió **«Sí, se reconoce»**. Tras reconstruir el renderer, el WAV definitivo es idéntico byte a byte al oído. WAV, ROM, controles, diagnóstico y resultados detallados permanecen en `out/audio/`; no se adjuntaron ni publicaron. El TSV intermedio se elimina automáticamente.

### T3 — Pendiente: estado técnico y autorización vigente

La inspección de fuentes prueba que `src/gngb_runtime.mjs:createBoard` ya admite `onAudioEvent`, y `createGngbMainZ80Bridge` traduce latch/reset. Sin embargo, **`scripts/v3_b2c_engine_worker.mjs` no conecta el callback**, carga un runtime del bundle privado cuya capacidad debe verificarse y transmite solamente frames/inputs. **`scripts/v3_b2c_live.mjs` no conecta PCM ni crea/resume AudioContext**. El renderer C++ actual es un proceso offline, sin productor incremental de PCM. Al cerrar T0–T2 no se habían modificado esos archivos, el runtime MC6809 ni el bot. La posterior autorización del operador permite implementar la conexión; no aporta por sí misma evidencia de audio durante gameplay.

Contrato pendiente, todavía no implementado ni presentado como audio jugable:

| Punto autorizado pendiente | Interfaz mínima y requisito verificable |
|---|---|
| Worker: `createBoard(...,{onAudioEvent})` | Entregar `{kind,value,cycle}` a un adaptador persistente. Avanzar Z80 hasta la frontera del evento **antes** de cambiar latch/reset, medir overshoot, preservar anclas del reloj y resetear Z80 y ambos YM cuando corresponda. Verificar/regenerar el bundle privado con el observer existente. |
| Productor dual YM continuo | Operaciones `write(tick,addr,value)`, `reset(tick)` y `renderUntil(tick)` que preserven estado entre chunks. El CLI que genera WAV no satisface este contrato. |
| Worker → UI | PCM `{sessionId,sampleRate,firstSample,samples}`, con orden y continuidad de muestras; sin transportar ROM, PCs ni YM crudo. |
| UI + AudioWorklet | Gesto real para `AudioContext.resume()`, resampling de 62.500 Hz al sample rate efectivo, reset/pausa de la misma sesión y telemetría acumulada de cola, muestras, underruns y desfase A/V. |

El pacing actual del servidor (intervalo mínimo 17 ms y pausas posibles) no acredita el reloj hardware de ~16,768 ms/frame. **No hay medición ni audición durante gameplay**. La autorización concedida queda acotada a la conexión de audio en los dos scripts del engine anteriores y su bundle; no incluye modificar semántica MC6809 ni bot. Hasta validar ese contrato, `game_audio_live=false`, `browser_worklet_connected=false` y las declaraciones de paridad nativa siguen siendo falsas.

## Continuación ejecutable — T3.0–T3.7

**Precedencia:** T0 → T1 → T2 ya están completadas. Revalidar el gate sobre el HEAD de reanudación y después ejecutar este grafo. Las cuatro tareas T3.1, T3.2, T3.3 y T3.5 pueden avanzar en paralelo tras T3.0; no pasar a aceptación integrada hasta completar sus dependencias. Los agentes auxiliares solo reciben fuentes/tests públicos, nunca ROM, bundle derivado, capturas, WAV ni contenido de `out/`.

**Invariantes de reloj:** un reset de línea reinicia CPU/chips, pero no rebobina la época global ni `firstSample`; solo el reset frío crea otra sesión y época. El productor debe recibir un marcador de completitud que confirme que todas las escrituras hasta una frontera ya se observaron: `onFrame` por sí solo no lo garantiza. Diferir el lote/PCM hasta completar la instrucción que cruza la frontera conserva la semántica MC6809.

| Tarea | Depende de | Trabajo concreto y criterio de salida |
|---|---|---|
| **T3.0 — Preflight y contrato de reloj** | T2 + gate actual PASS | Verificar localmente el bundle que selecciona realmente el servidor y si su runtime expone `onAudioEvent`; registrar solo capacidad/hash seguro. Si falta, actualizar el bundle mediante su flujo existente, sin cambiar semántica MC6809 ni debilitar certificaciones. Fijar anclas de reloj, orden de eventos, fronteras de frame y límites de cola. Medir coste por segundo emulado para detectar pronto si el productor no alcanza tiempo real. Salida: contrato probado con fixtures públicas y preflight local PASS, o primer bloqueo concreto de bundle/rendimiento. |
| **T3.1 — Sesión Z80 persistente** | T3.0 | Extraer/reutilizar la ejecución validada en `gngb_z80_sound_probe.mjs` sin sus entradas MAME ni su liberación artificial de reset. Mantener CPU, RAM, AOT por sesión, IRQ y reloj entre frames. Avanzar hasta cada evento antes de aplicar latch/reset, y hasta la frontera solicitada; gestionar tiempo mientras RESET está activo, overshoot y eventos que caen dentro de una instrucción. No retimestamp ni descartar silenciosamente eventos. Salida: tests ROM-free de latch, reset/release tardío, IRQ, chunks, límites y aislamiento de dos sesiones; STOP tipificado ante instrucción desconocida. |
| **T3.2 — Dos YM persistentes y PCM incremental** | T3.0 | Añadir al renderer nativo un modo continuo con escrituras fechadas, reset fechado y `renderUntil(tick)`; conservar los dos chips y la fase de muestra entre peticiones. Mantener el CLI offline existente y el pin de ymfm. Salida: render único y por chunks producen PCM idéntico para la misma secuencia sintética, incluidos cortes no alineados con muestra, escrituras en frontera y reset intermedio; memoria acotada y cierre limpio del proceso. |
| **T3.3 — Eventos de la MC6809 de la partida** | T3.0 | Conectar `onAudioEvent` en `scripts/v3_b2c_engine_worker.mjs` y enviar internamente lotes ordenados `{kind,value,cycle}` con sesión y frontera de reloj. No reenviar PC/ROM/YM a HTTP. Tener en cuenta que `onFrame` puede ejecutarse antes de terminar una escritura que cruza la frontera: no certificar como completo un intervalo cuyo evento aún no fue observado. Salida: observer y ausencia de observer conservan los mismos frames/lecturas en fixtures públicas; prueba local del bundle real con contadores sanitizados. |
| **T3.4 — Productor y transporte PCM** | T3.1 + T3.2 + T3.3 | Conectar eventos reales → Z80 → YM → PCM sin entradas pregrabadas. Preferir un worker de audio separado y un proceso nativo persistente: la CPU principal usa `run()` síncrono y espera con `Atomics.wait`, por lo que no puede depender de callbacks asíncronos en ese mismo hilo. Entregar al navegador solo PCM con `{sessionId,sampleRate,firstSample,samples}` y secuencia verificable. Añadir backpressure y límites, rechazo de huecos/duplicados/sesiones antiguas y propagación de STOP. Salida: continuidad de muestras y aislamiento demostrados; productor no bloquea HTTP ni altera las entradas de la partida. |
| **T3.5 — AudioWorklet y cambio de frecuencia** | T3.0 | Servir por loopback los módulos necesarios y conectar el sink desde un gesto real que cree/resuma `AudioContext`. Convertir 62.500 Hz a la frecuencia efectiva del contexto preservando fase entre chunks; no usar una frecuencia asumida de 48 kHz. Validar sesión/índice antes de encolar, prebuffer acotado y estado explícito de espera/reproducción/STOP. Salida: tests de duración, fase y continuidad a 44.100/48.000 Hz; AudioWorklet real cargado y contexto `running` en navegador. Los tonos sintéticos son fixtures, nunca audio del juego. |
| **T3.6 — Reloj, pausa/reset y telemetría** | T3.4 + T3.5 | Sustituir el mínimo fijo de 17 ms por pacing con reloj monotónico referido a los ciclos reales (25.152 ciclos a 1,5 MHz = 16,768 ms/frame), con backpressure acotado. Coordinar pausa del operador, reanudación, contexto suspendido, reset frío y halt; no reproducir cola obsoleta tras reiniciar. Medir muestras producidas/consumidas, cola, underruns acumulados, overshoot, latencia y desfase A/V usando la misma época y compensación de latencia explícita. Salida: pruebas de lifecycle y desfase, sin colas crecientes ni errores ocultos como silencio exitoso. |
| **T3.7 — Aceptación integrada y cierre** | T3.6 | Ejecutar gate de audio, regresión de controles/vídeo y partida local real con arranque, Coin, Start, acción y al menos un reset frío. Medir PCM generado durante esa misma sesión y salida del worklet; obtener confirmación humana de audio reconocible durante la partida. Publicar solo contadores/códigos y commits, actualizar este documento y mantener privados los artefactos. Si falla, registrar primer STOP/divergencia y condición necesaria para continuar; no declarar audio funcional. |

### Gates de aceptación de T3.7

- `node scripts/audio_fast_checkpoint.mjs` PASS; conservar los tests existentes y añadir los nuevos contratos a los gates pertinentes. Los **144 Node + 78 Python** son evidencia histórica de T2, no un total que deba mantenerse artificialmente.
- Regresión del engine: `node --test tests/test_v3_b2c_browser_html.mjs tests/test_v3_b2c_live_controls.mjs tests/test_v3_b2c_session_policy.mjs tests/test_v3_b2c_visible_gate.mjs tests/test_v3_b2c_port_witness.mjs tests/test_v3_b2c_pixel_probe.mjs`; ampliar solo ante cambios/fallos pertinentes. Verificar también observer/bridge/scheduler/PCM y los nuevos tests de streaming/resampling/lifecycle.
- Evidencia de procedencia: eventos de la MC6809 de **esta** sesión → lecturas Z80 → escrituras propias a ambos YM → muestras PCM → muestras consumidas por AudioWorklet. MAME queda fuera del productor y del playback. No exigir que dos contadores sean simultáneamente no nulos si una fase de juego es legítimamente silenciosa.
- Ventana estable de **al menos 120 s de partida tras el prebuffer**, con cero muestras perdidas/duplicadas y cero underruns durante esa ventana. Reportar por separado arranque y pausas deliberadas; no borrar contadores para fabricar el PASS. Cola limitada a **200 ms**, desfase A/V absoluto objetivo **≤100 ms** y deriva **≤20 ms/min**, medidos respecto a timestamps emulados y reloj de presentación. Son criterios nuevos de integración, todavía no medidos. Si no se cumplen, T3 sigue pendiente con las mediciones obtenidas.
- Coin/Start/acción y reset deben responder en la misma partida con audio; no basta la audición del WAV de T2. Si falta audición humana, la aceptación queda pendiente aunque pasen las métricas.
- Cada unidad revisable incluye commit claro y evidencia de sus pruebas. No incluir cambios ajenos del árbol de trabajo ni artefactos privados. No extender la autorización al bot o a cambios de semántica MC6809.

### Prompt para retomar en una nueva sesión

```text
Trabaja en krukmat/gng-ghidra, rama main. Antes de empezar esta nueva sesión,
pide el porcentaje restante de la ventana de 5 horas y el semanal, y espera
ambos datos conforme a las instrucciones de uso del operador. Estima el trabajo
en ambas unidades y avisa antes de agotar la ventana.

Lee íntegramente docs/agents/g5-audio-recovery-task.md. Ejecuta su continuación
T3.0–T3.7 respetando dependencias; no produzcas otro plan. T0–T2 están
implementadas en 51780ba, e5b6fdb y 1b4805b: el audio Z80→dual YM→PCM offline
es auténtico y el operador reconoció el WAV. Esto NO acredita audio en partida.
Revalida el gate sobre el HEAD actual y corrige primero cualquier regresión.

El operador YA AUTORIZÓ conectar audio al engine («pues conectalo... cual es
el problema?»). Puedes modificar el wiring del worker, servidor/UI y bundle
privado necesario para esa conexión. No vuelvas a pedir ese permiso. No
modifiques el bot ni cambies la semántica MC6809. Conserva los cambios ajenos
del árbol de trabajo y no asumas que main sigue en el mismo commit.

Implementa la cadena de la partida real: eventos MC6809 actuales → sesión Z80
persistente → dos YM persistentes → PCM continuo → AudioWorklet. Usa MAME
únicamente como oráculo diferencial local, nunca como fuente de comandos de
la partida ni de playback YM. Mantén ROM, bundle/AOT derivado, capturas,
controles, YM crudo y WAV privados en el Mac; no los envíes a agentes cloud,
HTTP público, logs compartidos ni commits. Delega solo fuentes/tests públicos.

Completa pruebas de continuidad, reloj, resampling, pausa/reset y controles;
después verifica audio audible y sincronizado durante gameplay y los criterios
de T3.7. Trabaja autónomamente con commits claros y registra las evidencias
sanitizadas en el mismo documento. No declares AUDIO_WORKING por tests, tráfico
YM o WAV offline. Entrega resultados verificables, commits y bloqueos reales.
```
