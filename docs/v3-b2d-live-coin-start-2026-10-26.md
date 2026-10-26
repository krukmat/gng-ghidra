# V3.B2-D — De Coin1 leído a crédito, Start y partida real

**Estado (26/10/2026):** código de expansión offline y verificaciones ROM-free
implementados en `main`; ejecución privada en Mac pendiente. V2 y B2-B intactos.

## Hechos observados, no hipótesis

El operador visualizó auténtico GnG desde el motor AOT y reportó:

```text
V3_B2C_AOT_BUNDLE=B2B
V3_B2C_FIRST_FRAME=PASS_REAL_AOT_RENDER frame=311
V3_B2C_FIRST_RGBA_NONBLACK=1421
V3_B2C_FIRST_RGBA_COLORS=3
V3_B2C_FIRST_RGBA_NONOPAQUE=0
V3_B2C_BUS_COIN1=PASS_CPU_ACTIVE_READ frame=817
V3_B2C_HALT_FRAME=825
V3_B2C_HALT_COIN_READS=5
V3_B2C_HALT_START_READS=0
V3_B2C_MISSING_PC=25444
```

`25444 = 0x6364`. Tras un reinicio sin moneda:
`HALT_UNCOMPILED` en frame 1038, `27277 = 0x6A8D`.

La pulsación `Coin1` realmente llegó al puerto SYSTEM. El juego
no registró visualmente la moneda porque se detuvo en otra rama AOT,
y `Start1` no llegó a ser sondeado activo. El bundle B2-B solo estaba
certificado hasta 1000 frames en perfiles muy específicos.

## Dependencias y tasks (granularidad 1–2 niveles)

**T1 — Entrada tardía y secuencias de partida reales (P0)**
- T1.1 Crear fixtures ROM-free `src/v3_b2d_tapes.mjs` con
  `lateCoin` (frames 812–822), `lateStart` (850–862),
  `lateControls` (dirección/ataque/salto entre 900 y 1018),
  `idle` y `earlyControls` (secuencia B2-B); horizonte 1500.
- T1.2 Las secuencias modifican solo los bits *active-low* de
  SYSTEM/P1. No modifican CPU, RAM, sprites, crédito, vídeo, salud
  o estado del jugador. **PASS:** cada tape es determinista
  y pasa tests ROM-free.

**T2 — Descubrimiento dinámico exclusivamente en build (P0)**
- T2.1 Cargar y verificar `out/v3/b2b/frozen` con todos los hashes
  del manifiesto; regenerar su `program.mjs` de 663 bloques y
  comparar SHA-256 exacto; verificar que no cambió el compilador.
- T2.2 Sembrar PCs reales `0x6364` y `0x6A8D`;
  compilar desde cero y descubrir recursivamente rutas adicionales
  hasta que **los cinco perfiles** completen 1500 frames con
  `FRAMES_DONE`. Límite de 96 iteraciones por tanda,
  con checkpoint privado verificable y `--resume` automático.
- **STOP:** `UNCOMPILED` no puede ignorarse; los módulos del
  runtime no pueden importar compilador, oráculos ni capturas MAME.

**T3 — Bundle privado nuevo y gates de promoción (P0)**
- T3.1 Congelar candidato en
  `out/v3/b2d/work-*/candidate-frozen`, nunca sobre B2-B.
  Demostrar 600 frames sin input **idénticos al B2-B/V2**.
- T3.2 Repetir dos veces cada uno de los cinco perfiles desde
  reset, con 1500 hashes iguales. Contrastarlos diferencialmente:
  `lateCoin vs idle`, `lateStart vs lateCoin`,
  `lateControls vs lateStart`; exigir muestras activas de
  Coin/Start/P1 en la CPU y diferencias de estado.
- **GO:** solamente después, publicar
  `out/v3/b2d/frozen` y
  `discovery-report.json` con `DISCOVERY_COMPLETE`.
  Estos efectos **no garantizan movimiento o créditos
  visuales**, que se comprobarán en el siguiente gate.

**T4 — Motor de navegador real (P0)**
- T4.1 El runner B2-C selecciona el nuevo bundle **solo**
  si manifiesto/hash completo y reporte avalan todas las
  comprobaciones de T3. De lo contrario se queda en B2-B.
- T4.2 Con el teclado real `5`, `1`, flechas, `Z`, `X`,
  inspeccionar primero el crédito, pantalla de juego y
  movimiento de Arthur. No introducir vídeos precalculados,
  sprites artificiales ni rutas de juego sintetizadas.
- **GO jugabilidad:** Arthur visible y controlable directamente
  por el código MC6809 recompilado; equivalencia contra
  MAME para esas secuencias pendiente de gate nativo.

## Único gate privado en Mac

```bash
git switch main
git pull --ff-only
bash scripts/v3_b2d_local.sh
```

Si aparece `BLOCKED_ITERATION_LIMIT`, preservar
`out/v3/b2d/`, repetir **el mismo comando**; continúa el
checkpoint con verificación del código original.

Marcadores de promoción esperados:
`V3_B2D_NO_INPUT=PASS_600_FRAMES_EQUAL_B2B_V2`,
`V3_B2D_FROZEN=PASS_5_PROFILES_1500_FRAMES_DOUBLE_REPLAY`,
`V3_B2D_EFFECT_COIN_FRAME`, `V3_B2D_EFFECT_START_FRAME`,
`V3_B2D_EFFECT_CONTROLS_FRAME`,
`V3_B2D_DISCOVERY=PASS_REAL_AOT_1500_FRAMES`,
`V3_B2D_LOCAL=PASS`.

Después detener servidor B2-C, arrancar
`node scripts/v3_b2c_live.mjs --serve` y comprobar
`V3_B2C_AOT_BUNDLE=B2D`. El propio navegador seguirá
mostrando frames auténticos del motor AOT y observaciones
de bus de CPU sin inventar resultados.
