# B4 — Grabación del juego con un solo comando

**Rama:** main. **Objetivo:** obtener vídeo silencioso del motor real
con identificadores de frame y los inputs reales de un jugador humano.
Sin modificar motor/AOT/render/servidor/bundles ni ejecutar un agente.

## Un solo comando en Mac

Desde la carpeta gng-ghidra:

    git pull --ff-only && node bot/record-gameplay.mjs

- Requiere ffmpeg instalado (si falta: brew install ffmpeg una sola vez).
- Abre el navegador; si el servidor ya está activo, se conecta. Si no,
  ejecuta el servidor existente sin modificarlo.
- El jugador usa 5=Coin, 1=Start, flechas, Z=ataque, X=salto.
- Graba hasta cuatro minutos; Ctrl+C termina antes y guarda el vídeo.
- Lee píxeles reales vía GET /pixels con frame y sesión, GET /state y
  finalmente GET /tape para conservar la cinta original.
- No manda POST ni escribe memoria del juego.
- MP4 silencioso 768×672 a 20 muestras/s, escalado vecino más próximo
  desde los píxeles originales 256×224, mediante ffmpeg.
- No captura el escritorio ni pide permiso de Screen Recording.
- Los resultados se mantienen en out/bot/, fuera de GitHub.

Se imprime:

    BOT_RECORD_REVIEW_ZIP=/.../out/bot/gameplay-.../review.zip

El ZIP contiene:
- gameplay.mp4: secuencia real sin audio.
- recording.json: correspondencia de cada muestra a frame, sesión y
  duplicados/frames omitidos.
- input-tape.json (si el motor responde): lecturas originales de controles.

**Sube solo review.zip a esta conversación**, nunca a GitHub.
Si falla, envía la salida que empieza por BOT_RECORD_FAILED o
BOT_RECORD_STATUS. Si ffmpeg falta, instala y repite.

**Limitaciones:** se muestrean 20 frames por segundo de la ejecución y
podrían perderse fotogramas intermedios. No reemplaza una captura de
todos los frames del motor. Tampoco demuestra que el bot haya jugado.
Una muerte o HALT en el intento sigue siendo evidencia útil.
