# Plan de Lancelot como personaje jugable

**20 de noviembre de 2026 · En planificación · `feature/lancelot` derivada de `main` en `7570b82`**

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

**Base demostrada en `7570b82`.** Con Chromium headless, la partida base arrancó, creó el primer autoguardado en el fotograma 496, leyó la entrada de movimiento en el 540 y recuperó el fotograma 496 tras perder una vida. El lienzo volvió a mostrar el juego y Guardar estaba disponible. El primer hito de Lancelot es mostrar en ese mismo juego cómo pierde el atuendo inicial de arquero y conserva su cara y su pelo tras el golpe.
