# Base reutilizable: checkpoint RP-0 / RP-1 / RP-2 (29/10/2026)

## Estado y siguientes tareas

**Dirección vigente:** la base vive en un repositorio local separado, `/Users/matias/rom-migration-base`, ahora en `86cb95ecc0fc07d1a03b2b8bab0d890b4475874d`. No tiene remoto; el acceso es local según los permisos del propietario. Este repositorio sigue siendo dueño de GnG. RP-2 extrajo el compilador, ALU y ejecutor MC6809; Z80, host, audio, formato nuevo de artefacto y generador siguen pendientes. [Plan y tareas](plan-base-reutilizable-2026-10-28.md#4-plan-de-ejecución).

RP-0 dejó referencia privada y un escenario corto reproducido. RP-1 dejó interfaces, propietarios de constantes y una receta de GnG **en borrador**. RP-2 añadió una declaración conservadora de MC6809: IRQ, overlays precompilados exactos, sin código dinámico, y rechazo de opcodes o valores desconocidos. La receta privada completa aún falla con `MIGRATION_CAPABILITIES_MISSING` porque Z80, su IRQ/NMI y la resolución dinámica son RP-3. La composición host y la instalación automatizada de la copia seleccionada siguen en RP-3/RP-5.

## RP-2 — extracción 6809 (29/10/2026)

- **Origen y propiedad:** `src/mc6809_aot_lib.mjs`, `src/mc6809_aot.mjs` y la parte CPU de `src/gngb_runtime.mjs` se extrajeron a `rom-migration-base/src/cpu/mc6809/` y `src/build/mc6809/`. La base no importa `gngb_block_key` ni conoce `0x4000/0x6000`. `boards/gng/code-view.mjs` y `boards/gng/runtime.mjs` conservan mapa, bancos, bus, línea IRQ, DMA, paleta, scroll, latch y snapshots; `games/gngb/code-image.mjs` conserva los nombres y la disposición de los chips de esta revisión. Los bundles originales permanecen intactos.
- **Copia fijada:** `base/src/` contiene seis componentes seleccionados, idénticos a la revisión local `86cb95e`. La receta RP-1 y el lock `rp1-v4/` permanecen como historial; el lock privado vigente es `out/base-reference/rp2-v1/migration.lock.json`, derivado y verificado por `scripts/rp2_lock.mjs`. Su revisión íntegra es `86cb95ecc0fc07d1a03b2b8bab0d890b4475874d`. Verificación de copia y compatibilidad MC6809: PASS. Receta GnG completa: rechazo esperado por Z80 ausente.
- **API nueva:** compilador con `read/resolve/identity` por espacio, contexto, overlay y PC; ejecutor con `advance(untilCycle)`, `runUntilFrame(frame)`, reset y servicio IRQ. La placa decide cuándo afirmar IRQ. La ruta nueva tiene `exportState/importState` nativos y guarda el mismo estado CPU/placa de `gng.checkpoint.v1`, sin aplicar `ao_resumable_runtime` ni `checkpoint_runtime` al archivo fuente nuevo. El formato completo, Z80, YM y workers siguen en RP-3.
- **Pruebas sintéticas:** 8/8 en la base con Node 22.23.0, también 8/8 con Node 26.11.1. Incluyen dos disposiciones físicas de ROM, dos contextos bancarios con bytes distintos, corte tras escritura, reanudación y límite de ciclo absoluto. Las 16 pruebas dirigidas de CPU/audio/checkpoint de GnG pasaron en Node 22.23.0.
- **Comparación privada fijada:** `scripts/rp2_compare.mjs` usó `out/v3/b3/g6/frozen/` y `reference-v3.json` para comparar referencia, fuente actual y placa extraída. En 120 frames sin entrada: ciclo final `3018242`, hashes de snapshots, eventos y registros iguales; ejecución continua, por frame y restauración en frame 60 iguales (`out/base-reference/rp2-compare-120-v3.json`). En 900 frames con la cinta local del 29/10 que cambia el recorrido: ciclo final `22636799`, igualdad de snapshots, 1770 lecturas de puerto, cinco eventos de audio, eventos CPU y registros; restauración en frame 450 igual (`out/base-reference/rp2-compare-tape-900-v3.json`). La comparación de 1500 frames de la misma cinta también pasó (`rp2-compare-tape-1500.json`).
- **Compilador extraído frente a la referencia:** `scripts/rp2_compile_probe.mjs` compiló desde los vectores y resolvió faltantes explícitamente. En 900 frames sin entrada produjo 374 bloques en 55 pasos; con la cinta produjo 418 bloques en 57 pasos (244 fijos, 158 bancarios y 16 de overlay RAM). Ambos recorridos terminaron con el mismo estado CPU, ciclo, secuencia de snapshots y eventos que el programa AOT privado fijado. No se guardó código generado nuevo en la base.

**Impacto de los commits de hoy:** `6f86ac5` (web) y `1fc0557` (Android) añadieron guardado/carga de sesión con estado exacto de audio. RP-2 incorporó la frontera CPU/placa y comprobó restauración en frame 450; RP-3 debe preservar el estado Z80/YM/PCM y el protocolo de workers. El bundle de RP-0 es anterior y sigue siendo el oráculo semántico de CPU. No se atribuye a esta prueba la paridad de audio ni de la interfaz web/Android.

**Pendientes ejecutables:** en RP-3 extraer Z80 y bus sonoro, YM/PCM y host, declarar sus capacidades y conectar la sesión compuesta; ejecutar regresiones de audio/checkpoint web y Android. En RP-4 fijar formato y build desde binario original; en RP-5 automatizar la copia/actualización seleccionada y la receta completa; en RP-6 repetir los escenarios de GnG y rendimiento con esa composición. El GO de RP-2 solo cubre la ruta MC6809/placa probada.

## Referencia reproducible

- Checkout de GnG al iniciar: `b8725b48cfa5bec24f1782f9cf38e24b461cac92`. Las nuevas herramientas y este checkpoint son cambios posteriores.
- Bundle seleccionado explícitamente: `out/v3/b3/g6/frozen/`, formato `gng.v2.b1.frozen-aot.v1`, 38.084 entradas y 6.000 frames declarados. Su propio manifiesto registra el origen `b655e54c252b19cb2f2521931a6b4ec88a4b5153`; no se confunde con el HEAD del consumidor ni con la revisión `8891147` usada para analizar el plan.
- `out/base-reference/reference-v3.json` fija SHA-256 y tamaños del ZIP original, WASM y cada archivo del bundle, además de versiones disponibles de herramientas; comprueba que el WASM coincide con su manifiesto de build. `rp1-v4/migration.json` fija hashes por región original; `rp1-v4/migration.lock.json` fija revisión y hashes de los dos componentes iniciales de la base. Todos son locales, privados e ignorados por Git. Las recetas/locks anteriores quedaron superados por `rp1-v4/`.
- Versiones observadas: Node 22.23.0, Python 3.15.0, Gradle 8.9, AGP 8.7.3, Kotlin 1.9.25, JDK 17, Playwright Core 1.64.1, Emscripten 4.0.15 para el WASM existente, ymfm `81aec25ccbb98f4873a255f7551ac4dadac59b4a`. El `emcc` no estaba en PATH al registrar la referencia. MAME instalado: 0.288; cualquier gate que requiera 0.289 debe comprobar y preparar esa versión antes de ejecutarse.
- Dependencias externas identificadas: ymfm BSD-3-Clause (aviso local `out/audio/ymfm/LICENSE`), Playwright Core/Chromium, Emscripten, Gradle/Android Gradle Plugin/Kotlin, AndroidX WebKit, JDK y MAME como oráculo. No se han copiado fuentes ni binarios externos a la base. Revisar avisos exactos cuando se incorpore o distribuya cada componente.
- Seis ejecuciones de 120 frames desde reset, sin entradas, sobre el mismo bundle: `FRAMES_DONE`, ciclo final `3018242`, hashes de frame 1/60/120 idénticos. Solo se midió `board.run()` tras importar módulos y crear la placa: **0,117–0,248 ms/frame** en seis procesos Node separados en este Mac ARM (las tres últimas: 0,117–0,121). La variación impide usarlo aún como tolerancia; tampoco mide render/audio/Android. Reportes: `out/base-reference/baseline-120*.json` y `baseline-v2-r*.json`.

Repetir el escenario corto con rutas explícitas:

```bash
node scripts/rp0_reference.mjs out/v3/b3/g6/frozen roms/gng.zip out/android/audio/ym2203.wasm out/base-reference/otra-referencia.json
node scripts/rp0_baseline.mjs out/v3/b3/g6/frozen 120 out/base-reference/otro-baseline.json
node scripts/rp1_gng_recipe.mjs ../rom-migration-base roms/gng.zip out/base-reference/otra-receta
```

Estos comandos crean archivos nuevos; no sobrescriben la evidencia anterior.

## Matriz de evidencia reutilizable

| Escenario | Demostrado ahora o en evidencia local existente | Pendiente para la extracción |
| --- | --- | --- |
| Arranque corto | 120 frames reproducidos 6 veces con mismo ciclo y hashes; reportes RP-0 | Comparar CPU/placa nueva contra esta referencia |
| Coin/Start | `out/android/check/ao4-report.json`: PASS; un arranque con lecturas reales de moneda y Start | Repetir con base extraída y revisión fija |
| Movimiento, salto y ataque | `ao4-report.json`: seis controles leídos; `stick-android-report.json`: PASS en emulador | Comparar cronología e imagen del host nuevo; prueba física en teléfono no atribuida a este checkpoint |
| Game Over/Continuar | `ao4-gameover-report.json`: PASS y vuelta a juego | Repetir secuencia tras composición |
| Scroll/DMA/vídeo | 15 pruebas dirigidas de renderer y DMA PASS ahora; `ao2-report.json`: 290/290 frames dibujables iguales entre Node y navegador | Escenas de scroll/DMA de juego real contra referencia y base extraída |
| Sonido ON/OFF | `ao5-report.json`: PCM WASM/nativo idéntico en su alcance; `ao6-report.json`: GO en fases OFF/ON, cambios y sesión nueva | Repetir PCM/host con base extraída; no inferir paridad Z80 con MAME de este resultado |

Los informes previos documentan alcances distintos y pueden referirse a otra generación o cronología. La matriz identifica candidatos para RP-6; no transfiere un PASS a la base nueva.

## Privacidad y propiedad

La base ignora `roms/`, `out/`, ZIP, binarios, APK y claves. No contiene el árbol `cfg/` ni `gng-ghidra/` sin seguimiento, ni archivos ROM, código generado, capturas o trazas. El `migration.json` privado nombra módulos futuros `boards/gng/index.mjs` y `games/gngb/index.mjs`; todavía no son ejecutables. Los contratos de la base y la tabla de propietarios están en `docs/contracts.md` del repositorio hermano.
