# B3 — Pixel pipeline sobre capturas reales (27/10/2026)

**Rama:** main. **Estado:** VISUAL_DIAGNOSTIC_PASS / GAMEPLAY_STOP.
Orden obligatorio: **derrotar al jefe → saltar al islote → saltar a la orilla derecha**.
Engine/AOT/render/server/bundles/ROM intactos; no investigación externa iniciada.

## Implementación

| Bloque | Archivo | Alcance |
| --- | --- | --- |
| Terreno | bot/perception/terrain-water.mjs | Candidatos de orilla izquierda, islote y eventual orilla derecha |
| Movimiento | createIslandVelocityTracker | Velocidad relativa a la orilla, descontando scroll |
| Arthur | bot/perception/arthur-skin.mjs | Candidato de sprite sin asumir contacto |
| Demonio rojo | bot/perception/red-demon.mjs | Presencia probable; desaparición no demuestra muerte |
| PNG/diagnóstico | bot/perception/png-contact.mjs y bot/analyze-water-captures.mjs | Lee capturas privadas, no juega |
| Observador live | bot/live/pixel-observer.mjs | Solo GET /pixels y /state |
| Actuación segura | bot/live/safe-dispatch.mjs | Solo P1, bloquea si faltan evidencias verificadas |
| Pruebas | tests/bot/ | 41/41 PASS en Node local de desarrollo, mayormente sintéticos |

## Medidas reales sin nuevas partidas

Fuente: las dos hojas de 31 frames de water.zip, frames 2500..2800,
intervalos de 10. Las capturas y JSON **no se subieron** al repositorio.

| Métrica | peak | baseline |
| --- | ---: | ---: |
| Velocidad isla respecto a orilla | +0,8 px/frame; 9 muestras | +0,8 px/frame; 5 muestras |
| Velocidad Arthur respecto a orilla, aproximación | +1,0 px/frame; 11 muestras | +1,0 px/frame; 8 muestras |
| Muerte confirmada del jefe | UNKNOWN | UNKNOWN |
| Aterrizaje sobre isla | UNKNOWN | UNKNOWN |
| Orilla derecha | No observada | No observada |

**Implicación:** mientras el islote se mueve hacia la derecha, la
velocidad de cierre es de solo ~0,2 px/frame. No hay base para ordenar
un salto inmediato. La táctica debe esperar una intercepción segura,
posiblemente después de invertir el movimiento del islote.

En peak, el demonio rojo/azul todavía es un candidato visible hasta
aproximadamente el frame 2710 y desaparece hacia 2720; **esto no prueba
que esté muerto**. Puede abandonar el encuadre debido al scroll.

## Gate para el próximo review del juego

1. Ver la animación o evidencia visual inequívoca de derrota del jefe.
   El gate actual jamás infiere muerte por desaparecer el sprite.
2. Ver dos observaciones fiables del apoyo de Arthur sobre terreno o islote;
   medir sus pies, ventana de vuelo, trayectoria y pérdida de apoyo.
3. Ver la orilla derecha y calibrar el segundo salto.
4. Conectar las observaciones validadas al controlador ya creado,
   sin lectura RAM privilegiada, con revisión de cuota, y probar
   solo un par pequeño de episodios desde reset. HALT = censurado/STOP.

Las medidas del witness aún **no** autorizan marcar
pixelsCalibrated, groundedConfirmed ni bossDefeated como true.
El observador live registra datos, pero **no envía controles**.

Comandos locales disponibles después de actualizar main:

~~~bash
node --test tests/bot/*.test.mjs
node bot/analyze-water-captures.mjs out/bot/b2-water-peak/frames.png peak
node bot/analyze-water-captures.mjs out/bot/b2-water-baseline/frames.png baseline
# con el servidor original en marcha, solo lectura:
node bot/live/pixel-observer.mjs 20
~~~

**Resultado:** ingeniería preparatoria probada; ninguna victoria en gameplay
certificada. Aún requiere un nuevo review visual para activar la política.
