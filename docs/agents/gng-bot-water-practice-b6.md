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
