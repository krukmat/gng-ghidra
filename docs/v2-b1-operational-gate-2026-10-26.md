# V2.B1 — Entrega ejecutable y cierre condicionado

Fecha: 2026-10-26, rama `feature/a063-r1-forensics-contract`.

## Implementación creada

- **T1**: [contrato observable](audit/v2-b1-t1-contract-2026-10-26.md).
- **T2**: `src/gngb_block_key.mjs` separa despacho de compilador;
  `scripts/v2_b1_freeze.mjs` empaqueta módulo JS compilado, runtime,
  ROM de datos y overlays verificados por SHA-256 en `out/v2/b1/frozen/`
  (privado); no redistribuir. Runner desconectado de MAME/ZIP/oráculo:
  `scripts/v2_b1_run_frozen.mjs`.
- **T3**: mascara de conocido por frame, desglose de inputs del renderer;
  pre-DMA explícitamente no certificado.
- **T4**: ejecución en dos invocaciones separadas `one`/`two`,
  bytes/máscaras de frame e informes privados con hashes; gate nativo
  posterior, comparación de events/estado/píxeles e IRQ negativa ROM-free.
- **T5**: `scripts/v2_b1_certify.sh` une regresión, determinismo y
  comparación offline **después** de ambas ejecuciones.
- **T6**: `scripts/v2_b1_premerge.sh` es solamente un chequeo de
  seguridad del merge. **No integra** `main`.

## Secuencia en el Mac, sin recrear capturas ni usar MAME en runtime

```bash
git pull --ff-only
node --test tests/test_v2_b1_*.mjs
node scripts/v2_b1_freeze.mjs --freeze
node scripts/v2_b1_run_frozen.mjs --run one
node scripts/v2_b1_run_frozen.mjs --run two
bash scripts/v2_b1_certify.sh
bash scripts/v2_b1_premerge.sh
```

`--freeze` es el **único** paso que lee la ROM privada para generar
una imagen de datos y un módulo JS reutilizable, y no lee oráculo nativo.
`--run one/two` solo carga el paquete congelado. El test ROM-free usa
únicamente código y fixtures sintéticos.

`--certify` vía shell solo lee la referencia nativa T4.3 una vez
concluidas las dos ejecuciones independientes. La suite integral debe
pasar ANTES del marcador `V2_AUTONOMOUS_FRAME_CERTIFIED`.
La comparación pixel-a-pixel del gate usa estados provenientes
**de los snapshots JS**, no de la referencia.

**Preservar evidencia:** cada comando crea archivos con `wx` y se
niega a sobrescribir. Si se bloquea, no borrar `out/v2/b1/` ni el
material privado; diagnosticar primero. No hay push de `out/`.

## Estado al publicar

Scripts y pruebas implementados/publicados en feature. **No se ha
ejecutado la suite Node de repositorio, empaquetado ni gate nativo
en este entorno de GitHub sin ROM privada.** Los PASS previos de
R3.5.B2.T5 no sustituyen B1. El merge queda condicionado a
`V2_AUTONOMOUS_FRAME_CERTIFIED` real y validación post-merge.
