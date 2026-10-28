# Plan Android offline — GnG en el teléfono, sin servidor ni red

**Fecha:** 2026-10-28 · **Rama:** `main` · **Estado:** AO-0, AO-1 y AO-2 GO; AO-3 compilado y validado en emulador, pendiente del teléfono.

**Siguiente acción:** medir AO-3 durante 2 min en el teléfono. Antes, el operador activa la depuración USB.

> **AO-3 emulador (28/10/2026; aún sin GO del teléfono).** El shell Kotlin carga los assets privados con `WebViewAssetLoader`, incluidas las extensiones `.mjs` como `text/javascript`. El APK de debug se compiló con Gradle 8.9, AGP 8.7.3, Kotlin 1.9.25 y JDK 17; `aapt dump permissions` no muestra permisos, incluido `INTERNET`. En el emulador Android 36 sin ventana ni audio, Playwright leyó `AO_READY` y 122 `AO_STATS` de la WebView durante 120,83 s: 7205 frames de CPU frente a 7205,99 esperados, 0 deslizamientos, 54,94 fps de render promedio y 41,96 fps mínimos por ventana, 7,58 ms de render por frame y arranque frío de 1,60 s; sin cierres. Informe y captura privados: `out/android/check/ao3-emulator-5554-report.json` y `ao3-emulator-device.png`. Estos números no sustituyen la medida en el teléfono.

> **AO-1 GO (28/10/2026).** [ao_resumable_runtime.mjs](../src/ao_resumable_runtime.mjs) aplica dos anclas exactas al runtime de audio y falla cerrado si alguna no aparece exactamente una vez. [test_ao_resumable_runtime.mjs](../tests/test_ao_resumable_runtime.mjs) compara g6 + overlay de audio, en una copia completa del bundle con solo el runtime parcheado: 600 llamadas `run(k)` contra un `run()`. Salen idénticos los 600 hashes de frame (los de `runFrozen` más el ciclo de CPU), los eventos y marcas de audio, el log de eventos y el ciclo final; tarda ~1 s. Control negativo: con `reset()` en cada llamada, el test falla.

> **AO-2 GO (28/10/2026).** [ao_browser_check.mjs](../scripts/ao_browser_check.mjs) sirve `out/android/assets` en 127.0.0.1 y maneja Chromium 156 headless con Playwright. La corrida completa tarda 2 min 6 s:
> - **Píxeles:** de 600 frames se dibujan 290 (del 311 al 600), con el mismo SHA-256 del RGBA que el renderer en Node sobre el bundle de audio original. Antes del frame 311 (~5,2 s) la memoria de sprites sigue desconocida y no se dibuja nada, igual que en el wrapper web.
> - **Ritmo:** 120 s, 7200 frames contra 7200,08 esperados, sin ningún re-anclaje por atraso. CPU entre 58,7 y 60,6 Hz en ventanas de 1 s; el peor atraso de un tick fue de 24,6 ms.
> - **Pantalla:** 57,9 fps dibujados de promedio y 51,7 de mínimo, contados desde el primer frame dibujable. Render 6,1 ms por frame; CPU 0,29 ms por frame; carga 0,2 s.
> - El worker vacía `state.events` en cada frame: ese log crece ~5 entradas por frame y el runtime no lo lee.
> - Tests: [test_ao_web_assets.mjs](../tests/test_ao_web_assets.mjs) 3/3; r35 sigue en 4/4. La captura y el informe quedan privados en `out/android/check/`.

**Objetivo:** un APK privado que corre en un teléfono Android el motor AOT g6, el video y el audio, sin Mac, servidor ni red. La interfaz es la misma idea mínima que la página web (pantalla, Moneda/Start, controles), adaptada al tacto.

## 0. Punto de partida (AO-0, medido el 28/10/2026)

- **Bundle g6** (`out/v3/b3/g6/frozen`): `program.mjs` de 27,6 MB con 38.084 bloques. En Node, importarlo tarda 191 ms y ocupa 38 MB de heap.
- **Velocidad en el Mac** (Node, sin pacing, 1800 frames de demo): CPU 0,194 ms/frame (86× tiempo real); renderer (`rendererInputs` + `renderGngbRgba`) 5,05 ms/frame. El renderer es el cuello de botella: en un Android de gama media se esperan unos 15 ms.
- **Bucle actual:** `run()` llama a `reset()` en cada llamada ([gngb_runtime.mjs](../src/gngb_runtime.mjs)). El worker ([v3_b2c_engine_worker.mjs](../scripts/v3_b2c_engine_worker.mjs)) frena en `onFrame` con `Atomics.wait` y lee las entradas de un `SharedArrayBuffer`. Una WebView sin aislamiento de origen no garantiza `SharedArrayBuffer`.
- **Audio actual:** eventos del MC6809 → Z80 en JS ([gngb_z80_live_session.mjs](../src/gngb_z80_live_session.mjs)) → YM2203 doble nativo (`ym2203_lab`, ymfm, por stdin/stdout; [audio_ym2203_lab.cpp](../src/audio_ym2203_lab.cpp)) → PCM a 62,5 kHz → HTTP → AudioWorklet ([processor](../src/gngb_audio_pcm_processor.mjs) + [resampler](../src/gngb_audio_resampler.mjs): colchón de 50 ms, capacidad de 200 ms, STOP al primer underrun).
- **Precedente de runtime derivado:** [gngb_audio_bundle_overlay.mjs](../src/gngb_audio_bundle_overlay.mjs) ya copia el bundle con otro `gngb_runtime.mjs`, sin tocar `program.mjs` ni `code.bin`, y verifica la secuencia de frames.
- **Ritmo real:** 25.152 ciclos a 1,5 MHz = 16,768 ms por frame.
- **Herramientas en el Mac:** SDK de Android en `~/Library/Android/sdk` (build-tools, platforms, NDK, emulador, imágenes), `adb` y OpenJDK 17 (Homebrew). Faltan Gradle y emscripten.
- El modo LAN se empezó y se descartó el 28/10; los cambios se revirtieron sin commit.

## 1. Decisiones (28/10/2026)

| Tema | Decisión | Consecuencia |
|---|---|---|
| Plataforma | **Operador:** app Android offline; sin LAN, servidor ni Mac durante el juego | Motor, video y audio corren en el teléfono |
| Shell | **Operador (28/10):** Kotlin mínimo con WebView; descargas de Gradle y emsdk autorizadas | Origen local `https://appassets.androidplatform.net`: módulos ES, Workers y AudioWorklet como en la web. Con React Native cambian solo AO-3 y AO-7 |
| Audio | **Operador:** con audio desde la v1 | AO-5 y AO-6 están en la ruta crítica |
| Motor | Copia derivada del runtime de audio con `run()` reanudable por frame | Sin `SharedArrayBuffer` ni `Atomics.wait`; equivalencia probada contra el bundle congelado (AO-1) |
| Pantalla | CPU siempre a su ritmo real; el render baja a 30 fps si no llega a 60 | Igual o mejor que la web (25 fps) |
| Red | El APK no declara el permiso `INTERNET` (AO-3 verifica que la WebView carga igual) | Android impide que la app use la red |
| Assets privados | Se generan en el Mac desde `roms/gng.zip` y `out/`, en `out/android/` | Fuera de git; el APK no se publica ni se comparte |
| Pruebas | **Operador (28/10):** todo uso de navegador, siempre con Playwright (headless). Emulador sin ventana; el teléfono, solo para medir y jugar | `playwright-core` 1.64.1 es la única dependencia de desarrollo (`package.json`) y usa el Chromium 1248 que ya estaba en la caché. Nada roba el foco ni lee el teclado del operador |
| Código existente | No se tocan el bundle congelado, el wrapper web ni la cadena G5 | Lo nuevo vive en `android/`, `scripts/ao_*`, `src/ao_*` y `tests/test_ao_*` |

## 2. Estructura

```
AO-0 (hecho) → AO-1 → AO-2 → AO-3 ─GO──→ AO-4 → AO-5 → AO-6 → AO-7 → AO-8
                               └STOP─→ AO-3b → AO-3
```

- Cada tarea empieza solo con GO de la anterior. Ante un STOP se detiene, se informa y se replanifica antes de seguir gastando.
- Orden por riesgo: lo más incierto (velocidad del renderer en el teléfono real y toolchain de Android) se mide en AO-3, antes de construir controles y audio.
- Puntos de control con el operador: fin de AO-3 (fps en el teléfono) y fin de AO-5 (equivalencia del YM en WASM). En ambos se recalibra el costo.

```
android/                     proyecto Gradle (Kotlin): MainActivity, manifest, wrapper
android/web/                 página y workers (sin datos de la ROM)
scripts/ao_build_assets.mjs  genera out/android/assets/ desde la ROM y el bundle
scripts/ao_build_apk.sh      assets + gradlew → out/android/gng.apk
out/android/                 assets privados, APK y clave de firma (ignorado por git)
```

## 3. Tareas

### AO-1 — Runtime reanudable y equivalencia

- Derivar el runtime de la app de [src/gngb_runtime.mjs](../src/gngb_runtime.mjs), que ya emite eventos de audio, con un parche textual exacto: `reset()` solo en la primera llamada, y `run(until)` vuelve al llegar al frame `until`. El parche falla si el fragmento original cambia.
- Test `tests/test_ao_resumable_runtime.mjs` (privado, requiere g6): 600 frames con el `run()` congelado contra 600 llamadas `run(k)`.
- **GO:** los 600 registros de frame (record, known, scroll, latch) y los eventos de audio son idénticos. **STOP:** cualquier diferencia.
- Costo: 4–6% de la ventana de 5 h.

### AO-2 — Motor en el navegador del Mac

- Extraer `gngbGraphics` y `rendererInputs` de [r35_t5_render_check.mjs](../scripts/r35_t5_render_check.mjs) a un módulo puro, `src/gngb_render_inputs.mjs`. El script los re-exporta y su comportamiento no cambia.
- `scripts/ao_build_assets.mjs` copia `program.mjs`, `code.bin`, `overlays.bin`, el runtime derivado y sus módulos; decodifica los gráficos de la ROM a `gfx.bin` y escribe un manifest con SHA-256.
- `android/web/engine.worker.mjs`: Worker de módulo sin `SharedArrayBuffer`, con ritmo de 16,768 ms por frame según `performance.now()` y un `run(k+1)` por frame. Renderiza y envía el RGBA (transferible) cuando toca; recibe las entradas por `postMessage`.
- `android/web/index.html`: canvas y contador (fps de render, frames de CPU por segundo, ms por frame).
- Prueba con Playwright (Chromium headless) y un servidor estático local, solo para la prueba.
- **GO:** CPU a ritmo real sostenido durante 2 min; render ≥ 30 fps; los RGBA de los primeros 600 frames coinciden con los del renderer en Node. **STOP:** cualquier diferencia de píxeles o CPU por debajo del ritmo real en el Mac.
- Costo: 10–15% de la ventana de 5 h.

### AO-3 — Shell Kotlin y medida en el teléfono

- Proyecto Gradle con wrapper. `MainActivity.kt` (~50 líneas): WebView con `WebViewAssetLoader` (MIME `text/javascript` para `.mjs`), pantalla completa inmersiva, horizontal, pantalla siempre encendida y consola de la WebView en logcat. Sin permiso `INTERNET`.
- `scripts/ao_build_apk.sh`: assets + `./gradlew assembleDebug`.
- Prueba de humo en el emulador sin ventana (`-no-window -no-audio`): la página carga y los frames avanzan. Playwright se conecta a la WebView por adb (soporte Android experimental, solo en el build debug con depuración de WebView) y lee las mismas líneas `AO_*`; logcat queda de respaldo.
- **Operador:** activa la depuración USB y conecta el teléfono; la instalación se hace con `adb`. Alternativa: copiar el APK a mano.
- **GO:** en el teléfono, CPU a ritmo real durante 2 min, render ≥ 30 fps, arranque < 5 s y sin cierres. **STOP:** con render < 30 fps, pasar a AO-3b; si la app se cierra por memoria, minificar o partir `program.mjs`.
- Costo: 10–15% de la ventana de 5 h.

### AO-3b — Renderer rápido (solo si AO-3 da STOP)

- Pre-decodificar tiles y sprites a tablas de pens y pintar por tile, con la misma salida.
- **GO:** salida píxel a píxel igual al renderer actual en los 600 frames de MAME (chequeo de r35) y en 600 frames vivos, y al menos 2× más rápido. **STOP:** cualquier píxel distinto.
- Costo: 10–20% de la ventana de 5 h.

### AO-4 — Controles y UI como la web

- Cruceta de 4 direcciones: el motor acepta una sola a la vez, como en [v3_b2c_live_controls.mjs](../src/v3_b2c_live_controls.mjs).
- Ataque y Salto se mantienen mientras se tocan. Moneda y Start mandan un pulso de 100 ms, porque la ROM solo acredita una moneda leída activa en ≤ 12 frames.
- Reiniciar (arranque en frío) y aviso de detención (`UNCOMPILED`).
- Entradas según [gngb_input_contract.mjs](../src/gngb_input_contract.mjs), sin `SharedArrayBuffer`.
- Diseño horizontal multitáctil: pantalla al centro y controles a los costados.
- El contador de estado de AO-2 tapa la línea CREDIT en pantallas angostas: pasa a una franja lateral o se oculta.
- Prueba con Playwright (Chromium headless, pantalla táctil emulada) con toques simulados.
- **GO:** cada control llega a una lectura real de la CPU (testigo de puerto), y Moneda + Start acreditan y empiezan partida 5/5 veces. **STOP:** entradas perdidas o trabadas.
- Costo: 6–10% de la ventana de 5 h.

### AO-5 — YM2203 en WASM

- **Operador:** autoriza instalar emsdk (~1 GB, fuera del repo).
- Envoltorio C con las funciones del modo `--stream` de `ym2203_lab` (escritura, lectura, avance hasta un tick y salida PCM) y la misma síntesis ymfm. El binario nativo no cambia.
- Test de equivalencia: el mismo flujo de comandos `W/R/U` (≥ 120 s de juego) entra al nativo y al WASM.
- **GO:** PCM idéntico byte a byte y render < 2 ms por frame en el Mac. **STOP:** cualquier diferencia.
- Costo: 10–15% de la ventana de 5 h.

### AO-6 — Audio en la app

- Worker de audio: la sesión Z80 en JS sin cambios y el YM en WASM producen PCM a 62,5 kHz. Va por `MessageChannel` directo al AudioWorklet de G5, también sin cambios (processor + resampler).
- El consumo del worklet marca el ritmo del motor, en vez de `performance.now()`, para que el reloj de audio no derive contra el de video.
- El audio arranca con el primer gesto: el botón Audio o el primer toque.
- **GO:** 10 min en el teléfono sin underrun ni STOP, con desfase A/V ≤ 100 ms y deriva ≤ 20 ms/min (objetivos de G5; G5 cerró con 132 ms por decisión del operador). **STOP:** underruns o A/V fuera de objetivo. El operador decide entre más colchón y recuperar el underrun; las dos opciones cambian la política G5 y necesitan su OK explícito.
- Costo: 15–25% de la ventana de 5 h.

### AO-7 — APK final e instalación

- Firma con una clave local en `out/android/`, nunca en git; nombre, icono y `versionCode`.
- `scripts/ao_build_apk.sh` reproduce el APK desde cero. Las instrucciones de instalación y juego se agregan a este documento.
- **GO:** build limpio reproducible, y en el teléfono Moneda, Start y 5 min de juego con audio. **STOP:** el APK no se instala o pierde algo respecto de AO-6.
- Costo: 4–6% de la ventana de 5 h.

### AO-8 — Cierre

- Registrar los tests `test_ao_*` en [r3-local-regression.sh](../scripts/r3-local-regression.sh), igual que hoy los que necesitan assets privados.
- Checkpoint en este documento y un commit por tarea, con OK del operador.
- Costo: 2–4% de la ventana de 5 h.

## 4. Presupuesto

| Tarea | Ventana de 5 h | Semanal (aprox.) |
|---|---|---|
| AO-1 | 4–6% | 0,5–1% |
| AO-2 | 10–15% | 1,5–2% |
| AO-3 | 10–15% | 1,5–2% |
| AO-4 | 6–10% | 1–1,5% |
| AO-5 | 10–15% | 1,5–2% |
| AO-6 | 15–25% | 2–3,5% |
| AO-7 | 4–6% | 0,5–1% |
| AO-8 | 2–4% | 0,5% |
| **Total** | **61–96%** | **8–13%** |
| AO-3b, si hace falta | +10–20% | +1,5–3% |

- Conversión supuesta: una ventana de 5 h completa equivale a ~13% del semanal. Se recalibra con el uso real al cerrar AO-1 y AO-3.
- Previsión: AO-1 a AO-4 en una ventana, y AO-5 a AO-8 en la siguiente.

## 5. Riesgos

| Riesgo | Señal | Respuesta |
|---|---|---|
| Renderer lento en el teléfono | AO-3: < 30 fps | AO-3b; si no alcanza, 20 fps |
| Memoria por los 27 MB de JS | La WebView se cierra | Minificar o partir `program.mjs` |
| `.mjs` sin MIME en `WebViewAssetLoader` | Los módulos no cargan | Handler propio con `text/javascript` |
| WebView que no carga sin permiso `INTERNET` | AO-3 no arranca | Declarar `INTERNET` sin usarlo y documentarlo |
| Deriva entre el reloj de audio y el de video | La cola de audio crece o se vacía | Ritmo guiado por el audio (AO-6) |
| Underruns en la WebView | STOP del worklet | Decisión del operador (AO-6) |
| Gradle o el plugin de Android | El build falla | Versiones fijas y JDK 17 |

## 6. Fuera de alcance de la v1

iOS, React Native, modo LAN, mando Bluetooth, partidas guardadas y publicar el APK.

## 7. Pendiente del operador

1. Activar la depuración USB del teléfono antes de AO-3.

Resuelto el 28/10: shell Kotlin, descargas de Gradle y emsdk autorizadas, y Playwright para todo uso de navegador.
