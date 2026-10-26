# V3.B1 — Inputs deterministas y primera interacción

Estado inicial: V2 cerrado en `main` con
`V2_FEATURE_MERGED_MAIN=PASS_POSTMERGE` (26/10/2026).
Este bloque prepara V3; NO afirma jugabilidad.

## Fuente hardware verificada

En MAME 0.289, `src/mame/capcom/gng.cpp`,
`gngb` usa el mapa e inputs de `gng`.
Entradas digitales active-low:

| Lectura CPU | Puerto | Controles y bits |
|---|---|---|
| 0x3000 | SYSTEM | Start1 0x01, Start2 0x02, Service1 0x20, Coin1 0x40, Coin2 0x80 |
| 0x3001 | P1 | Right 0x01, Left 0x02, Down 0x04, Up 0x08, Button1 0x10, Button2 0x20 |
| 0x3002 | P2 | Igual a P1 (cocktail) |
| 0x3003 | DSW1 | DIP coinage, demo sound, service, flip |
| 0x3004 | DSW2 | DIP lives, cabinet, bonus, difficulty |

Defaults existentes `[0xff,0xff,0xff,0xdf,0xfb]`
deben conservarse en ejecución sin inputs. Joystick 4-way:
las entradas opuestas y diagonales requieren una política
determinista probada contra MAME, no un supuesto.

## Tasks y dependencias

**V3.B1.T1 — Contrato de inputs [siguiente].**
T1.1 Fijar bits active-low, eventos, timing de aplicación,
DIPs y secuencias válidas. T1.2 Tests ROM-free de
coin/start/left/right/button/release y casos ilegales.
**PASS:** mapa y casos adversariales comprobados sin alterar V2.

### T1.1–T1.5 — Implementación ROM-free (26/10/2026)

Se añadió `src/gngb_input_contract.mjs`, la suite
`tests/test_v3_b1_input_contract.mjs` y el gate
`scripts/v3_b1_t1_gate.sh`. **T1 PASS** según los marcadores
ejecutados en Mac: `GNG_LOCAL_REGRESSION=PASS_ROM_FREE_A0_2_TO_A0_6_3`,
`GNG_LOCAL_REGRESSION=PASS_ROM_FREE_R3_R42H` y
`V3_B1_T1_INPUT_CONTRACT_PASS`.
[Checkpoint de T1](audit/v3-b1-t1-input-contract-2026-10-26.md).

**Siguiente bloque:** [V3.B1.T2 — puertos dinámicos en runtime](v3-b1-t2-runtime-ports-2026-10-26.md).
T2 está planificado y pendiente de implementación y gates.

**V3.B1.T2 — Primer efecto del jugador en el GnG recompilado (depende de T1).**
T2.1 Asegurar el ciclo exacto de lectura del bus CPU; T2.2
conectar SYSTEM/P1/P2 al proveedor de entradas; T2.3 probar
malformaciones y combinaciones; T2.4 certificar `no-input` contra
la ejecución V2 sin alterar su bundle; T2.5 observar en el juego
original AOT una lectura de `coin1` y su primera consecuencia
(control flow/estado o bloqueo `UNCOMPILED` acotado).
**PASS:** `V3_B1_T2_DYNAMIC_PORT_READ_PASS` respaldado por
evidencia sintética y observación sobre GnG real. No declara
todavía créditos funcionales, partida ni movimiento.

**V3.B1.T3 — Replay y nuevas rutas AOT (depende de T2).**
T3.1 Input tape versionado con timing y hash. T3.2 Descubrimiento
y compilación de rutas nuevas exclusivamente durante build,
con reinicio desde reset; runtime congela el artefacto.
**PASS:** dos runs idénticos, ningún `UNCOMPILED` en
el artefacto final ni decoder/intérprete en runtime.

**V3.B1.T4 — Diferencial de partida (depende de T3).**
T4.1 Oráculo MAME 0.289 nuevo, misma secuencia de
coin→start→movimiento→salto y timing. T4.2 Comparar
efectos, IRQ/SYNC, estado observable y píxeles elegibles.
**PASS:** cero divergencias sobre el intervalo certificado,
sin suponer ceros ni usar estados MAME como entrada JS.

**V3.B1.T5 — Interacción visible (depende de T4).**
T5.1 UI mínima de teclado, separada de la placa.
T5.2 Test de control de Arthur causado por lógica recompilada,
sin desplazamientos o animaciones predefinidos.
**PASS:** `V3_FIRST_REAL_INPUT_PASS` reproducible.

```text
T1 Contrato y fixtures → T2 Puertos → T3 Replay y AOT
                                    ↓
                         T4 Oráculo con inputs
                                    ↓
                         T5 Primer control visible
```

Prohibido alterar el gate V2 para adaptar la entrada.
V4 Z80/YM2203 queda fuera de este bloque. No generar,
publicar ni incorporar bytes de ROM o evidencias privadas.

## Checkpoint B2-A → B2-B (26/10/2026)

El operador verificó B2-A: 354 bloques, 600 frames de no-input
idénticos a V2, dos lecturas de Coin1 activo, primera diferencia
en frame 421, nueva ruta `UNCOMPILED` en frame 492.
**B2-A cerrado.** La siguiente fase [B2-B](audit/v3-b2b-coin-start-2026-10-26.md)
automatiza descubrimiento de nuevas rutas AOT y replays
Coin → Start → controles; no hay todavía certificación de partida.

## Nueva ruta prioritaria — Resultado visible temprano (26/10/2026)

**[B2-C First Visible Evidence](v3-b2c-first-visible-evidence-2026-10-26.md)**
se ejecutará en paralelo con el descubrimiento B2-B: primero
fotos reales desde el AOT idle validado, luego viewer A/B de Coin1
antes del frame 492 y después Start/Arthur a medida que las nuevas
rutas compilen. No confundir divergencia de estado CPU con píxeles.
El visor y todas las imágenes permanecen privados en `out/`.
