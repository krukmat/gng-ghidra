# Plan de Lancelot como personaje jugable

**20 de noviembre de 2026 · En planificación · `feature/lancelot` derivada de `main` en `7570b82`**

Lancelot será seleccionable al iniciar una partida local de un jugador en web y Android. Usará las animaciones, los movimientos, los ataques y las reglas de Arthur. Arthur será la opción predeterminada y el personaje de las partidas guardadas y las cintas anteriores.

## Aspecto

| Estado del jugador | Aspecto de Lancelot |
| --- | --- |
| Con armadura | Usa los mismos sprites de Arthur, con los mismos colores. |
| Con ropa, tras perder la armadura | Conserva la silueta y las poses de Arthur. Lleva la cara afeitada, el pelo de otro color y ropa de arquero ligero. La túnica corta es el detalle propuesto para distinguirlo. |

Inventariar las piezas gráficas donde se ven la cara, el pelo o la ropa. Preparar una variante por cada pieza que requiera cambios y reutilizarla en todas las poses que la compartan. El inventario del primer prototipo permitirá ajustar la estimación de arte.

## Plan de trabajo y estimación

| Fase | Horas | Resultado verificable |
| --- | ---: | --- |
| Prototipo en el juego | 2–4 | Identificar qué piezas y entradas del búfer de sprites pertenecen al jugador en cuadros con y sin armadura. Mostrar un retoque provisional tras recibir un golpe y verificar un solapamiento con un enemigo. [Render del juego](../android/web/engine.worker.mjs#L136) · [Búfer de sprites](../src/sprite_memory.mjs) |
| Retoques visuales | 2–4 | Aplicar las variantes a las piezas inventariadas. Revisar las poses en ambos sentidos y durante un movimiento, un salto y un ataque. [Composición del cuadro](../src/gngb_frame_renderer.mjs) |
| Selección y persistencia | 4–7 | Elegir el personaje antes de empezar. Recuperar la identidad al cargar un guardado manual o automático y al reproducir una cinta. Comprobar que las sesiones anteriores se abren con Arthur. [Opciones de partida](../games/gngb/options.mjs) · [Guardados](../src/checkpoint_format.mjs) · [Cintas](../src/v3_b3_live_tape.mjs) |
| Validación en web y Android | 4–7 | Arrancar partidas reales de Arthur y Lancelot con la misma secuencia de entradas. Comprobar ambas apariencias, la pérdida de armadura y la carga. Repetir el recorrido corto en la WebView de Android. [Prueba de recuperación existente](../scripts/ao_life_recovery_check.mjs) |
| Total | **12–22** | Estimación para una partida local de un jugador. |

La **fiabilidad del retoque visual es alta** porque solo afecta a un subconjunto de piezas del estado sin armadura. La **fiabilidad de la integración es media** hasta que el prototipo confirme la relación entre el jugador y sus entradas en el búfer. El render recibe piezas con posición, orientación y paleta. La prueba de solapamiento debe demostrar que el retoque afecta únicamente a Lancelot aunque otro objeto coincida en posición o paleta.

## Comprobación en el juego

Construir los assets en un directorio temporal con `buildAssets` y servirlos en un puerto local con `createAssetServer`. Automatizar la página del juego con Playwright y su Chromium headless, sin abrir Chrome y sin MAME. [Constructor de assets](../scripts/ao_build_assets.mjs) · [Servidor local](../scripts/ao_serve.mjs)

Para aceptar el resultado, las partidas de referencia con la misma entrada deben coincidir en posición, puntuación, vidas, armadura y avance. La captura con armadura debe ser idéntica. En la captura con ropa, los cambios deben limitarse a los píxeles visibles de Lancelot, incluso cuando se cruza con un enemigo. Verificar que una carga conserva el personaje y muestra la armadura cuando el juego la repone. Registrar el fotograma, el estado del jugador y la captura en cada punto.

**Base demostrada en `7570b82`.** Con Chromium headless, la partida base arrancó, creó el primer autoguardado en el fotograma 496, leyó la entrada de movimiento en el 540 y recuperó el fotograma 496 tras perder una vida. El lienzo volvió a mostrar el juego y Guardar estaba disponible. El primer hito de Lancelot es demostrar en ese mismo juego el cambio de aspecto al perder la armadura.
