# GnG V3.B2-E — Cobertura de idle y espera real de Coin

Fecha: 26-10-2026 · Rama `main`.

## Evidencia del operador

El motor AOT de GnG ya muestra gráficos ROM reales y el paquete
B2-D (1654 bloques) supera cinco perfiles, incluidas las secuencias
Coin → Start → controles por 1500 frames. Su `idle` solo estaba
certificado hasta 1000. En la sesión interactiva sin botones activos:

```text
V3_B2C_AOT_BUNDLE=B2D
V3_B2C_REAL_ENGINE=STARTED http://127.0.0.1:18609
V3_B2C_SESSION_FRAMES=6000
V3_B2C_FIRST_FRAME=PASS_REAL_AOT_RENDER frame=311
V3_B2C_ENGINE=HALT_UNCOMPILED
V3_B2C_HALT_FRAME=1038
V3_B2C_HALT_COIN_READS=0
V3_B2C_HALT_START_READS=0
V3_B2C_MISSING_PC=27293
```

`27293 = 0x6A9D` en ROM fija. El log confirma un bloque
ausente **después** de la certificación idle. No confirma
ninguna moneda o Start pulsados antes del HALT.

## Ruta P0: comprobar Coin/Start antes de compilar más idle

El navegador ahora detiene **una sola vez** la CPU MC6809 real
en el primer VBlank de imagen completamente conocida, desde
frame 311, dejando el framebuffer real en pantalla. Ningún
registro, contador de créditos, sprite ni memoria de vídeo
se altera. El worker se queda detenido exclusivamente en
la barrera de VBlank y no genera frames inventados.

- **T0.1** `src/v3_b2c_visible_gate.mjs`: pausa exclusivamente
  en un fotograma auténtico y conocido; el usuario puede
  reanudarla. Test de 4 casos ROM-free.
- **T0.2** `scripts/v3_b2c_live.mjs`: botón `Insertar moneda`
  y `Start 1P` con pulsos de usuario que entran por
  `SYSTEM`; botón `Continuar demostración sin moneda`.
  Las teclas originales `5` y `1` siguen funcionando.
- **T0.3** `scripts/v3_b2c_engine_worker.mjs`: la espera
  `Atomics.wait` no vence artificialmente a los 30 segundos
  cuando un usuario inspecciona el primer frame. Reset termina
  el worker y comienza nuevamente desde la CPU real.
- **GO técnico:** `V3_B2C_OPERATOR_PAUSE=REAL_VBLANK_FRAME_311`
  y luego `V3_B2C_OPERATOR_RESUME=REAL_MC6809_CONTINUES`.
  La lectura real de Coin debe generar `V3_B2C_BUS_COIN1`.
- **GO funcional:** crédito visible, transición al juego y Arthur
  controlable. No lo sustituye ningún marcador de bus o RAM.

## Ruta P1: B2-E, extensión AOT idle auténtica

El bloque B2-E parte del paquete privado congelado B2-D,
certifica su origen por SHA-256 y recompilación exacta, e
incorpora el PC observado `0x6A9D` **solo en compilación offline**.

- **T1.1 — Ampliación:** `scripts/v3_b2e_discover.mjs`
  descubre y compila rutas `idle` hasta 1500 frames reales.
  Límite de 96 nuevas iteraciones por tanda y reanudación
  sin repetir las anteriores, con reporte privado.
- **T1.2 — Integridad:** verifica 1000 frames de `idle`
  idénticos al paquete B2-D. En el candidato congelado ejecuta
  cada perfil Coin, Start, controles, idle y temprano dos veces
  y compara con el runtime padre; además repite 1500 frames idle.
  Cualquier divergencia bloquea la publicación.
- **T1.3 — Promoción:** usa `out/v3/b2e/frozen` solo cuando
  el reporte y sus hashes `b2eCertified` pasan. El navegador
  selecciona B2-E, o mantiene B2-D si falla la validación.
- **STOP:** `UNCOMPILED`, deriva de compilador, dependencia
  externa, respuesta gráfica fabricada o discrepancia V2/B2D.

## Ejecución priorizada

**Primero validar Coin ahora, sin nuevo build:**

```bash
git switch main
git pull --ff-only
bash scripts/v3_b2c_gate.sh
node scripts/v3_b2c_live.mjs --serve
```

Abrir `http://127.0.0.1:18609/`. Debe mostrar un
VBlank **real** y esperar. Pulsar `Insertar moneda`;
después `Start 1P`. El primero reanuda la CPU con su bit
active-low, sin alterar estado interno del juego.

**Si se necesita ampliar idle para sesiones más largas:**

```bash
bash scripts/v3_b2e_local.sh
```

El paquete B2-D permanece intacto. Si B2-E termina en
`BLOCKED_ITERATION_LIMIT`, conserva su checkpoint privado
y repite el mismo comando. Solo tras PASS de B2-E, detener
y reiniciar el servidor para cargarlo en modo interactivo.

## Criterios y honestidad

`V3_B2C_COIN=PASS_REAL_CPU_READ` certifica recepción de
entrada física, **no** crédito visible. No reportar partida
jugable hasta observar pantalla de juego y posición de Arthur
modificada por su propia CPU MC6809 compilada. Si el runtime
se detiene en otro PC con Coin/Start, registrar esa dirección
y priorizarla frente a expandir indiscriminadamente attract.
