# Plan de Lancelot como personaje jugable

**20 de noviembre de 2026 · En planificación · `feature/lancelot` derivada de `main` en `7570b82`**

Lancelot será seleccionable al iniciar una partida local de un jugador en web y Android. Usará las animaciones, los movimientos, los ataques y las reglas de Arthur. Arthur será la opción predeterminada y el personaje de las partidas guardadas y las cintas anteriores.

## Aspecto

| Estado del jugador | Aspecto de Lancelot |
| --- | --- |
| Al empezar o recuperar la protección | Se ve como un arquero ligero, con túnica verde oliva, cuero marrón y detalles de lino crudo. Lleva la cara afeitada y el pelo de otro color en las poses donde se ven. |
| Tras perder la protección | Se ve exactamente como Arthur al perder la armadura y usa los mismos sprites y colores. |

El atuendo inicial corresponde al estado con armadura en las reglas del juego. Inventariar las piezas que se dibujan en ese estado y preparar variantes donde la armadura de Arthur deba verse como tela o cuero, o se vean la cara y el pelo. Reutilizar cada variante en todas las poses que compartan la pieza. El inventario del primer prototipo permitirá ajustar la estimación de arte.

## Plan de trabajo y estimación

| Fase | Horas | Resultado verificable |
| --- | ---: | --- |
| Prototipo en el juego | 2–4 | Identificar las piezas y entradas del búfer de sprites del jugador. Mostrar un aspecto provisional de arquero al empezar y el sprite de Arthur sin armadura tras el golpe. Verificar un solapamiento con un enemigo. [Render del juego](../android/web/engine.worker.mjs#L136) · [Búfer de sprites](../src/sprite_memory.mjs) |
| Retoques visuales | 4–7 | Completar las variantes del atuendo inicial y comprobar que se distingue sobre los fondos del juego. Revisar las poses en ambos sentidos y durante un movimiento, un salto y un ataque. [Composición del cuadro](../src/gngb_frame_renderer.mjs) |
| Selección y persistencia | 4–7 | Elegir el personaje antes de empezar. Recuperar la identidad al cargar un guardado manual o automático y al reproducir una cinta. Comprobar que las sesiones anteriores se abren con Arthur. [Opciones de partida](../games/gngb/options.mjs) · [Guardados](../src/checkpoint_format.mjs) · [Cintas](../src/v3_b3_live_tape.mjs) |
| Validación en web y Android | 4–7 | Arrancar partidas reales de Arthur y Lancelot con la misma secuencia de entradas. Comprobar ambas apariencias, la pérdida de armadura y la carga. Repetir el recorrido corto en la WebView de Android. [Prueba de recuperación existente](../scripts/ao_life_recovery_check.mjs) |
| Total | **14–25** | Estimación para una partida local de un jugador. |

La **fiabilidad de reutilizar el aspecto tras el golpe es alta** porque ese estado conserva los sprites originales. La del atuendo inicial y su integración es **media** hasta contar las piezas que requieren retoques en sus contornos y confirmar qué entradas del búfer pertenecen al jugador. La prueba de solapamiento debe demostrar que el atuendo se aplica únicamente a Lancelot aunque otro objeto coincida en posición o paleta.

## Comprobación en el juego

Construir los assets en un directorio temporal con `buildAssets` y servirlos en un puerto local con `createAssetServer`. Automatizar la página del juego con Playwright y su Chromium headless, sin abrir Chrome y sin MAME. [Constructor de assets](../scripts/ao_build_assets.mjs) · [Servidor local](../scripts/ao_serve.mjs)

Para aceptar el resultado, las partidas de referencia con la misma entrada deben coincidir en posición, puntuación, vidas, estado de armadura y avance. Al empezar, las diferencias en el cuadro deben limitarse al aspecto de Lancelot. Tras perder la protección, ambos personajes deben verse idénticos. Comprobar ambos estados al cruzarse con un enemigo y verificar que una carga que repone la protección devuelve el aspecto de arquero a Lancelot. Registrar el fotograma, el estado del jugador y la captura en cada punto.

**Base demostrada en `7570b82`.** Con Chromium headless, la partida base arrancó, creó el primer autoguardado en el fotograma 496, leyó la entrada de movimiento en el 540 y recuperó el fotograma 496 tras perder una vida. El lienzo volvió a mostrar el juego y Guardar estaba disponible. El primer hito de Lancelot es mostrar en ese mismo juego el aspecto inicial de arquero y el paso al aspecto de Arthur sin armadura tras el golpe.
