# R4.2.E — Contrato de evidencia y correlación con R0

## Estado de entrada verificable

`scripts/capture-mame-frame.lua` captura RAM FG (2.048 bytes), BG (2.048), último buffer DMA (512), colores RGBA (1.024), scroll X/Y y `reference.png` 256×224. `scripts/capture_real_frame.py` produce `manifest.json` con hashes SHA-256, driver, frame y contador de DMA.

**Limitación decisiva:** el capturador R0 actual registra que ocurrieron transferencias DMA, pero **no registra un log ordenado de cada escritura de VRAM, paleta y DMA asociado a una instrucción MC6809 o un punto exacto del raster**. La captura de un único frame y sus bytes finales no establece temporalidad ni identidad 1:1 de eventos. Los SHA de un manifiesto local tampoco acreditan por sí mismos quién creó sus archivos.

## Tareas implementadas

- **E1 — Contratos.** La única fuente de R0 aceptada declara `gng.mame-video-capture.v1`, `gng.mame-video-state.v1`, driver coherente y `NATIVE_REFERENCE_CAPTURED_NOT_JS_EQUIVALENCE`. Se rechaza cualquier afirmación de equivalencia JS o procedencia nativa autenticada.
- **E2 — Integridad.** `src/r42e_snapshot_integrity.mjs` recalcula SHA-256 de los cinco artefactos, verifica longitud de FG/BG/DMA/paleta, firma y dimensiones IHDR del PNG, cuentas DMA y scroll little-endian del estado. Resultado `REFERENCE_BYTES_MATCH_MANIFEST_ORIGIN_UNATTESTED`: solo autoconsistencia, no validación externa de procedencia. El PNG solo se inspecciona estructuralmente, **no se decodifica ni compara píxel a píxel**.
- **E3 — Comparación de checkpoints.** `src/r42e_checkpoint_compare.mjs` acepta únicamente un reporte R4.2.D etiquetado **sintético**, y compara SHA de 4 KiB de VRAM, 512 bytes DMA, 1 KiB RGBA de paleta, X e Y. Informa componentes distintos; incluso con coincidencia total devuelve `SNAPSHOT_COMPONENTS_MATCH_TEMPORAL_PROOF_MISSING`, jamás un PASS nativo.
- **E4 — Adversarial.** Tests de alteración de bytes, tamaños/hashes/nombres, falso DMA, inconsistencia de scroll, cabecera PNG, procedencia falsa, checkpoint repetido, valores inválidos y rutas fuera de `out/`. Fixtures enteramente sintéticos; las pruebas no generan archivos ROM en Git.
- **E5 — CLI y documentación.** `scripts/r42e_native_reference_audit.mjs` lee archivos **solo del directorio privado ignorado `out/`**, y genera `out/r3/r42e-reference-audit.json`. Las pruebas se agregan a `scripts/r3-local-regression.sh`; no se utilizan Actions.

## Comandos para cuando exista captura R0 local

Solo integridad de la referencia:

```bash
node scripts/r42e_native_reference_audit.mjs --reference out/reference/mame
```

Comparación informativa con checkpoint sintético R4.2.D (una diferencia es esperable):

```bash
node scripts/r42d_visual_replay_lab.mjs
node scripts/r42e_native_reference_audit.mjs --reference out/reference/mame \
  --lab-report out/r3/r42d-event-replay/report.json --checkpoint second-dma
```

Estos comandos **no capturan eventos** ni validan la identidad del banco; si faltan archivos privados, fallan de forma explícita. No publicar `out/`, ROM, dumps, PNG ni informes con materiales de la ROM.

## Bloqueo para E nativo real

Se requiere **nueva evidencia nativa adquirida en un único MAME privado, no un fixture fabricado**, con los siguientes atributos verificables:

1. Identificador de corrida y hashes de ROM/programa vinculados a manifest, frame y captura de vídeo.
2. Log secuencial de escrituras `0x1E00–0x1FFF`, `0x2000–0x2FFF`, `0x3800–0x39FF`, `0x3B08–0x3B0B` y activaciones `0x3C00`, con `address,data,mask`, orden exacto y contrato de callback MAME.
3. Checkpoint de buffer **después** de cada DMA y estado de paleta/scroll en los mismos límites de captura; no asumir que la memoria del CPU equivale al buffer visible.
4. Correlación del frame/ciclo/scanline real, reset y cambios de IRQ/SYNC; sin alineamiento confirmado no afirmar primer frame autónomo.
5. Correspondencia con la traza MC6809 y banco por instrucción A0.6.3 para reclamar ejecución nativa y comparabilidad de temporización.

Solo después de verificar esa instrumentación en MAME privado se podrá construir un importador de eventos nativos, independiente de `SYNTHETIC_LAB`. **STOP** ante saltos de secuencia, ventanas raster desconocidas, falta de DMA, hashes alterados o diferencias sin explicar. No desbloquear A0.6.3 mediante la mera igualdad de hashes de VRAM.
