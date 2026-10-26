# V3.B2-A — Inputs CPU y primer test real de Coin1

Fecha: 2026-10-26 · rama `main`.

## Qué se ha implementado

**T2.1 — Ciclo de bus.** Los 7 puntos de lectura en
`src/mc6809_aot.mjs` emiten ahora `$.rd(address,offset)` o
`$.rk(address,offset)`, con el offset de microciclo `Path.c`
antes de consumir el acceso. La instrucción sigue actualizando
`$.C` solo al finalizar; el bus lee con `$.C+offset`.
Se probó sintéticamente: LDA extended SYSTEM a ciclo 8;
LDD extended SYSTEM/P1 a ciclos 8/9.

**T2.2 — Ports dinámicos.** `createBoard` acepta opcionalmente
`portRead(address,cycle)`, `onPortRead(read)`.
Solo las direcciones `0x3000–0x3002` usan el proveedor; DSW1/DSW2
y sin proveedor conservan exactamente sus defaults V2.
El byte devuelto y el offset se validan fail-closed. No se inyectan
registros, RAM ni callbacks en la semántica AOT.

**T2.3 — Tests.** `tests/test_v3_b2a_cpu_ports.mjs` cubre
coin, fronteras de ciclo, lectura 8/16 bits, defaults, entradas
inválidas, DIPs e integridad. Se añade a la regresión ROM-free.

**T2.4 — Compatibilidad.** `scripts/v3_b2a_build.mjs` recompila
las rutas conocidas usando **solo la imagen privada V2 ya verificada**
y sus semillas previamente guardadas: no lee ZIP ni MAME. Congela un
paquete independiente en `out/v3/b2a/frozen/`, sin sobrescribir
`out/v2/b1/`. La validación posterior ejecuta los 600 frames sin
inputs con el nuevo programa/runtime y exige igualdad de todos los
hashes y eventos originales V2.

**T2.5 — Camino al juego.** `scripts/v3_b2a_coin_smoke.mjs` solo
lee bundles congelados; después del no-input gate, aplica un pulso
`Coin1` de dos frames en el ciclo `420*CYCLES_PER_FRAME`.
Reporta lectura SYSTEM, ciclos efectivos y el primer frame que
diverge de V2 o nuevo bloque `UNCOMPILED`. Se escribe evidencia
local privada en `out/v3/b2a/coin-smoke.json` y se imprime solo
un resumen sin dumps. **No adjudicar jugabilidad** si la CPU solo
leyó un puerto: exigir un efecto observable o una ruta no compilada.

## Secuencia de validación (Mac)

```bash
git switch main
git pull --ff-only
bash scripts/v3_b2a_gate.sh
node scripts/v3_b2a_build.mjs --build
node scripts/v3_b2a_coin_smoke.mjs --coin
```

### Marcadores

- `V3_B2A_WIRING=PASS_ROM_FREE_AOT_CYCLE_ACCURATE`
  exige regresión Node/Python, pero no prueba inputs reales.
- `V3_B2A_BUILD=PASS_PRIVATE_AOT_NO_ORACLE` confirma bundle
  V3 independiente.
- `V3_B2A_NO_INPUT=PASS_600_FRAMES_EQUAL_V2` confirma que no
  hay regresión observable de la ejecución sin botones.
- `V3_B2A_INPUT_CPU_PATH=PASS_REAL_COMPILED_GNG_REACTION` solo
  si la CPU lee Coin1 realmente pulsado y produce una diferencia
  de frame o entra en una ruta `UNCOMPILED` **después del input**.

El marcador final queda PENDIENTE hasta ejecución privada real.
Si el pulse no ocurre mientras se consulta el puerto, se reporta
bloqueo; no se inventa un PASS. El reporte incluye banco/PC del
nuevo bloque **solo en out/ privado**, nunca en Git.

## Límites de certificación

La evidencia `V2_AUTONOMOUS_FRAME_CERTIFIED` corresponde al
runtime y código V2 originales, congelados e inmutables.
Modificar `src/gngb_runtime.mjs` y `src/mc6809_aot.mjs`
no extiende automáticamente dicha certificación al nuevo runtime.
La comparación V3 vs V2 (hashes/IRQ) controla esa regresión
de no-input; la equivalencia MAME con botones pertenece a T4.

## Entrada única para el operador

`bash scripts/v3_b2a_local.sh` ejecuta los tres pasos anteriores
sobre `main`, validando primero el árbol local limpio; no altera
la certificación V2 ni sobrescribe un paquete privado existente.
Solo es de **una ejecución**: en caso de fallo conservar `out/v3/`
y compartir los marcadores antes de hacer otra tentativa.
