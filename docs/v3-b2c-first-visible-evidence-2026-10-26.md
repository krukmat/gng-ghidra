# V3.B2-C — First Visible Evidence (Fast Visual Lane)

Fecha: 2026-10-26. Rama: `main`.
**Evaluación y plan, no gate ejecutado.**
Objetivo: mostrar fotogramas auténticos de *Ghosts 'n Goblins*
renderizados desde ejecución MC6809 AOT **tan pronto como sea posible**,
sin esperar la cobertura de todos los caminos de partida.

## Decisión de ruta crítica

El gate B2-A cerrado aporta 600 frames `no-input` idénticos a V2,
354 bloques AOT, 183 lecturas SYSTEM, dos de Coin1 activo, primera
divergencia de estado en frame 421 y una ruta AOT no compilada tras
el frame 492. El nuevo bloque B2-B de 1000 frames está implementado
pero pendiente de ejecutar en el Mac. **No bloquear B2-C por B2-B.**

Reutilizar, sin inventar escenas:
- `out/v2/b1/one-frames.bin`, `one-known.bin`,
  `one-meta.jsonl`, y `verifySlot` como idle verificado.
- `out/v3/b2a/frozen/` como runtime GnG con inputs y código
  AOT ya validado en el Mac; `coin-smoke.json` para delimitar.
- `src/gngb_frame_renderer.mjs` (`256x224`) y
  `rendererInputs` / `gngbGraphics` de
  `scripts/r35_t5_render_check.mjs` para producir RGBA verdadero.
- `rendererUnknownCount` para no renderizar como certeza
  memoria de vídeo sin conocer o sprite DMA aún inválido.
- ROM `roms/gng.zip` exclusivamente **local** para decodificar
  gráficos; no distribuir vídeo, imágenes, ROM ni AOT.

## Tasks (un máximo de dos niveles)

### B2-C.T1 — Primera imagen GnG auténtica (paralela a B2-B)

- T1.1 Leer y autenticar slot idle de V2; seleccionar fotogramas
  posteriores al primer DMA (311–600) con todos los bytes
  del renderer conocidos.
- T1.2 Renderizar al menos un fotograma con el **compositor existente**
  y los gráficos privados; crear `out/v3/visual/idle.html`
  independiente del navegador/servidor, sin mock, synthetic fixture
  ni capturas MAME como fuente del resultado.
- **GO:** `V3_VISUAL_IDLE=PASS_REAL_AOT_RENDER`, imagen visualizable
  `256×224` y hashes asociados al snapshot V2 certificado.
  **STOP:** composición dibujada, bytes desconocidos forzados a cero
  o captura MAME mostrada como si fuera resultado JS.

### B2-C.T2 — Antes/después de Coin1, comparativa A/B

- T2.1 Reejecutar **solo en el Mac** el paquete congelado B2-A
  con una secuencia de Coin1 idéntica a la ya probada
  (pulsar frame 420, soltar frame 422), y sin inputs en otra
  corrida. Mantener snapshots de ambas en `out/v3/visual/`.
  **Detener en 491**, antes de la ruta no compilada de 492.
- T2.2 Comparar bytes/known/state y, únicamente para frames
  con renderer completamente conocido en ambas corridas,
  RGBA pixel a pixel. Priorizar el barrido 421–491; almacenar
  sólo fotogramas seleccionados para mantener HTML compacto.
- **GO diagnóstico:** `V3_VISUAL_COIN_COMPARE=PASS_REPLAY_A_B`
  cuando ambos runs están alineados por frame y comparados.
- **GO visual condicional:** `V3_VISUAL_COIN_PIXELS=PASS_VISIBLE_DELTA`
  solo si cambia al menos un píxel por efecto de Coin1.
  En caso contrario emitir `NO_VISIBLE_DELTA_WITH_CPU_EFFECT`:
  un cambio en hashes de RAM/estado **no** es un cambio de imagen.

### B2-C.T3 — Visor offline con valor visual

- T3.1 Producir `out/v3/visual/compare.html` usando canvas,
  frame index, perfiles idle/coin, scroll de timeline y contador
  de píxeles distintos. El HTML debe visualizar exactamente
  los RGBA renderizados, no animación ni elementos gameplay
  hardcoded. Puede reutilizar el patrón `fixtureHtml` de
  `scripts/r42_visual_fixture.mjs`, reemplazando íntegramente
  fixtures sintéticos por estados GnG reales.
- T3.2 Incluir etiquetas claras: fuente AOT, frame, límites
  de conocimiento, estado `UNCOMPILED`, evidencia de CPU
  y si el resultado es/no es equivalente a MAME para inputs.
- **GO:** `V3_VISUAL_VIEWER=PASS_OFFLINE_REAL_FRAMES`,
  se abre directamente en navegador local (sin app/proyecto nuevo).
  Un viewer con frames idénticos puede pasar T3 y dejar T2 visual
  condicional claramente pendiente.

### B2-C.T4 — Inicio de partida, incorporación gradual de B2-B

- T4.1 Cuando B2-B entregue paquete frozen Coin/Start válido,
  reutilizar el mismo renderer para fotogramas `start` y
  compararlos con `coin`. No exigir completar 1000 frames
  si ya hay una ventana AOT válida y renderizable; registrar
  explícitamente el primer bloque que impide avanzar.
- T4.2 Solo cuando Arthur cambie de posición **por efectos
  de código recompilado**, crear secuencia visual del movimiento
  o salto; después cotejar timing/píxeles con nueva referencia
  MAME de la misma secuencia.
- **GO:** `V3_FIRST_PLAYABLE_VISUAL_CANDIDATE` condicionado
  a START procesado y cambio visible atribuible a movimiento/
  salto. **No certificar partida ni jugabilidad** por una
  simple diferencia visual del menú/attract.

## Priorización y viabilidad

| Entrega | Viabilidad | Dependencia real |
|---|---|---|
| Primer frame idle de GnG | Alta | V2 y ROM gráfica privada ya disponibles |
| Viewer offline de frames reales | Alta | T1, compositor JS validado |
| Diferencia visual de Coin1 | Incierta | T2 puede mostrar cambios solo de RAM |
| Primera pantalla tras Start | Condicionada | B2-B debe alcanzar y compilar esa ruta |
| Arthur moviéndose o saltando | Condicionada | Start funcional, ruta AOT completa, sprites, inputs |

**Orden:** T1 → T2 → T3 en paralelo con B2-B →
T4 solo cuando la ruta Coin/Start esté disponible.

## Límites, seguridad y aceptación

No alterar runtime, compilador AOT, renderer, scripts del gate V2
ni hashes de los artefactos congelados. Generar exclusivamente
en `out/v3/visual/`, ignorado por git. El visor no depende
de MAME en ejecución; carga gráficos del archivo privado
para renderizar, sin descargar recursos externos ni usar
datos sintéticos. El test visual de input NO hereda por ello
la equivalencia de píxeles de V2 frente a MAME:
se necesita nuevo oráculo sincronizado en fase posterior.

**Primer entregable preferente:** `idle.html` de GnG real,
más `compare.html` con el A/B Coin1 y diagnóstico honesto
de diferencias visibles/no visibles. No esperar al gate
`V3_B2B_DISCOVERY=PASS_1000_FRAMES_AOT_OFFLINE`
para entregar estas imágenes.
