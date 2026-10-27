# B6 — Práctica manual del agua mediante handoff

Rama: main. Motor B3_G4 original. Estado: ROM_FREE_PASS / MAC_LIVE_PENDING.

## Objetivo

Llegar automáticamente al tramo anterior al islote móvil y ceder los
controles al usuario para practicar el salto sin jugar manualmente
todo el principio del nivel 1.

**NO se teletransporta al personaje, ni se restaura RAM ni se cambia el
motor.** Se reproduce una cinta de controles original desde reset.

**Limitación principal:** las capturas existentes muestran a Arthur
cerca de la orilla alrededor del frame 2720, pero NO permiten
certificar que el demonio haya sido derrotado. La cinta peak podría
haberlo dejado atrás. El resultado se etiqueta como checkpoint
aproximado de la orilla, no como boss kill verificado.

## Comando en el Mac desde gng-ghidra

    git pull --ff-only && node bot/practice-water.mjs

El programa usa como fuente local la cinta existente
out/bot/late-sweep/trial-6.json y requiere B3_G4.

1. Comprueba que el puerto 18609 está libre.
2. Lanza scripts/v3_b2c_live.mjs --serve, espera el primer VBlank
   válido y abre http://127.0.0.1:18609.
3. Inicia una grabación con el recorder existente (si ffmpeg
   está instalado).
4. Reproduce la cinta por POST /input, controla la sesión, el lag
   y cualquier HALT.
5. Cerca del frame 2720 libera todos los controles con POST /release.
6. Cuando muestra BOT_PRACTICE_PLAY, el usuario maneja Arthur con
   flechas, Z ataque y X salto.
7. Ctrl+C en la terminal guarda evidencias y cierra solo el motor
   que arrancó esta sesión.

La grabación queda en out/bot/gameplay-.../review.zip; la ruta final
se comunica como BOT_PRACTICE_REVIEW_ZIP. Los reportes y las cintas
auxiliares quedan privados en out/bot/practice-water-.../.

## Seguridad y límites

- No modifica engine, AOT, compilador, renderizador ni bundles.
- No necesita memoria privilegiada, estados guardados ni nuevas ROM.
- Los eventos se aplican por frame aproximado a la interfaz live; la
  ejecución es menos determinista que el replay offline.
- Ante diferencia de sesión, HALT, lag mayor que ocho frames,
  servidor ocupado o cinta/bundle ausentes: STOP, no falso éxito.
- El motor no ofrece pausa arbitraria a mitad del juego: el handoff
  es en caliente y Arthur debe estar en sitio seguro.
- Si el punto 2720 es demasiado tardío, se puede adelantar:

    node bot/practice-water.mjs 2700

- Para certificar un punto justo después de matar al demonio, hay
  que capturar una cinta donde su muerte realmente se compruebe.
- Si ffmpeg no está disponible, la práctica continúa sin MP4.

## Test y aceptación

5/5 pruebas ROM-free de la política de playback/handoff PASS en
harness V8. Falta validación live en Mac con la ROM privada.

GO del bloque cuando el usuario vea Arthur controlable ante el agua,
pueda intentar el salto y el handoff esté libre de HALT/lag.


## B6.1 — Corrección de GAME OVER en el handoff (27/10/2026)

Observación del usuario: el runner informó handoff exacto en frame 2720,
inputLagFrames=0, pero al abrir el juego la pantalla ya mostraba
GAME OVER. Por tanto, **NO se había validado ningún checkpoint real**:
el frame por sí solo no prueba que Arthur siga vivo, y el motor
continuaba corriendo mientras se pasaba a la ventana de juego.

**Corrección publicada en main**:
- bot/live/practice-witness.mjs compara los píxeles del servidor con la
  imagen original del replay peak capturada localmente.
- Requiere además que se detecten la orilla y el islote con
  geometría compatible en los dos frames. Una pantalla GAME OVER
  o escena divergente se **rechaza** como checkpoint.
- bot/live/practice-handoff-ui.mjs sirve una pantalla de entrenamiento
  independiente en http://127.0.0.1:18610.
- Al hallar la escena adecuada el runner envía POST /release y
  congela **solo el proceso del motor hijo** con SIGSTOP (sistema
  operativo, NO modificación de la CPU o ROM). Se imprime
  BOT_PRACTICE_PAUSED. El juego NO avanza hasta el clic explícito
  en Reanudar y jugar desde la pantalla del navegador, que ejecuta
  SIGCONT y coloca el foco en el iframe del juego.
- Abortos, Ctrl+C y salida restauran siempre SIGCONT antes de
  terminar el proceso; evita dejar un hijo congelado.
- El grabador dispone ahora de --practice para sobrevivir a la pausa.
- Tests ROM-free de semejanza de escenas, incluyendo GAME OVER, y
  tests del servidor de botón/autorización de reanudación.

### Comando de uso

**Primero terminar cualquier práctica anterior** con Ctrl+C
en su terminal. Luego desde el directorio gng-ghidra:

    git pull --ff-only && node bot/practice-water.mjs

Si llega al punto de entrega, el navegador abrirá su UI en el
puerto 18610. **No pulses nada durante la reproducción automática.**
Cuando aparezca Reanudar y jugar, haz clic; comienza entonces la
práctica con flechas, Z ataque, X salto. Ctrl+C guarda evidencias.

Se requiere la imagen privada previamente generada
out/bot/b2-water-peak/frames.png. Si falta, se detiene con
BOT_PRACTICE_REFERENCE_MISSING_RUN_CAPTURE_WATER.

Si el gameplay live diverge demasiado del replay offline, **NO**
se simula ni se fuerza el checkpoint: aparece
BOT_PRACTICE_SCREEN_MISMATCH_NOT_SAFE_TO_HANDOFF, y el fichero
visual-witness.json en el directorio BOT_PRACTICE_DIR recoge
métricas del desajuste. En este caso se necesita inspeccionar la
ejecución live y posiblemente elegir otro prefijo reproducible.

**Limitación no resuelta:** incluso si la pantalla coincide
geométricamente, esto no demuestra por sí solo que el demonio haya
muerto ni acredita la vida de Arthur. Continúa como checkpoint
visual candidato, no como post-boss certificado. La sincronización
y la pausa necesitan una ejecución real de validación en el Mac.


### Evidencias nuevas ante un mismatch

El runner también guarda dos imágenes PNG privadas bajo
BOT_PRACTICE_DIR: live-witness.png (pantalla real) y
reference-witness.png (captura offline del mismo tramo), si ffmpeg
está disponible. visual-witness.json recoge frame, sesión,
porcentaje de píxeles coincidentes y posiciones de orilla e islote.
Esto permite identificar divergencias live sin pedir al usuario
más sesiones manuales ni asumir que el replay conserva el mismo estado.

**Revisión obligatoria:** la validez de SIGSTOP/SIGCONT y la atención
del botón en el Mac todavía deben probarse en ejecución real. Las
pruebas sintéticas no demuestran que Arthur esté vivo, ni el jefe
derrotado.
