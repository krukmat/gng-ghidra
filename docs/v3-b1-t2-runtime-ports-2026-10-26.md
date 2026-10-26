# V3.B1.T2 — Entradas deterministas en el runtime AOT

Fecha: 2026-10-26. Base: `main`. Prerrequisito: `V3_B1_T1_INPUT_CONTRACT_PASS`.

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
- **PASS:** `V3_B1_T2_DYNAMIC_PORT_READ_PASS`, sin regresiones; si no hay
  evidencia nativa nueva para el núcleo modificado, señalarla como pendiente
  de T3/T4 y no extrapolar la certificación V2.

## Dependencias

```text
T1 PASS → T2.1 Auditar bus/ciclo → T2.2 Port provider
                                  ↓
                             T2.3 Adversariales
                                  ↓
                             T2.4 Gate/checkpoint
                                  ↓
                             T3 Input tape y nuevas rutas AOT
```

## Exclusiones

No generar nuevas capturas MAME en T2; no hacer descubrimiento AOT
con inputs hasta T3; no publicar ROM, snapshots ni código generado;
no prometer primera partida hasta T4/T5.
