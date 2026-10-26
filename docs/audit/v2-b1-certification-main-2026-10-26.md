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

## Resultado remoto B1.T6.2 — 26/10/2026

`main` recibió **fast-forward** de
`f96acf868c61c89d758beb06e66ec46ff33444aa` a
`417c6d14ea0e61b37a21eacbf76b6050bf3bd5fa`, usando lease
`expected_sha` y verificación de la nueva referencia.

Chequeos remotos: `main` era ancestro directo de feature;
comparación `behind_by=0`, sin rutas ROM/`out/`, trazas,
imágenes PNG ni binarios privados detectados en los 145 archivos
cambiados; núcleo AOT/runtime/gfx idéntico al checkpoint de freeze
`0c3ba3494b984785b5dd6183998c07494a8ee6d6`.

La rama feature queda preservada. El chequeo de árbol local/estado
de los volúmenes privados no está disponible para el conector y
**T6.3 post-merge continúa pendiente** hasta ejecutar en Mac
`bash scripts/v2_b1_postmerge.sh` sobre `main`.

No emitir `V2_FEATURE_MERGED_MAIN` antes del postflight.

## B1.T6.3 — Resultado final de post-merge (26/10/2026)

El operador confirmó los siguientes marcadores desde Mac sobre `main`:

```text
GNG_LOCAL_REGRESSION=PASS_ROM_FREE_A0_2_TO_A0_6_3
GNG_LOCAL_REGRESSION=PASS_ROM_FREE_R3_R42H
V2_B1_T4_DETERMINISM=PASS_TWO_INDEPENDENT_RUNS
V2_B1_T4_FRAMES=600
V2_B1_T6_POSTMERGE_NATIVE_GATE=PASS_RECOMPUTED_READ_ONLY
V2_B1_T6_STATE_EXACT=594
V2_B1_T6_PIXEL_EXACT=290
V2_FEATURE_MERGED_MAIN=PASS_POSTMERGE
```

**V2.B1.T1–T6 cerradas.** Esta certificación valida el port
AOT autónomo para las rutas observadas; 290 frames consecutivos
(311–600) tienen píxeles exactos, y los primeros 310 siguen
sin equivalencia visual certificada. Entradas, audio y nuevas
rutas de juego quedan para V3/V4.
