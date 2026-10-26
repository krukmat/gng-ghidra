# V2.B1 — Cierre de V2 y transición feature → main

Fecha: 2026-10-26. Rama: `feature/a063-r1-forensics-contract`.

**Decisión:** B1.T6 se ejecutará **después** de B1.T5,
`V2_AUTONOMOUS_FRAME_CERTIFIED`, nunca antes. B1 no constituye
certificación por existir el código o por los 594 frames previos.

## Dependencias

```text
B1.T1 Contrato de aceptación
  ├── B1.T2 AOT cerrado y autónomo
  └── B1.T3 RAM desconocida de los frames 1–6
           ↓
B1.T4 Comparación y determinismo
           ↓
B1.T5 Certificación V2
           ↓
B1.T6 Cierre feature y merge a main
           ↓
V3.B1 Inputs, desde main/una nueva rama
```

## Tasks y criterios verificables

**B1.T1 — Contrato V2.** T1.1 definir primer frame observable, estado
comparable y alcance; T1.2 asociar evidencia y hashes a una revisión
del código. **PASS:** contrato congelado, sin confundir tests sintéticos
con referencia nativa.

**B1.T2 — AOT congelado.** T2.1 manifestar bloques alcanzables (354
según el último informe; revalidar) y hashes; T2.2 ejecutar el módulo
ya generado sin MAME/oráculo, sin decodificación de ROM ni
descubrimiento/recompilación en el runtime. **PASS:** arranque desde
reset y generación de frames sin dependencia de MAME; código desconocido
falla en cerrado.

**B1.T3 — Primeros seis frames.** T3.1 identificar bytes de RAM no
inicializada y usos posteriores; T3.2 demostrar que su incertidumbre
no afecta los píxeles o el control observable, o delimitar el primer
frame completamente definido. **PASS:** ninguna lectura desconocida
aceptada silenciosamente ni cero supuesto.

**B1.T4 — Validación diferencial.** T4.1 contrastar hasta 600 frames
generados desde estado JS contra MAME, *solo después* de ejecutar; T4.2
verificar hashes idénticos en dos runs independientes; T4.3 controles
negativos de IRQ/timing y dependencia faltante. **PASS:** equivalencia
de frames observables dentro del contrato B1.T1, determinismo y
detección de divergencias. No atribuir 600/600 píxeles solo porque
594 frames completamente conocidos coinciden.

**B1.T5 — Gate V2.** T5.1 ejecutar regresión Node/Python y gate
nativo privado; T5.2 registrar resultados, límites y revisión.
**PASS:** `V2_AUTONOMOUS_FRAME_CERTIFIED`; si T3/T4 siguen pendientes,
no declarar V2 cerrado.

**B1.T6 — Cierre del feature → integración en main.**
- **T6.1 Pre-merge:** T1–T5 PASS, checkpoint revisado y aceptado,
  rama limpia, revisar diferencias respecto de `main`, conflictos y
  ejecución de suites. Auditar *solo código, tests y documentación*:
  excluir ROM, gráficos extraídos, logs, PNG, capturas, binarios,
  `out/` y JS AOT generado que contenga bytes de ROM.
- **T6.2 Merge:** PR revisado o fast-forward si es seguro, sin
  force-push ni pérdida de commits de `main`. No mezclar V3/V4.
- **T6.3 Post-merge:** verificar HEAD final en `main`, correr
  regresión ROM-free y gate V2 privado donde esté disponible; registrar
  commit/hashes y comprobar el resultado. Solo entonces emitir
  `V2_FEATURE_MERGED_MAIN`.
- **T6.4 Handoff:** dejar de trabajar en la feature anterior; no
  eliminarla hasta post-merge PASS. V3 comienza desde `main` o rama
  nueva creada desde él; V4/audio queda posterior.

## Estado al registrar esta tarea

R3.5.B2.T5 documenta 600 frames desde reset y 594 totalmente definidos
y exactos. Es una **base para B1**, no prueba de que B1.T1–T6 hayan
pasado. Este cambio no inicia ni aprueba automáticamente el merge.

## Implementación B1 publicada (26/10/2026)

El gate operativo ya tiene scripts ROM-free, freezer AOT privado, dos
runs offline de 600 frames, comparador posterior frente a MAME y
preflight de merge. [Comandos, evidencias y límites](v2-b1-operational-gate-2026-10-26.md).
**No afirmar PASS B1.T2–T6** hasta observar resultados locales.
No tocar `main` todavía.

## Estado B1.T5 — certificado por operador (26/10/2026)

Recibidos marcadores `V2_AUTONOMOUS_FRAME_CERTIFIED`,
600 frames, 594 estados exactos, 290 frames de píxeles exactos
(311–600), 6 imágenes distintas. Los 310 frames anteriores **no**
tienen certificación de píxeles. [Detalle](audit/v2-b1-certification-main-2026-10-26.md).

B1.T6: integración solo por fast-forward desde `main`, sin archivos
privados, y validación posterior obligatoria en Mac mediante
`bash scripts/v2_b1_postmerge.sh`.
