# B5 — Grabación humana y referencia del modo demo (27/10/2026)

**Prioridad de gameplay:** derrotar al jefe → aterrizar en islote móvil →
saltar a tierra firme. Nunca marcar stage clear por pico o por acabar
una cinta. Engine/AOT/servidor/render inmutables.

## Evidencia real entregada

Fuente privada `review.zip` compartida en conversación, sin subirlo a
GitHub. Su MP4 dura **228,8 s**, **4.576 muestras** a 20 Hz; hay dos
sesiones de motor, con reinicio cerca de 213 s. El ledger indica 1.572
muestras repetidas y 5.468 frames intermedios no grabados. La sesión 1
llega a engine frame 8781; la 2 se queda en frame 311, pausa inicial.

La región de agua es visible aproximadamente entre **190–200 s** (frames
de motor ~7485–8050). Se observan la orilla de salida y un islote
sobre agua. Sobre los frames individuales en ~194–195 s **no queda
demostrado un aterrizaje en el islote**; no confundir el marco cuadrado
de la orilla con la plataforma verde. Tampoco es posible deducir
matemáticamente los inputs P1 humanos solo a partir del vídeo.

El `input-tape.json` del ZIP original guarda únicamente **sesión 2**
(frame 311) porque el recorder previo capturaba `GET /tape` al final
y el reinicio sustituye los datos de sesión 1. Se corrige ahora
tomando snapshots privados de /tape **cada 40 muestras** y al cierre,
por sesión. No se recrea la cinta perdida ni se inventan controles.

**Nueva observación proporcionada por el usuario:** la demostración
automática que aparece tras GAME OVER **supera el primer islote**.
Se tratará como una posible referencia visual para la trayectoria
de Arthur y la ventana de aterrizaje; la observación no se confunde
con una política P1 reproducible hasta medir píxeles y comprobar
si el modo demo utiliza controles de puerto o un script interno.

## Función preparada en main

`bot/record-gameplay.mjs` acepta un modo desatendido:

    git pull --ff-only && node bot/record-gameplay.mjs --demo 240

El modo demo:
- Requiere que no haya otro servidor live en el puerto local 18609.
- Inicia **el motor existente** y libera una vez la pausa inicial
  mediante POST /continue (no pulsa ni Coin, Start, Attack, Jump ni
  ningún P1). No cambia CPU/AOT/renderizador/ROM.
- Captura GET /pixels, GET /state y snapshots periódicos GET /tape.
- Graba `gameplay.mp4`, `recording.json`, `input-tape.json` y
  `input-tape-session-N.json` si están disponibles. Guarda
  `review.zip` en el directorio privado mostrado por el comando.
- Termina a los 240 s o con Ctrl+C.

La captura permitirá buscar el primer y segundo salto y comparar
el desplazamiento del islote **relativo a la orilla**, así como distinguir
contacto de caída. No se presupone que aparezca la secuencia de
la demo dentro del horizonte: revisar antes de afirmarlo.
El modo humano anterior continúa disponible sin argumentos.

## Gate actual

Código de capturas actualizado y parseado en validación estática;
**el modo demo no está ejecutado ni certificado en el Mac del usuario**.
No hay ejecución automática del bot en el agua ni prueba de derrota del
jefe. Siguiente entrada requerida, si la demo efectivamente muestra
el salto, es su `review.zip`; el usuario **no necesita jugar**.
