# R4.2.G — Puente incremental F → board (solo laboratorio)

## Alcance y estado

R4.2.G1–G3 y la comparación estructural ROM-free de G4 pueden implementarse sin ROM y sin validar aún taps reales. El contrato F `r42f-native-events.jsonl` registra orden de **callbacks Lua** y sus metadatos; no demuestra orden de instrucciones MC6809 ni posición raster. El validador F en Python sigue siendo obligatorio para capturas privadas, y la ejecución completa del runner Node/Python y MAME todavía es un gate separado.

El adaptador `src/r42g_incremental_timeline.mjs` **no** reutiliza el selector `source:'SYNTHETIC_LAB'` de D ni cambia su contrato: procesa F como material no autenticado, impidiendo elevar su procedencia. Mantiene una sola board a través de ventanas contiguas de hasta 40.000 eventos, con límite global de 1.000.000, SHA-256 del JSONL, secuencia y tiempo monotónicos, rango de direcciones y máscara estricta 0xFF. Solo se admite un checkpoint final; no inventa VBlank ni interrupciones.

## Dependencias y tareas

- **G1 — Contratos y regresiones F:** inspección del esquema `gng.r42f.native-timeline-validation.v1`, límites, longitud y hashes; ejecución de tests F real pendiente del checkout completo y MAME privado (sin GitHub Actions).
- **G2 — Estado inicial:** el tap arranca *después* del autoboot; ningún byte anterior se supone cero. Sin bootstrap, el replay requiere haber observado desde F las 512 posiciones de RAM sprite **antes del DMA**, 4.096 bytes FG/BG, 256+256 bytes de paleta y 4 bytes scroll. Faltan bytes → `BLOCKED_PRETAP_INITIAL_STATE_INCOMPLETE` sin hashes renderizables. DMA sin 512 bytes conocidos → `R42G_DMA_SOURCE_MISSING_PRETAP_BYTES`.
- **G3 — Adaptador incremental:** `replayR42gTimeline` consume líneas UTF-8 completas mediante iterador async; acumula el SHA-256 original y procesa cada evento sin cargar un millón de objetos en memoria. Las ventanas de 40K contabilizan progreso, **no reinician** la board. `scripts/r42g_replay_timeline.mjs` lee el manifiesto privado F de `out/`, ejecuta el puente y escribe únicamente estado agregado. Rechaza datos extra, secuencias con huecos, cambios de reloj, hash incorrecto, máscara distinta de 0xFF o ROM/CPU inyectados.
- **G4 — Comparador ROM-free:** si hay un `r42e.local-audit.v1` opcional, comprueba hashes de VRAM, sprites bufferizados, paleta RGBA y scroll. Con los archivos privados R0 SHA-verificados, informa **primera dirección/offset discrepante**, no valores privados. Esto no compara el PNG nativo ni sincroniza scanlines; incluso cuando todo coincide el estado es `COMPONENTS_EQUAL_TEMPORAL_ALIGNMENT_UNVERIFIED`.
- **G5 — Regresión y docs:** tests de stream >40K, estado incompleto, bootstrap alterado, checksum, mala procedencia, comparación selectiva y CLI, integrados en `scripts/r3-local-regression.sh`. El enlace a capturas reales es un gate futuro.

## Bootstrap explícito (opcional, no verificado nativamente)

R0 conserva una captura **final**, que no demuestra el estado previo a la instalación de los taps. **No se permite utilizar esa captura final como seed inicial a ciegas.** Para reproducir escenarios de laboratorio se acepta un fichero privado dentro de `out/`:

```json
{
  "schema": "gng.r42g.bootstrap.v1",
  "origin": "LAB_SYNTHETIC",
  "sha256": "<64-hex-sha256-del-contrato-y-regiones>",
  "sprite_ram": "<base64-de-512-bytes>",
  "video_ram": "<base64-de-4096-bytes>",
  "palette_ext": "<base64-de-256-bytes>",
  "palette_base": "<base64-de-256-bytes>",
  "scroll_bytes": "<base64-de-4-bytes>"
}
```

`PRE_TAP_UNATTESTED` es un origen alternativo explícitamente **no autenticado**, no una forma de certificar MAME. El digest se calcula mediante `r42gBootstrapDigest(seed)`, concatenando esquema, origen y regiones en ese orden. No se puede declarar equivalencia temporal por una coincidencia de hashes.

## Comandos (solo archivos privados y legítimos)

```bash
git pull --ff-only
bash scripts/r3-local-regression.sh
node scripts/r42g_replay_timeline.mjs \
  --reference-dir out/reference/mame \
  --out out/r3/r42g-incremental-replay.json
```

Si hay un seed legítimo anterior a los taps y una auditoría R0 local:

```bash
node scripts/r42g_replay_timeline.mjs \
  --reference-dir out/reference/mame \
  --bootstrap out/r3/r42g-bootstrap.json \
  --r0-audit out/r3/r42e-reference-audit.json \
  --out out/r3/r42g-incremental-replay.json
```

Sin `manifest.json` con validación F estructural, aborta. Sin estado inicial suficiente, devuelve un reporte `BLOCKED_...` y el CLI sale con código 2. La salida contiene únicamente conteos, porcentajes de cobertura, hashes y offset/región de divergencia: **no** bytes de ROM, registros CPU ni imágenes nativas.

## No se considera PASS nativo

Prohibido atribuir `native_origin_attested`, `native_instruction_alignment_verified`, `native_raster_vblank_verified` o `native_pixel_equivalence_verified` a una ejecución G. La certificación requiere taps Lua ejecutados realmente en MAME, snapshot pre-tap vinculado temporalmente, alineamiento por instrucción/banco A0.6.3, IRQ/SYNC y comparación independiente del framebuffer con VBlank real. Esta parte permanece bloqueada externamente.
