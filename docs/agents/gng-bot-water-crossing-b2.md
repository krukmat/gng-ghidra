# B2 — Cruce del agua hacia el islote móvil (27/10/2026)

**Rama: main. Estado: IMPLEMENTED_ROM_FREE / STOP_REAL_GAMEPLAY.**
Objetivo: una aproximación controlada, esperar que la superficie móvil entre
en la ventana de aterrizaje, realizar **un solo salto** y confirmar el apoyo
antes de considerar superado el primer tramo. No es todavía un bot que
complete el agua ni la primera fase. El segundo salto hacia tierra firme
es otra tarea y requiere calibración independiente.

## Evidencia que justifica el giro

- **Dato de usuario:** el personaje probablemente cae al agua si no alcanza
  el islote móvil. Es la hipótesis operacional principal, no una colisión
  certificada por RAM.
- Capturas privadas suministradas: baseline mantiene el mismo contenido
  de píxeles en **2760/2800/2840** y peak en **2776/2791/2806**. El
  decremento de vidas llega después (2839 y 2881 respectivamente);
  no hay que temporizar el salto usando esos decrementos tardíos.
- Las imágenes tardías muestran agua y superficies pequeñas, pero no
  suficientes posiciones temporales **antes** del fallo para identificar
  con confianza qué superficie es móvil, su velocidad ni el despegue de
  Arthur. Estas medidas permanecen UNKNOWN.

## B2.1 — Entregado (solo bot, sin motor)

| Task | Archivo | Resultado |
| --- | --- | --- |
| B2.1a | `bot/policy/water-crossing.mjs` | FSM OBSERVE/APPROACH/WAIT/TAKEOFF/AIRBORNE/LANDED/STOP; interceptación horizontal prevista y espera de movimiento confirmado |
| B2.1b | `bot/control/water-ports.mjs` | Traducción a transiciones `p1.right` y `p1.button2`, release en STOP o cambio de sesión |
| B2.1c | `bot/policy/water-controller.mjs` | Conecta decisión y puertos sin HTTP ni RAM; el caller de `/pixels`/`/input` queda por integrar |
| B2.1d | `tests/bot/water-*.test.mjs` | 14 tests ROM-free PASS con Node en entorno aislado, sobre observaciones sintéticas; NO validación del juego |
| B2.1e | `bot/capture-water.mjs` | Captura de frames **pre-impacto** desde las dos cintas existentes, sin generar candidatos |

**Seguridad:** el salto solo se ordena tras dos mediciones consistentes de
movimiento de plataforma, posición del jugador confiable, datos de agua,
altura aproximada y calibración explícita de `flightFrames` y
`runSpeedPxPerFrame` (**velocidad horizontal de Arthur en pantalla**,
no world_x). Si falta información, espera, entrega el control o STOP.
El aterrizaje exige observaciones consecutivas de contacto visual
grounded sobre la superficie. P1 original exclusivamente. No se usa
RAM en vivo, ni clone/reset durante el salto, ni nuevos controles,
AOT, CPU, renderer, server o bundles.

**Límite importante:** es un controlador desacoplado que consume observaciones
ya interpretadas; aún no hay un detector de islote y `grounded` calibrado
para la escena real ni un bucle live que alimente `createWaterController`.
Los valores de los tests son artificiales, **no parámetros operativos**.
No se permite activar esta política live con coordenadas supuestas.

## B2.2 — Siguiente gate: calibración y par de pruebas

En el Mac (después de `git pull --ff-only`):

```bash
node --test tests/bot/water-crossing.test.mjs tests/bot/water-ports.test.mjs tests/bot/water-controller.test.mjs
node bot/capture-water.mjs
```

El segundo comando reproduce **solo** dos cintas existentes y guarda
`out/bot/b2-water-peak/frames.png` y
`out/bot/b2-water-baseline/frames.png` con 31 imágenes, cada diez frames
desde 2500 hasta 2800. Ninguna imagen/cinta/ROM debe subirse a GitHub.

Con esos fotogramas privados se debe: localizar la orilla,
identificar cuál es el islote y cómo se desplaza, estimar timing real
de carrera/despegue/caída, separar muerte/ausencia de sprite, construir
observador con confianza, verificar en frames reservados y entonces
conectar el controlador al cliente existente de `/pixels`/`/input`.
**No basta etiquetar el HUD ni extrapolar desde fotos congeladas.**

Después, proponer **máximo tres pares** de episodios desde reset (dos
desarrollo y uno holdout), con el mismo g4, prefijos y horizontes por
par. Presupuesto 5h/7d a comprobar localmente antes de ejecutar.
`UNCOMPILED` es resultado censurado y detiene esa rama.
GO de gameplay = aterrizaje observable en el islote, sin vida perdida
y posterior avance verificable; `FRAMES_DONE`, máximo x y un plateau
no acreditan éxito.

**Gate actual: B2_IMPLEMENTED_ROM_FREE / BOT STOP GAMEPLAY.**
