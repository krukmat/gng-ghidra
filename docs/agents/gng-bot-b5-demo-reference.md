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


## Corrección B5.1 — carrera al iniciar demo

Error observado en Mac: el servidor se inicia con éxito y declara
B3_G4, pero la consulta inmediata a /state todavía muestra
operatorPause=false. La pausa del primer VBlank aparece después del
primer frame conocido. El grabador anterior lanzaba prematuramente
BOT_RECORD_DEMO_NOT_PAUSED.

Solución en main: bot/live/wait-demo-gate.mjs espera esa pausa durante
un máximo de 30 segundos, sin mandar controles ni continuar el motor.
Abortar si hay HALT, cambia la sesión, el operador cancela o se agota
el plazo. Solo entonces bot/record-gameplay.mjs llama a /continue.

Pruebas ROM-free del gate: 5/5 PASS en harness V8 aislado sobre el código
recuperado de main; falta prueba integral con bundle B3_G4 en Mac.

Comando para repetir:

    git pull --ff-only && node bot/record-gameplay.mjs --demo 240

Si no encuentra pausa, informar el nuevo error específico
BOT_DEMO_GATE_WAIT_TIMEOUT o BOT_DEMO_GATE_ENGINE_HALT_*.


## Corrección posterior — demo descartada para el cruce

Tras revisar la demostración, el usuario comprobó que **salta de una
secuencia del nivel 1 al final del nivel 2**; no muestra de manera
continua el encuentro con el jefe, la entrada al agua, el aterrizaje
sobre el islote móvil y la salida a tierra firme. Por tanto, **no es
un testigo válido para temporizar esta maniobra**. La hipótesis previa
sobre usar la demo para aprender el primer salto queda invalidada.

**No solicitar nuevas capturas de la demo para este objetivo.**
Retomar las cintas originales `out/bot/late-sweep/trial-6.json`,
`out/v3/b3/explorer/explorer-g4-2730-1606.json` y la grabación humana
`review.zip` para calibración. Ruta crítica:

1. Observador fiable de combate, orilla, isla y contacto de Arthur.
2. Corrección de acción de salto a partir de cinemática medida,
   usando controles P1 y motor inalterado, sin presumir la derrota del jefe.
3. Ensayo acotado y verificable con grabación/JSON de un candidato real;
   pedir review solo al llegar a un nuevo resultado de gameplay.

No declarar jugabilidad ni éxito sin una captura positiva real.
