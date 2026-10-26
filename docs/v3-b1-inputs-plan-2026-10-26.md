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

**V3.B1.T2 — Entradas CPU en runtime (depende de T1).**
T2.1 Sustituir constantes de SYSTEM/P1/P2 por fuente
determinista consultada en la lectura de CPU, no inyección
de estado. T2.2 Rechazar eventos mal formados, tiempos
no monótonos y valores desconocidos. DIPs quedan fijos.
**PASS:** sin entradas reproduce los 600 frames V2;
con entradas cambia solo lecturas explícitas.

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
