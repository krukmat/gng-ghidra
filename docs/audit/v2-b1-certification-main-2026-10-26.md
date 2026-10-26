# V2.B1 — Certificación nativa y traspaso a main

Fecha: 2026-10-26.

## Evidencia reportada desde el Mac (no ejecutada en el conector)

```text
V2_AUTONOMOUS_FRAME_CERTIFIED
V2_B1_FRAMES=600
V2_B1_STATE_EXACT=594
V2_B1_PIXEL_EXACT=290
V2_B1_PIXEL_INTERVAL=311..600
V2_B1_PRIOR_PIXELS_UNVERIFIED=310
V2_B1_DISTINCT_PIXELS=6
V2_B1_FIRST_RENDERER_KNOWN=311
```

Interpretación estricta: la CPU recompilada ejecutó 600 frames
deterministas desde reset. 594 frames tienen estado totalmente conocido;
290 frames consecutivos (311–600) fueron renderizados desde estado JS
y cotejados pixel a pixel contra PNG MAME, con 6 imágenes distintas.
**Los primeros 310 frames no quedan certificados en píxeles**,
incluidos los 6 con RAM todavía no escrita. No se utiliza MAME ni
se reinyecta estado durante el runtime congelado.

## T6 Preflight remoto

Antes de mover `main`, comparar ramas (GitHub) y comprobar:
- `main` ancestro de feature, fast-forward posible.
- Sin nuevos archivos ROM, logs, `out/`, capturas o binarios en el diff.
- Sin modificaciones del núcleo AOT/runtime/gfx entre la revisión de
  freeze y la actual.
- Contrato nativo V2 cumplido por marcadores aportados por operador.

El estado del working tree local y el contenido de
`out/v2/b1/certification.json` son privados del Mac y no visibles
por GitHub: no pueden declararse verificados remotamente.

## T6 Postflight

Tras integrar el código en `main` por fast-forward, la validación
completa del cierre se hará en el Mac sobre el HEAD de `main`:

```bash
git switch main
git pull --ff-only
bash scripts/v2_b1_postmerge.sh
```

Este script revalida, sin sobrescribir, la integridad de ambos
runs, tests ROM-free y el gate nativo ya registrado, contrastando
`certification.json` con un resultado recalculado.

**T6 no se declara cerrado hasta obtener
`V2_FEATURE_MERGED_MAIN=PASS_POSTMERGE`.**
No borrar feature ni archivos locales privados antes del postflight.
