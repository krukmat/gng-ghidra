# V3.B1.T1 — Contrato de entradas / decisión de diseño

Fecha: 2026-10-26 · rama `main`.
**Contrato ROM-free, aislado del runtime AOT V2.**

## T1.1 — Procedencia y mapeo

Fuente: MAME tag `mame0289`, `src/mame/capcom/gng.cpp`;
`gngb` usa `INPUT_PORTS_START(gng)` y
`gng_state::gng_main_map`.

- SYSTEM: START1 0x01, START2 0x02, SERVICE1 0x20,
  COIN1 0x40, COIN2 0x80.
- P1 / P2: RIGHT 0x01, LEFT 0x02, DOWN 0x04,
  UP 0x08, BUTTON1 0x10, BUTTON2 0x20.
- CPU reads: 0x3000 SYSTEM, 0x3001 P1, 0x3002 P2,
  0x3003 DSW1, 0x3004 DSW2.
- Todo digital active-low: pulsar despeja el bit,
  soltar lo restaura a 1.
- Sin entradas: `ff ff ff df fb`, idéntico a la
  implementación V2 en `src/gngb_runtime.mjs`.

## T1.2 — Modelo de eventos

Cada evento tiene **exactamente**:
`{cycle: nonnegative safe integer, control: string, pressed: boolean}`.
Nombres de control canónicos del mapa T1.1; sin escritura de
bytes arbitarios por el frontend.

- El contrato ordena grupos por `cycle` no decreciente,
  **no** reordena ciclos no monotónicos.
- Las transiciones en un mismo ciclo son **atómicas**:
  primero se comprueban contra el estado anterior; luego se
  aplican juntas. El orden de presentación dentro de un grupo
  no cambia el resultado. Un control no puede aparecer dos
  veces en el mismo ciclo.
- Pulsar un control ya pulsado o soltar uno no pulsado = error.
  Se exige normalización de auto-repeat en el futuro adaptador
  de teclado, no aceptación silenciosa aquí.
- 4-way: se rechaza más de una dirección simultánea de un
  mismo jugador (incluye opuestas y diagonales). Esto es una
  **política conservadora de nuestro adaptador**, no un
  resultado experimental de resolución de ejes MAME;
  comparar con MAME cuando se implemente T4.
  Botones pueden combinarse con una dirección y P1/P2 son
  independientes.

## T1.3 — Semántica temporal

Ciclos de CPU **absolutos desde cold reset**, no números de frame.
El evento de ciclo N está activo para una lectura CPU en N;
permanece hasta su `release`, incluso entre VBlanks.
El muestreo es una función pura: leer antes o después
no cambia el estado de otras lecturas.

Los DIPs pueden configurarse explícitamente solo al crear el
contrato, se congelan y **no se admiten eventos DIP en el tape**.
El schema actual es `gng.v3.input-contract.v1`;
la versión de replay con hash/procedencia pertenece a T3.
Se aceptan solo direcciones CPU 0x3000–0x3004.
Un contrato fabricado fuera de `defineInputSchedule`
se rechaza por procedencia de instancia.

## T1.4 y T1.5 — Tests y gate

`tests/test_v3_b1_input_contract.mjs` cubre la tabla completa,
defaults, press/release, coin/start, simultaneidad atómica,
4-way, DIP, timing de VBlank, eventos inválidos, protección
de alias/contratos falsos y aislamiento respecto del AOT.

`bash scripts/v3_b1_t1_gate.sh` ejecuta las pruebas ROM-free
integradas con la regresión V2. Solo al terminar con código 0
emite `V3_B1_T1_INPUT_CONTRACT_PASS`.

## Alcance del cierre

**Solo modelo y tests.** No modificar `gngb_runtime.mjs`,
compilador, renderer, ROM, estados ni gates V2. El próximo
bloque T2 será quien conecte `readScheduledPort` a
las lecturas del bus CPU, y todavía requerirá nueva
comparación nativa con entradas para certificar V3.
