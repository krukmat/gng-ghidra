# V3.B1.T2 — Entradas deterministas en el runtime AOT

Fecha: 2026-10-26. Base: `main`. Prerrequisito: `V3_B1_T1_INPUT_CONTRACT_PASS`.

## Valor de producto: dejar de reproducir una demo pasiva

**T2 debe permitir que la lógica original de GnG *observe* decisiones
del jugador.** V2 ya prueba vídeo autónomo de arranque/attract (600 frames)
pero no prueba interacción. Cablear un proveedor y pasar un test
sintético es infraestructura necesaria, **no un avance jugable**.
La primera entrega orientada al juego debe incluir un test real de
`coin1` desde reset, acreditando el acceso CPU al puerto y una primera
consecuencia (cambio en control flow/estado o bloqueo por código AOT
todavía sin compilar). Este último caso identifica la ruta a trabajar
en T3; no es progreso jugable y debe registrarse explícitamente.

```text
coin1 pulsado → puerto SYSTEM 0x3000 → lectura real MC6809
                                              ↓
                              rama/estado GnG divergente de idle
                                              ↓
                                T3: compilar ruta observada
                                              ↓
              Start → Arthur a derecha/izquierda → Salto (T3–T5)
```

**Dos niveles de evidencia:** `T2_WIRING_PASS` (solo ROM-free y
temporización) y `T2_REAL_INPUT_OBSERVED` (ejecución privada del
código original AOT, captura de dirección/ciclo y primera reacción).
No equiparar ninguno de ellos con `V3_FIRST_REAL_INPUT_PASS`
(T5, jugabilidad validada frente al oráculo).

## Objetivo

Conectar el contrato `src/gngb_input_contract.mjs` con las lecturas del bus MC6809, sin
inyectar registros, memoria ni estados de MAME y preservando el artefacto V2
cuando no hay eventos. **T2 no cubre todavía nuevos bloques AOT alcanzados
con coin/start ni certifica jugabilidad.**

## Tareas y dependencias

**T2.1 — Auditoría de lecturas y reloj.**
- T2.1.1 Localizar en `src/mc6809_aot.mjs` las llamadas de lectura `$.rd` y
  `$.rk`, y establecer qué ciclo representa el acceso físico al puerto,
  especialmente dentro de bloques/instrucciones con varios accesos.
- T2.1.2 Definir el contrato de muestreo sin usar únicamente el ciclo de
  inicio de instrucción si eso cambia la respuesta de la lectura.
- T2.1.3 Auditar la generación `$.rd(ea)` del compilador: los offsets
  de microciclo (`e.acc()`/`e.stop()`) se generan dentro de la
  instrucción, pero `$.C` se incrementa solo al cerrarla.
  Definir el ciclo absoluto de lectura (incluidos dos bytes y
  direccionamiento indirecto) con fixture y evidencia independiente.
- **PASS:** prueba ROM-free sintética del instante exacto de lectura y
  documentación del desfase de bus, si lo hay.

**T2.2 — Proveedor inyectable de puertos (depende de T2.1).**
- T2.2.1 Incorporar entrada explícita opcional a `createBoard` para
  SYSTEM/P1/P2 (0x3000–0x3002); conservar los cinco
  `PORT_DEFAULTS` sin proveedor y DIP fijo en 0x3003–0x3004.
- T2.2.2 Tomar los valores mediante `readScheduledPort` exactamente
  durante la lectura del bus, no al principio de frame, y mantener
  invariantes de unknown RAM y fail-closed.
- **PASS:** una ROM sintética compilada AOT observa coin/start/left/right
  al ciclo correcto; sin proveedor, cada lectura retorna los bytes V2.

**T2.3 — Casos adversariales y compatibilidad (depende de T2.2).**
- T2.3.1 Verificar press/release, límite VBlank, lecturas repetidas,
  mismas transiciones en distinto orden, DIP inmutable y rechazo de
  contrato/proveedor mal formado.
- T2.3.2 Incluir pruebas de ausencia de acoplamiento del runtime a MAME,
  de no decodificación MC6809 dinámica y de propagación de errores.
- **PASS:** tests Node ROM-free, sin variar rutas de boot/IRQ/SYNC existentes.

**T2.4 — Gate de regresión V2 y checkpoint (depende de T2.3).**
- T2.4.1 Ejecutar regresión ROM-free integral; demostrar que la opción
  ausente no cambia outputs y eventos de V2.
- T2.4.2 Evaluar impacto en bundle congelado: si cambia el núcleo del
  runtime, la anterior certificación permanece válida **solo para el
  commit original**; ejecutar un gate de no-input sobre el nuevo núcleo
  y documentar evidencia, sin reutilizar indebidamente los hashes V2
  como prueba de la revisión modificada.
- **PASS técnico:** `T2_WIRING_PASS`, regresión y temporización ROM-free.
  Reutilizar el bundle V2 congelado no prueba cambios en el runtime T2.
  Crear artefacto privado V3 separado y exigir `no-input` con hashes
  equivalentes a la ejecución V2, sin alterar `out/v2/b1/`.
  La certificación nativa anterior sigue limitada al núcleo V2.

**T2.5 — Primer test sobre el juego real (depende de T2.4).**
- T2.5.1 Ejecutar en Mac un input tape **privado y determinista**
  `coin1 press/release` con el GnG original traducido. Registrar qué
  instrucción lee `0x3000`, ciclo, valor leído y primer cambio
  observable respecto a idle; exportar solo métricas agregadas no privadas.
- T2.5.2 Si el nuevo control alcanza un bloque AOT ausente, fallar
  explícitamente como `UNCOMPILED` y entregar banco/PC verificados
  como dependencia de T3. **No** compilar durante runtime, inventar
  transición ni inyectar estado.
- **PASS funcional de T2:** `T2_REAL_INPUT_OBSERVED` para lectura
  real y respuesta identificada (incluido el bloqueo `UNCOMPILED`
  correctamente acotado). Si no se observa lectura, investigar timing/
  polling antes de atribuir valor de producto. **No** declarar
  gameplay funcional en este bloque.

**Cierre T2:** emitir `V3_B1_T2_DYNAMIC_PORT_READ_PASS` solo
si T2.1–T2.5 están respaldadas por evidencia correspondiente.
El primer cambio visible y verificado de Arthur corresponde a T5.

## Dependencias

```text
T1 PASS → T2.1 Ciclo bus → T2.2 Puertos → T2.3 Tests
                                                ↓
                         T2.4 Regresión V2 / no-input
                                                ↓
                         T2.5 Primera lectura real de coin
                                                ↓
                         T3 Créditos + Start y nuevos bloques AOT
                                                ↓
                         T4 Diferencial MAME → T5 Arthur controlado
```

## Exclusiones

No generar nuevas capturas MAME en T2; no recompilar rutas nuevas
con inputs hasta T3; solo *detectar* la primera desviación y fallar
cerrado donde falte código; no publicar ROM, snapshots ni AOT;
no prometer primera partida hasta T4/T5.

## Implementación B2-A (26/10/2026)

Se publicaron el bus CPU AOT con offset, el proveedor de puertos
opcional y los tests ROM-free. Hay dos artefactos nuevos,
ambos independientes de MAME/ZIP en ejecución:
`scripts/v3_b2a_build.mjs` para reconstrucción AOT privada
y `scripts/v3_b2a_coin_smoke.mjs` para no-input parity + Coin1 real.
El marcador de aceptación requiere que el operador ejecute la
regresión y el smoke con la imagen V2 privada.

[Comandos, aceptación y límites](audit/v3-b2a-input-to-game-checkpoint-2026-10-26.md).
**T2 código preparado; gate real todavía pendiente.**
