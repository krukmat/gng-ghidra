# Checkpoint de sesión (guardado rápido) — web, base común para Android

**Fecha:** 2026-10-29 · **Estado:** web GO · Android pendiente (mismo formato y piezas).

**Decisiones del operador (29/10/2026):** primero solo web, con estado de audio exacto y un único guardado rápido; Android viene después, así que las piezas y el formato son comunes desde el principio. Hay una excepción explícita al «ENGINE CONGELADO» del [plan del bot](agents/gng-bot-gameplay-plan-2026-10-27.md#L91) para esta función de usuario. El runtime congelado no se modifica: se deriva con parches anclados. El bot no usa estas rutas.

## Uso (web)

`node scripts/v3_b2c_live.mjs --serve` → botones **Guardar `G`** y **Cargar `C`**. El checkpoint se guarda en `out/web-checkpoint/quick.json`, es privado y no se versiona: la RAM contiene copias de código de la ROM. Cada guardado reemplaza al anterior. Mientras la CPU está en la pausa de moneda o detenida, no se puede guardar.

## Diseño

- **Punto de guardado:** fin de un frame, entre instrucciones (`onAudioComplete` cuando sube el número de frames). El servidor pide el guardado con una bandera compartida, y el worker exporta en el siguiente borde.
- **Carga = arranque en frío desde el estado guardado**, igual que `/reset`: workers nuevos de motor y de audio. Nunca se reescribe un motor en marcha.
- **Formato `gng.checkpoint.v1`** ([checkpoint_format.mjs](../src/checkpoint_format.mjs), sin imports de Node): JSON con `Uint8Array` en base64. Contiene:
  - `cpu`: CPU, RAM, máscaras, paleta, DMA, scroll y latch.
  - `audio`: Z80, bus, eventos encolados y bloques resueltos.
  - `ym`: los dos YM2203, en bytes.
  - `tape`: cambios de puertos desde el reset.
  - `programSha256`: un checkpoint de otro programa AOT se rechaza.
- **Reproducible desde el reset:** la cinta de la sesión cargada empieza con la del checkpoint, así que `GET /tape` + [v3_b3_live_replay.mjs](../scripts/v3_b3_live_replay.mjs) siguen funcionando.

| Pieza | Archivo | Plataforma |
|---|---|---|
| `exportState`/`importState` de la placa | [checkpoint_runtime.mjs](../src/checkpoint_runtime.mjs) (parche anclado, compatible con `resumableRuntime`) | ambas |
| Estado Z80 y lotes de audio | [gngb_z80_sound_bus](../src/gngb_z80_sound_bus.mjs), [scheduler_lab](../src/gngb_z80_scheduler_lab.mjs), [live_session](../src/gngb_z80_live_session.mjs), [ao_audio_commands](../src/ao_audio_commands.mjs) | ambas |
| Bytes de los YM2203 (`GYM1` + `save_restore` de ymfm, little-endian explícito) | [ym2203_checkpoint.h](../src/ym2203_checkpoint.h) | ambas |
| Comandos `S`/`L` del proceso nativo y su cliente | [audio_ym2203_lab.cpp](../src/audio_ym2203_lab.cpp), [gngb_ym_native_stream.mjs](../src/gngb_ym_native_stream.mjs) | web |
| Bundle con runtime parcheado | `prepareAudioBundle(…,{transform})` ([overlay](../src/gngb_audio_bundle_overlay.mjs)) | web |
| Rutas `GET /checkpoint`, `POST /checkpoint/save`, `POST /checkpoint/load` y botones | [v3_b2c_live.mjs](../scripts/v3_b2c_live.mjs), workers de [motor](../scripts/v3_b2c_engine_worker.mjs) y [audio](../scripts/gngb_live_audio_worker.mjs) | web |

El worker de audio web ahora usa `createAudioCommandSource`, el mismo núcleo que Android, en vez de su copia de las reglas de lote.

## Evidencia

- [test_checkpoint_runtime.mjs](../tests/test_checkpoint_runtime.mjs): la placa se restaura en el frame 450 y sigue hasta el 900 con hashes de frame, eventos de audio y ciclo final idénticos a una corrida continua. Control negativo: un byte de paleta alterado diverge.
- [test_checkpoint_audio.mjs](../tests/test_checkpoint_audio.mjs): CPU, Z80 y YM nativo se guardan en el frame 700 con música sonando. Después de restaurar, los comandos YM y el PCM hasta el frame 1500 son idénticos byte a byte. Control negativo: un sintetizador nuevo no da el mismo resultado.
- [checkpoint_web_check.mjs](../scripts/checkpoint_web_check.mjs), con Playwright sin ventana: Moneda y Start, guardar con `G` en plena fase 1 (frame 1217), seguir jugando, cargar con `C`, moverse y disparar. **PASS:** la cinta de la sesión cargada se reproduce desde el reset con `PASS_SAME_FRAME_HASH`. El audio queda en `PLAYING`, sin STOP y sin samples faltantes.
- Tests relacionados de AO, audio, Z80, B2C y cinta en vivo: 273/273.

## Pendiente para Android

1. Exportar `ao_ym_save`/`ao_ym_load` en [ao_ym2203_wasm.cpp](../src/ao_ym2203_wasm.cpp) con `ym2203_checkpoint.h` y agregarlos a `EXPORTS` en `ao_build_audio_wasm.sh`. Probar que el blob WASM sea idéntico al nativo en el mismo punto.
2. Aplicar `checkpointRuntime` después de `resumableRuntime` en [ao_build_assets.mjs](../scripts/ao_build_assets.mjs).
3. En la WebView: guardar en IndexedDB y cargar reconstruyendo los workers (como Reiniciar). El AO-6 ya reconstruye el Z80 y los chips.
