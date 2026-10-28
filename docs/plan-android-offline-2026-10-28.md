# Plan Android offline — GnG en el teléfono, sin servidor ni red

**Fecha:** 2026-10-28 · **Rama:** `main` · **Estado:** AO-0, AO-1 y AO-2 GO; AO-3 instalado en el teléfono con 50–60 fps observados por el operador; AO-4 validado con Playwright; AO-5 GO en el Mac (YM2203 WASM idéntico al nativo). CPU y arranque del teléfono siguen pendientes de medición automática.

**Siguiente acción:** el operador prueba el joystick (APK 0.6.3) en el teléfono. Medida automática en el teléfono pendiente de ADB: `node scripts/ao_android_check.mjs 600 <serial> --audio`.

**UI vigente (operador, 28/10):** pantalla centrada; Disparo y Salto apilados abajo a la izquierda, con fondo transparente y botones translúcidos. Joystick flotante abajo a la derecha (APK 0.6.1, a pedido del operador): la base aparece bajo el pulgar en una zona grande que incluye el borde del canvas; al arrastrar elige uno de 6 sectores con zona muerta e histéresis de 8°, y la base sigue al dedo si se aleja. **Operador (28/10):** las diagonales de arriba corren y saltan (Derecha/Izquierda + Salto) y arriba recto sigue siendo Arriba, para las escaleras; diagonales anchas (15–75° y 105–165°, arriba 75–105°) para que pasar de correr a saltar cueste ~20 px de pulgar ([ao_stick.mjs](../src/ao_stick.mjs); `ao_controls_check.mjs` 5/5, Game Over PASS, deslizamiento derecha→arriba y diagonales con Salto; `ao_stick_android_check.mjs` en el emulador con toques reales del SO: correr → +21 px salto 0xde → correr → soltar, PASS; APK 0.6.3); opciones arriba a la derecha. Moneda y Start vuelven en Game Over; Start cambia a Continuar cuando la ROM abre la continuación. Sonido OFF queda preparado y deshabilitado, por decisión del operador, hasta integrar el audio offline en AO-5/AO-6. Implementación: [AO-4](#ao-4--controles-y-ui-como-la-web).

> **AO-4 (28/10/2026).** [ao_touch_controls.mjs](../src/ao_touch_controls.mjs) envía puertos activos en bajo por mensajes, con una dirección a la vez y dedos independientes. Moneda y Start duran 100 ms; los pulsos repetidos tienen 200 ms de separación y se cancelan al salir o reiniciar. Start se habilita cuando la RAM real del juego indica crédito y espera de inicio o continuación. En la continuación se manda Start + Disparo; la ROM ignora un Start aislado. [ao_controls_check.mjs](../scripts/ao_controls_check.mjs), con Chromium headless y eventos táctiles reales, verificó crédito y arranque 5/5 veces (6 lecturas activas de Moneda en cada intento), lecturas de los seis controles, dirección + ataque + salto simultáneos y retorno a reposo tras soltar, cancelar o perder foco. Todos los botones y el canvas caben en 640×360. Tests Node: 14/14. Regresión de video: 290/290 frames dibujables de 600 idénticos a Node; 15 s de ritmo sin deslizamientos, render 56,99 fps de promedio y 52,63 mínimos. Informe de los cinco arranques: `out/android/check/ao4-5-starts-report.json`; última comprobación del diseño y vistas privadas: `ao4-report.json`, `ao4-menu.png`, `ao4-controls.png` y `ao4-controls-compact.png` en ese directorio. Falta la comprobación táctil por el operador en el móvil; audio corresponde a AO-5 y AO-6.

> **Corrección Game Over (APK 0.4.1).** La condición anterior `mode >= 2` ocultaba Moneda/Start durante Game Over y la continuación. `node scripts/ao_controls_check.mjs 1 --gameover` perdió una partida real (frame 3420), insertó una moneda y la continuó (frame 3720), conservando el modo principal 2: 6 lecturas activas de Moneda, 6 de Start y 6 de Disparo; crédito consumido y controles de sistema ocultos al reanudar, sin Reiniciar ni cambios de RAM. Node: 14/14. Informe y capturas privados: `out/android/check/ao4-gameover-report.json`, `ao4-game-over.png` y `ao4-continue.png`. Falta comprobar esta actualización en el móvil.

> **AO-3 emulador (28/10/2026; aún sin GO del teléfono).** El shell Kotlin carga los assets privados con `WebViewAssetLoader`, incluidas las extensiones `.mjs` como `text/javascript`. El APK de debug se compiló con Gradle 8.9, AGP 8.7.3, Kotlin 1.9.25 y JDK 17; `aapt dump permissions` no muestra permisos, incluido `INTERNET`. En el emulador Android 36 sin ventana ni audio, Playwright leyó `AO_READY` y 122 `AO_STATS` de la WebView durante 120,83 s: 7205 frames de CPU frente a 7205,99 esperados, 0 deslizamientos, 54,94 fps de render promedio y 41,96 fps mínimos por ventana, 7,58 ms de render por frame y arranque frío de 1,60 s; sin cierres. Informe privado archivado: `out/android/check/ao3-emulator-5554-120s-report.json`. Estos números no sustituyen la medida en el teléfono.

> **Humo del APK AO-4:** compilación correcta y WebView conectada con Playwright durante 45,48 s, 2711 frames frente a 2712,01 esperados, 0 deslizamientos, arranque frío de 2,56 s y sin cierres. Render del emulador SwiftShader: 33,95 fps de promedio, 26,95 mínimos; esta corrida no valida el umbral de 30 fps y requiere comprobar el APK actualizado en el teléfono. Informe, logcat y captura privados: `out/android/check/ao3-emulator-5554-report.json`, `ao3-emulator-5554-logcat.txt` y `ao3-emulator-5554-device.png`.

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
| Audio | **Operador:** botón preparado en el APK actual; definir ahora el trabajo de audio offline | AO-5 y AO-6 quedan pendientes para habilitar Sonido ON/OFF; la salida actual del Mac se conserva como referencia |
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
- Botón Sonido OFF junto a las opciones, visible durante la partida pero deshabilitado hasta AO-5/AO-6, por decisión del operador. El audio que ya funciona en la web depende del productor nativo del Mac.
- Entradas según [gngb_input_contract.mjs](../src/gngb_input_contract.mjs), sin `SharedArrayBuffer`.
- Diseño horizontal multitáctil: pantalla centrada, Disparo y Salto apilados abajo a la izquierda sin panel opaco, cruceta abajo a la derecha y opciones arriba a la derecha, por indicación del operador. Moneda y Start se ocultan y deshabilitan durante la partida según el estado observado de la ROM; vuelven al salir de ella.
- Game Over conserva el modo principal 2: [ao_game_state.mjs](../src/ao_game_state.mjs) reconoce el texto conocido de la capa FG y las fases de cierre/continuación para volver a mostrar las opciones. La fase 4 acepta continuar con crédito, Start y Disparo simultáneos; el botón **Continuar** manda ambos puertos durante 100 ms. Los pulsos de Start solo se usan en la pantalla de inicio. Toda detección observa snapshots; no escribe RAM ni reinicia la CPU.
- El contador de estado de AO-2 tapa la línea CREDIT en pantallas angostas: pasa a una franja lateral o se oculta.
- Prueba con Playwright (Chromium headless, pantalla táctil emulada) con toques simulados.
- **GO:** cada control llega a una lectura real de la CPU (testigo de puerto), y Moneda + Start acreditan y empiezan partida 5/5 veces. **STOP:** entradas perdidas o trabadas.
- Costo: 6–10% de la ventana de 5 h.

Para jugar con el APK de AO-4: esperar a que Moneda se habilite, tocar **Moneda**, esperar a que se habilite **Start** y tocarlo. Moneda y Start desaparecen durante la partida y vuelven en **Game Over**. Para seguir: tocar **Moneda** y luego **Continuar** cuando se habilite durante la cuenta atrás. Mantener los controles de movimiento, Disparo y Salto mientras se quiera accionarlos; admiten varios dedos. **Reiniciar** hace un arranque en frío y vuelve a mostrar Moneda/Start. Instalar la actualización privada sobre el APK anterior conserva la firma local de desarrollo.

### AO-5 — YM2203 en WASM

> **AO-5 GO en el Mac (28/10/2026).** [ao_build_audio_wasm.sh](../scripts/ao_build_audio_wasm.sh) compila [ao_ym2203_wasm.cpp](../src/ao_ym2203_wasm.cpp) con emsdk 4.0.15 (`~/emsdk`) y ymfm `81aec25` a un `.wasm` independiente de 32 KB, sin glue de emscripten, hilos ni Node. Lo carga [ao_ym2203_wasm.mjs](../src/ao_ym2203_wasm.mjs), el mismo en Node y en un Worker; solo importa tres funciones WASI de stdio, que son inalcanzables y, si se llamaran, darían STOP. Recompilar da el mismo SHA-256. [ao_audio_commands.mjs](../src/ao_audio_commands.mjs) replica `consumeBatch` del productor web sin el proceso nativo y servirá a AO-6. **Hallazgo:** el nativo arm64 fusiona la mezcla en cuatro `fmadd`; la primera versión WASM, con redondeo doble, difería en ±1 LSB en el 0,18 % de las muestras. El adaptador usa `std::fma` explícito; el nativo no se tocó. [ao_audio_wasm_check.mjs](../scripts/ao_audio_wasm_check.mjs): 7500 frames (125,8 s) del motor AOT + Z80 con Moneda, Start, partida, Game Over, continuación y regreso a la demo. 1.286.586 escrituras YM, 1 reset, 26 eventos en la frontera y 7500 bloques. **PCM idéntico byte a byte** al nativo, bloque por bloque y también reagrupado en bloques de 7 frames; índices continuos; síntesis WASM de 0,15 ms por frame; memoria de 2 MB. [test_ao_ym2203_wasm.mjs](../tests/test_ao_ym2203_wasm.mjs), sin ROM: troceo, resets, eventos en la frontera y errores iguales al nativo, 3/3. Comandos, WAV e informe privados: `out/android/check/ao5-ym-commands.txt`, `ao5-pcm.wav` y `ao5-report.json`. Operador: comprobado en el MacBook, funciona como se espera. Falta medir en el teléfono, dentro de AO-6.

**Resultado:** un productor PCM que funcione dentro de un Worker de la WebView. La web del Mac usa [gngb_live_audio_worker.mjs](../scripts/gngb_live_audio_worker.mjs), que ejecuta un proceso nativo y entrega PCM por HTTP; ese transporte debe sustituirse en Android.

1. **AO-5.1 — Compilación reproducible.** Instalar emsdk fuera del repo (~1 GB, descarga ya autorizada). Fijar versión concreta y opciones antes de compilar; conservar JDK 17. Usar el mismo ymfm que [audio_ym_native_build.sh](../scripts/audio_ym_native_build.sh): commit `81aec25ccbb98f4873a255f7551ac4dadac59b4a`. Agregar `scripts/ao_build_audio_wasm.sh`; producir el módulo ES y `.wasm` en `out/android/`, con sus hashes y versiones. Compilar para un Worker normal, sin hilos, `SharedArrayBuffer` ni dependencias de Node.
2. **AO-5.2 — API incremental.** Agregar un adaptador C/C++ del sintetizador de [audio_ym2203_lab.cpp](../src/audio_ym2203_lab.cpp): crear/destruir una instancia doble YM2203, escribir un registro con tick, aplicar reset con tick y avanzar hasta una frontera exclusiva devolviendo PCM. Preservar reloj maestro de 12 MHz, chips de 1,5 MHz, fidelidad mínima, mezcla, saturación y PCM mono Int16 a 62.500 Hz. En el protocolo nativo `W` escribe, `R` hace reset y `U` avanza/entrega PCM; `R` no es una lectura. Mantener índices de muestra, orden de eventos y validaciones de frontera; un reset del chip no rebobina la línea temporal. Mantener el ejecutable nativo como referencia.
3. **AO-5.3 — Equivalencia y costo.** Agregar `scripts/ao_audio_wasm_check.mjs`. Capturar ≥ 120 s de comandos reales, incluidos Moneda/Start, juego, efectos y resets; alimentar la misma secuencia al nativo y al WASM. Comparar índices, cantidad y bytes de cada bloque PCM, incluidos límites de muestra, eventos en la frontera y bloques consecutivos. Medir la síntesis por frame en el Mac y registrar memoria. Guardar comandos, PCM y resultados en `out/android/check/`.

**GO:** PCM idéntico byte a byte, índices continuos y síntesis < 2 ms por frame en el Mac. **STOP:** cualquier diferencia; resolver antes de conectar el botón. Este GO no sustituye la medida en el teléfono.

Costo: 10–15% de la ventana de 5 h; 1,5–2% semanal. Al cerrar AO-5 se recalibra AO-6 con el costo medido.

### AO-6 — Audio en la app

> **Cambio de política G5 en Android (operador, 28/10/2026), tras ver que el audio se desactivaba solo en el teléfono:** el objetivo de cola sube de 5 a 8 frames (134 ms; la capacidad sigue en 200 ms y el prebuffer en 50 ms). Un underrun con Sonido ON abre sola una sesión nueva, con un máximo de 5 por minuto; si se supera, se apaga como antes y muestra el motivo. Hasta que una salida nueva consume, el motor no produce más que el objetivo por delante, durante como mucho 1 s; así se evita el desbordamiento que se vio en el emulador. Headless: una traba de 400 ms del motor (gancho `?audioTest`) se recupera sola, sin STOP. Emulador, 2×90 s: Sonido ON todo el tiempo, 1 y 2 recuperaciones y A/V de −14 a +7 ms de media.
>
> **AO-6 aceptado por el operador en el teléfono (28/10/2026): el sonido está bien.** Sin medida automática de CPU/A/V en el teléfono (sin ADB).
>
> **AO-6 en el Mac y el emulador.**
> - **Productor:** [audio.worker.mjs](../android/web/audio.worker.mjs) recibe un lote por frame del motor y lo pasa por Z80, [ao_audio_commands.mjs](../src/ao_audio_commands.mjs) y WASM. Corre desde el arranque con Sonido ON u OFF y solo envía PCM mientras hay una sesión de salida.
> - **Worklet:** [audio.worklet.mjs](../android/web/audio.worklet.mjs) es nuevo y la web no se modificó. Reutiliza [gngb_audio_resampler.mjs](../src/gngb_audio_resampler.mjs) con 50 ms de prebuffer, 200 ms de capacidad y STOP al primer underrun. Descarta los paquetes de sesiones viejas y cada ~10,7 ms informa al motor la muestra consumida.
> - **Motor:** [engine.worker.mjs](../android/web/engine.worker.mjs) con salida activa sigue la muestra consumida más un objetivo de 5 frames (84 ms); al abrir la sesión adelanta esos 5 frames de una vez. Presenta el frame que se está oyendo y vuelve al reloj de AO-2 sin saltos cuando falta el informe.
> - **Latencia de presentación:** se corrige en lazo cerrado con `getOutputTimestamp`. El emulador informa 107 ms de latencia, pero `getOutputTimestamp` indica unos 250 ms más.
> - **Ciclo de vida:** OFF pone la ganancia en cero; el segundo plano suspende el contexto y cierra la sesión; Reiniciar reconstruye el Z80 y los chips.
>
> **Pruebas:**
> - [ao_audio_check.mjs](../scripts/ao_audio_check.mjs), headless, **GO**: productor activo con OFF sin enviar nada; ON a mitad de partida; ON/OFF ×3 con la misma sesión; segundo plano con contexto suspendido y sesión nueva al volver, simulado porque las pestañas headless no se ocultan; Reiniciar seguido de Moneda/Start y 59 s estables. CPU a 58,65–60,58 Hz, render de 53,6 fps de media (mínimo 40,7), cola entre 3711 y 5028 muestras, 0 underruns, A/V de −0,1 ms de media (máximo 34) y deriva de 0,75 ms/min. Síntesis: 0,5 ms por frame.
> - [test_ao_audio_worklet.mjs](../tests/test_ao_audio_worklet.mjs) 4/4 (sesiones viejas, underrun, hueco, desbordamiento); tests AO 21/21.
> - Regresión: AO-2 PASS (píxeles y ritmo); AO-4 5/5 y Game Over + Continuar PASS.
> - **Emulador** (`ao_android_check.mjs --audio`, SwiftShader): el WebView carga el WASM (`application/wasm`) y el Z80, sintetiza a ~0,8–1,4 ms por frame y arranca en frío en 1,6–2,0 s. En 2 corridas de 60 s, la primera salió limpia (A/V de −21 a +6 ms de media). La segunda tuvo un **underrun a los 60 s**, cuando el motor del emulador se trabó (74 ms de CPU en una ventana de 1 s). Render de 30 fps con mínimos de 23–26: el emulador no valida ese umbral.
> - **Riesgo abierto:** una pausa de más de ~84 ms en el teléfono vacía la cola. Subir el objetivo (p. ej. 8 frames, 134 ms, dentro de la capacidad de 200 ms) requiere el OK del operador.
>
> APK 0.6.0 privado en `out/android/gng.apk`. Informes: `out/android/check/ao6-report.json` y `ao3-emulator-5554-report.json`.

**Resultado:** Sonido ON/OFF habilitado, con música y efectos generados en el teléfono durante la partida, sin conexión al Mac. Depende del GO de AO-5.

1. **AO-6.1 — Assets y eventos reales.** Extender [ao_build_assets.mjs](../scripts/ao_build_assets.mjs) con la ROM Z80 verificada mediante [audio_extract_sound_rom.py](../scripts/audio_extract_sound_rom.py), los módulos Z80 y el productor WASM. Servir `.wasm` como `application/wasm` y comprobar la carga desde `WebViewAssetLoader`. Conectar `onAudioEvent` en [engine.worker.mjs](../android/web/engine.worker.mjs); enviar lotes de `SOUNDLATCH_WRITE`/`AUDIO_RESET_LINE` con `throughCycle` creciente antes de vaciar los logs de frame. Conservar la conversión de ciclos MC6809 a ticks maestros (×8), la frontera exclusiva y el orden del productor actual.
2. **AO-6.2 — Producción local.** Agregar `android/web/audio.worker.mjs`: reutilizar [createZ80LiveSession](../src/gngb_z80_live_session.mjs) y sus reglas de ejecución/resolución, sustituyendo el proceso nativo por la API WASM. La sesión Z80 y los chips nacen con el arranque del motor y avanzan aunque Sonido esté OFF; antes de activar la salida se descarta el PCM ya pasado. Así, activar sonido a mitad de partida conserva el estado musical actual. Transferir bloques `{sessionId, firstSample, sampleRate, samples}` por mensajes, con colas acotadas y confirmación de avance; preservar los límites y STOP del productor actual. Verificar los imports generados del Z80 en la WebView.
3. **AO-6.3 — Salida y reloj.** Reutilizar [processor](../src/gngb_audio_pcm_processor.mjs), [resampler](../src/gngb_audio_resampler.mjs) y el contrato de [worklet_sink](../src/gngb_audio_worklet_sink.mjs). Conectar el Worker al AudioWorklet mediante un `MessageChannel`; el adaptador del puerto y la telemetría de consumo requieren cambios acotados en el transporte existente. Convertir 62,5 kHz a la frecuencia real del `AudioContext`, conservando 3.125 muestras de prebuffer (50 ms) y capacidad de 12.500 (200 ms). Con salida activa, los contadores de muestras consumidas gobiernan los frames de CPU y el límite de producción; `requestAnimationFrame` presenta el último frame. Agregar avisos de consumo/demanda cada 10–20 ms: el informe actual cada 250 ms sirve de diagnóstico, pero llega tarde para mantener esa cola. Antes de activar audio se conserva el reloj de AO-2; el cambio de reloj se ancla al ciclo actual, sin saltos ni reinicios. Medir consumo, cola y frames con una referencia temporal común.
4. **AO-6.4 — Botón y ciclo de vida.** Estado inicial Sonido OFF. Habilitar el botón cuando el productor esté listo y las capacidades de audio estén disponibles; crear/reanudar el `AudioContext` desde el toque explícito y mostrar ON solo cuando corra. OFF aplica ganancia cero mientras la salida sigue consumiendo; ON restaura la ganancia sin repetir audio viejo, resetear la CPU ni perder controles. Al pasar a segundo plano, suspender y limpiar la cola; al volver, usar una sesión de salida nueva y prebuffer del estado actual, descartando mensajes anteriores. Si el contexto está suspendido, mantener el avance del juego con el reloj de AO-2 y descartar PCM pasado. Reiniciar el juego reconstruye las sesiones y los chips. Un error de audio silencia y muestra el motivo; un underrun sigue siendo STOP de audio, sin recuperación automática.
5. **AO-6.5 — Pruebas e integración.** Agregar `scripts/ao_audio_check.mjs` con Playwright headless y captura de PCM/diagnósticos: verificar audio no nulo ante comandos reales, ON/OFF repetido, activación en mitad de partida, Moneda/Start/Continuar, Reiniciar, suspensión/reanudación y rechazo de sesiones viejas. Registrar `AO_AUDIO_READY`, `AO_AUDIO_STATS` y `AO_AUDIO_STOP` tanto en consola como en logcat. Integrar la compilación WASM en `ao_build_apk.sh` y subir `versionCode`. Humo en emulador `-no-window -no-audio`: valida producción y consumo sin salida audible. La escucha y aceptación final se hacen en el teléfono, con el APK local y modo avión.

**GO:** equivalencia de AO-5 y regresión de CPU/video/controles; 10 min en el teléfono con música y efectos audibles, ON/OFF correcto, sin underrun, STOP ni cierres; CPU a ritmo real y render ≥ 30 fps. Desfase A/V ≤ 100 ms y deriva ≤ 20 ms/min (objetivos de G5; G5 cerró con 132 ms por decisión del operador, lo que no aprueba esa excepción para Android). Medir el arranque frío del APK con audio y conservar el umbral AO-3 de < 5 s.

**STOP:** PCM discontinuo, colas que crecen, underruns, pérdida de controles o A/V fuera de objetivo. Si el render cae por debajo de 30 fps, volver a AO-3b. Aumentar el colchón o recuperar underruns cambia la política G5 y requiere el OK explícito del operador; las pruebas registran el fallo con los parámetros vigentes.

Costo: 15–25% de la ventana de 5 h; 2–3,5% semanal. AO-5 + AO-6 suman 25–40% y 3,5–5,5% semanal; AO-7 conserva su presupuesto separado para el cierre del APK.

**Necesario del operador:** instalar el APK nuevo y hacer la escucha de 10 min en el móvil. La instalación manual sirve sin modo de depuración; para medir la WebView con Playwright y recoger CPU/A/V/logcat del teléfono hace falta ADB por USB o Wi-Fi. Los assets de ROM, módulos generados a partir de ella, PCM, informes y APK quedan privados en `out/`; el manifiesto conserva la ausencia de permiso `INTERNET`.

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
| WebView que no carga assets locales | AO-3 no arranca | Corregir rutas y MIME de `WebViewAssetLoader`; conservar la ausencia de permiso `INTERNET` |
| Deriva entre el reloj de audio y el de video | La cola de audio crece o se vacía | Ritmo guiado por el audio (AO-6) |
| Underruns en la WebView | STOP del worklet | Decisión del operador (AO-6) |
| Gradle o el plugin de Android | El build falla | Versiones fijas y JDK 17 |

## 6. Fuera de alcance de la v1

iOS, React Native, modo LAN, mando Bluetooth, partidas guardadas y publicar el APK.

## 7. Pendiente del operador

1. Instalar la actualización de AO-4 y comprobar el tacto en el teléfono.
2. Para completar la medición automática de AO-3, conectar ADB por USB o depuración inalámbrica. La instalación manual ya está comprobada; el operador observó 50–60 fps, sin una medida automática de CPU ni de arranque.

Resuelto el 28/10: shell Kotlin, descargas de Gradle y emsdk autorizadas, y Playwright para todo uso de navegador.
