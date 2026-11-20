# Plan de Lancelot como personaje jugable

**20 de noviembre de 2026 · Fases 1–4 validadas · `feature/lancelot` derivada de `main` en `7570b82`**

Lancelot será seleccionable al iniciar una partida local de un jugador en web y Android. Usará las animaciones, los movimientos, los ataques y las reglas de Arthur. Arthur será la opción predeterminada y el personaje de las partidas guardadas y las cintas anteriores.

## Aspecto

| Estado del jugador | Aspecto de Lancelot |
| --- | --- |
| Al empezar o recuperar la protección | Lleva atuendo de arquero ligero, con túnica verde oliva, cuero marrón y detalles de lino crudo. |
| Tras perder la protección | Reutiliza el cuerpo y la ropa de Arthur sin armadura, con la cara y el pelo de Lancelot. |

Lancelot lleva la cara afeitada y el pelo castaño oscuro en ambos estados. El atuendo inicial corresponde al estado con armadura en las reglas del juego. Inventariar las piezas que muestran la cara y el pelo en ambos estados y las del atuendo que requieren un retoque. Reutilizar cada variante en todas las poses que compartan la pieza. El inventario del primer prototipo permitirá ajustar la estimación de arte.

## Plan de trabajo y estimación

| Fase | Horas | Resultado verificable |
| --- | ---: | --- |
| Prototipo en el juego | 2–4 | Identificar las piezas y entradas del búfer de sprites del jugador. Mostrar un aspecto provisional de arquero al empezar y conservar la cara y el pelo al perder la protección. Verificar un solapamiento con un enemigo. [Render del juego](../android/web/engine.worker.mjs#L136) · [Búfer de sprites](../src/sprite_memory.mjs) |
| Retoques visuales | 4–7 | Completar las variantes del atuendo inicial y de la cara y el pelo en ambos estados. Revisar la visibilidad sobre los fondos del juego y las poses en ambos sentidos, durante un movimiento, un salto y un ataque. [Composición del cuadro](../src/gngb_frame_renderer.mjs) |
| Selección y persistencia | 4–7 | Elegir el personaje antes de empezar. Recuperar la identidad al cargar un guardado manual o automático y al reproducir una cinta. Comprobar que las sesiones anteriores se abren con Arthur. [Opciones de partida](../games/gngb/options.mjs) · [Guardados](../src/checkpoint_format.mjs) · [Cintas](../src/v3_b3_live_tape.mjs) |
| Validación en web y Android | 4–7 | Arrancar partidas reales de Arthur y Lancelot con la misma secuencia de entradas. Comprobar ambas apariencias, la pérdida de armadura y la carga. Repetir el recorrido corto en la WebView de Android. [Prueba de recuperación existente](../scripts/ao_life_recovery_check.mjs) |
| Total | **14–25** | Estimación para una partida local de un jugador. |

La **fiabilidad de reutilizar el cuerpo y la ropa tras el golpe es alta** porque esas piezas ya existen. La de los retoques y su integración es **media** hasta contar las piezas del atuendo inicial y de la cara y el pelo en ambos estados, y confirmar qué entradas del búfer pertenecen al jugador. La prueba de solapamiento debe demostrar que los retoques se aplican únicamente a Lancelot aunque otro objeto coincida en posición o paleta.

## Comprobación en el juego

Construir los assets en un directorio temporal con `buildAssets` y servirlos en un puerto local con `createAssetServer`. Automatizar la página del juego con Playwright y su Chromium headless, sin abrir Chrome y sin MAME. [Constructor de assets](../scripts/ao_build_assets.mjs) · [Servidor local](../scripts/ao_serve.mjs)

Para aceptar el resultado, las partidas de referencia con la misma entrada deben coincidir en posición, puntuación, vidas, estado de armadura y avance. Al empezar, las diferencias en el cuadro deben limitarse al atuendo, la cara y el pelo del jugador. Tras perder la protección, solo deben diferir la cara y el pelo. Comprobar ambos estados al cruzarse con un enemigo y verificar que una carga que repone la protección devuelve el atuendo de arquero a Lancelot. Registrar el fotograma, el estado del jugador y la captura en cada punto.

## Resultado de la fase 1

**Piezas del jugador.** El juego reparte los slots del búfer de sprites dinámicamente, así que el jugador se identifica por gráfico, no por slot: `0x000–0x02F` cuerpo con armadura, `0x100–0x12F` sin armadura y `0x130–0x133`/`0x138–0x13B` el estallido de la armadura al recibir el golpe. En 21 419 fotogramas de partida de las cintas `botA`, `botB`, `botC` y `sustainA` esos gráficos solo aparecen con el grupo de paleta 0 y ningún otro objeto los usa. La armadura caída en el suelo (`0x134`/`0x13D`) es otro objeto y conserva su aspecto. [Aspecto provisional](../src/lancelot_skin.mjs)

**Cara y pelo.** El ojo es el único píxel con el color 0 en cada pose de frente. Los colores 4, 5 y 9 por encima del ojo son el pelo, que pasa a castaño oscuro; por debajo son la barba, que pasa a piel. En las poses con armadura, los colores de la armadura pasan a verde oliva, cuero marrón y lino crudo. El renderer recibe esos colores por píxel de sprite (`spriteColors`) y respeta el orden de dibujo y las prioridades del hardware. [Composición del cuadro](../src/gngb_frame_renderer.mjs)

**Comprobado.** En los 3000 fotogramas de partida de `botA`, Arthur y Lancelot difieren solo en píxeles de sprites del jugador, incluso con un zombi solapado en los fotogramas 1500 y 1502. En la página real, con Chromium headless y `?character=lancelot`, Lancelot aparece con el atuendo de arquero y sin píxeles de armadura, y tras el golpe aparece sin armadura con su pelo; Arthur no cambia. Pasó tres ejecuciones seguidas. [Prueba en la página](../scripts/lancelot_page_check.mjs) · [Sonda y comparación](../scripts/lancelot_probe.mjs) · [Tests](../tests/test_lancelot_skin.mjs)

**Resultado de la fase 2.** El cinturón (el ribete rojo de la armadura) y las cinco filas inferiores del cuerpo, las botas, pasan a cuero marrón. Con el atuendo, la parte baja de la antigua barba pasa a un cuello de lino crudo, que además le da barbilla a la cara afeitada; sin armadura pasa a piel. En 14 361 fotogramas de partida de `botA`, `botB` y `botC` no cambia ningún píxel fuera del jugador, y las 40 poses distintas de esas cintas, en ambos sentidos y con zombis solapados, se revisaron en una hoja de contacto. Los retoques siguen siendo reglas por color alrededor del ojo, no un dibujo pieza a pieza. Las poses de espaldas, como subir una escalera, no salen en esas cintas y quedan sin revisar. Las manos con el atuendo salen verde oliva, porque los guanteletes de Arthur usan los colores de la armadura y no se distinguen por color; pintarlas de piel o de cuero exige marcarlas a mano en unas 20 poses (5–8 % de la ventana de 5 h) y se descartó el 20 de noviembre.

## Selección del personaje

**Decidido el 20 de noviembre.** El personaje se elige en el diálogo de Opciones («Personaje: Arthur / Lancelot») y se aplica al reiniciar, como las demás opciones. Hay un personaje por partida y lo elige el host: en dos jugadores, por turnos o cooperativo, ambos juegan con el personaje elegido; online, el invitado ve el que eligió el host.

**Implementado.** `character` es una opción de partida y solo se escribe cuando no es Arthur, así que las partidas guardadas, las cintas y los pares sin el campo siguen siendo de Arthur. Viaja en las preferencias, en cada guardado y en las cintas exportadas, y el invitado online lo recibe con las opciones del host. El protocolo online pasa a `gng.netplay.v3` para que un invitado de una versión anterior rechace la partida en lugar de dibujar a Arthur. [Opciones de partida](../games/gngb/options.mjs) · [Preferencias](../src/ao_preferences.mjs) · [Protocolo online](../src/netplay_turns.mjs)

**Comprobado en Chromium headless.** Al elegir Lancelot, el motor arranca con él y el guardado manual registra `character: "lancelot"`; tras el golpe conserva su pelo. Al elegir Arthur no aparece ningún color de Lancelot. Tras recargar la página, la preferencia sigue en Arthur y al cargar el guardado de Lancelot vuelve Lancelot. Pasó dos ejecuciones seguidas. [Prueba en la página](../scripts/lancelot_page_check.mjs)

## Resultado de la fase 4

**WebView de Android.** Se construyó el APK aislado `org.gng.persistence.check` con `AO_APP_ID=org.gng.persistence.check bash scripts/ao_build_apk.sh` y se ejecutó `node scripts/lancelot_page_check.mjs --android` en `emulator-5554`. Pasó la secuencia completa: Lancelot con 42 píxeles del atuendo en el fotograma 923, pérdida de protección con 15 píxeles de pelo en el 1227, Arthur con 51 píxeles de armadura y ninguno de Lancelot, y carga del guardado de Lancelot. Capturas e informe: `out/android/check/lancelot-android-*.png` y `lancelot-android-page-check.json`.

**Online.** `node scripts/lancelot_online_check.mjs` enlazó dos páginas y sus workers con un puente de líneas Bluetooth simulado. El host eligió Lancelot; el invitado arrancó con `character: "lancelot"` y mostró 42 píxeles del atuendo. En otra conexión, el invitado cargó el módulo `src/netplay_turns.mjs` de la base `7570b82` (protocolo `gng.netplay.v2`); rechazó el saludo `gng.netplay.v3` por `protocol` antes de empezar la partida. Informe y captura: `out/android/check/lancelot-online-check.json` y `lancelot-online-guest.png`. La comprobación cubre la página, el saludo y los workers; el transporte de radio físico no se ejercitó.

**Cinta.** `node scripts/lancelot_page_check.mjs` pasó de nuevo en Chromium y exportó `out/android/check/lancelot-tape.json`, con `character: "lancelot"`, 1052 fotogramas y 11 cambios de entrada. `node scripts/lancelot_tape_check.mjs` la reprodujo desde el reset con el programa y el renderer de la app. El hash del fotograma 1052 coincidió con la exportación (`381aa5f4…e1b`); en el fotograma visible 907 aparecieron 42 píxeles del atuendo y 277 píxeles distintos de Arthur. Informe: `out/android/check/lancelot-tape-check.json`.

Las manos verde oliva del atuendo siguen aceptadas según la decisión del 20 de noviembre.

**Base demostrada en `7570b82`.** Con Chromium headless, la partida base arrancó, creó el primer autoguardado en el fotograma 496, leyó la entrada de movimiento en el 540 y recuperó el fotograma 496 tras perder una vida. El lienzo volvió a mostrar el juego y Guardar estaba disponible. El primer hito de Lancelot es mostrar en ese mismo juego cómo pierde el atuendo inicial de arquero y conserva su cara y su pelo tras el golpe.
