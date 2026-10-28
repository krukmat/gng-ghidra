# G5-AUDIO-RECOVERY — Resolver bloqueo real de audio Z80 → YM2203 → PCM

**Estado:** T0–T2 PASS / T3 BLOCKED (conexión del engine requiere autorización) · **Prioridad:** P0 · **Repo:** `krukmat/gng-ghidra` · **Rama:** `main` · **Fecha:** 2026-10-28

**Resultado actual:** audio auténtico Z80 → dual YM2203 → PCM demostrado en el laboratorio privado y reconocido por el operador. La partida sigue sin AudioWorklet conectado. El cierre verificable y el contrato mínimo de integración están al final de este documento; las evidencias de partida siguientes son históricas.

## Objetivo y definición de terminado

Resolver y demostrar el audio *original* de Ghosts ’n Goblins generado por la ejecución real del programa de sonido: entradas de la MC6809 → sound latch/reset → Z80 ejecutando `gg2.bin` → dos YM2203 → PCM no silencioso → reproducción durante una partida. **MAME es oráculo diferencial, nunca fuente de playback de registros YM.**

El entregable inmediato es desbloquear el laboratorio real Z80→YM→PCM y documentar las dependencias aún necesarias para el sonido sincronizado de gameplay. No declarar `AUDIO_WORKING` solo porque pasan tests o se genera tráfico YM: la aceptación requiere muestras PCM no nulas, tono reproducible y, para la fase jugable, AudioWorklet conectado durante ejecución real.

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
Verificar si el bridge MC6809→Z80 y la cadena PCM→AudioWorklet pueden conectarse sin tocar el engine ni el bot. **No modificar el engine/bot sin autorización explícita**; si se requiere cambio ahí, dejar un diff/contrato mínimo revisable y señalarlo como dependencia abierta. AudioWorklet requiere gesto del usuario y sincronía/underruns medidos. No llamar "jugable con audio" al WAV offline.

## Límites y seguridad

- Trabajar en `main` con commits claros; nunca publicar `gg2.bin`, MAME traces, controles privados, YM crudo, archivos `out/audio/`, fuentes AOT derivadas de ROM ni WAV privados. Todo ello permanece en el Mac bajo `out/audio/`; no enviarlo a agentes cloud. Logs compartidos: JSON sanitizado.
- No desactivar tests, falsificar `audio_working`, usar tapes YM como playback, saltar gate de privacidad ni declarar paridad MAME sin evidencia. No tocar el bot. Evitar cambios de arquitectura si una divergencia concreta basta.
- No pedir otra captura MAME ni otra ronda de barridos estáticos si los datos existentes alcanzan. Ejecutar primero el mínimo experimento discriminante.
- No generar más documentos de plan: esta tarea es el contrato de trabajo. Registrar modificaciones y resultados verificables aquí o en un único cierre breve.

## Entregables y aceptación

- **A:** regresión real **PASS** en Mac; número de tests y commit reproducibles.
- **B:** ejecución de ROM auténtica sobrepasa el primer comando sin `UNCOMPILED_PC` ni semánticas inventadas; cualquier STOP posterior queda tipificado con causa verificable.
- **C:** el YM escrito por Z80 produce **PCM no silencioso**, comprobado mediante muestras/RMS y oído; comparación MAME suficiente para identificar discrepancias críticas sin declarar paridad no probada.
- **D:** si se pide audio durante partida, validar conexión MC6809/Z80/dual YM/AudioWorklet, audible y sincronizada; o señalar exactamente el contrato/modificación de engine que requiere autorización.
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

### T3 — BLOCKED: contrato mínimo revisable, engine y bot intactos

La inspección de fuentes prueba que `src/gngb_runtime.mjs:createBoard` ya admite `onAudioEvent`, y `createGngbMainZ80Bridge` traduce latch/reset. Sin embargo, **`scripts/v3_b2c_engine_worker.mjs` no conecta el callback**, carga un runtime del bundle privado cuya capacidad debe verificarse y transmite solamente frames/inputs. **`scripts/v3_b2c_live.mjs` no conecta PCM ni crea/resume AudioContext**. El renderer C++ actual es un proceso offline, sin productor incremental de PCM. Por ello no se puede acreditar audio en esa partida sin cambiar su conexión en el engine. No se modificaron esos archivos, el runtime MC6809 ni el bot.

Contrato propuesto, no implementado ni presentado como audio jugable:

| Punto autorizado pendiente | Interfaz mínima y requisito verificable |
|---|---|
| Worker: `createBoard(...,{onAudioEvent})` | Entregar `{kind,value,cycle}` a un adaptador persistente. Avanzar Z80 hasta la frontera del evento **antes** de cambiar latch/reset, medir overshoot, preservar anclas del reloj y resetear Z80 y ambos YM cuando corresponda. Verificar/regenerar el bundle privado con el observer existente. |
| Productor dual YM continuo | Operaciones `write(tick,addr,value)`, `reset(tick)` y `renderUntil(tick)` que preserven estado entre chunks. El CLI que genera WAV no satisface este contrato. |
| Worker → UI | PCM `{sessionId,sampleRate,firstSample,samples}`, con orden y continuidad de muestras; sin transportar ROM, PCs ni YM crudo. |
| UI + AudioWorklet | Gesto real para `AudioContext.resume()`, resampling de 62.500 Hz al sample rate efectivo, reset/pausa de la misma sesión y telemetría acumulada de cola, muestras, underruns y desfase A/V. |

El pacing actual del UI (intervalo mínimo 17 ms y pausas posibles) no acredita el reloj hardware de ~16,768 ms/frame. **No hay medición ni audición durante gameplay**. La autorización necesaria queda acotada a la conexión de audio en los dos scripts del engine anteriores y su bundle; no se solicita modificar semántica MC6809 ni bot. Hasta validar ese contrato, `game_audio_live=false`, `browser_worklet_connected=false` y las declaraciones de paridad nativa siguen siendo falsas.
