# Base reutilizable: checkpoint RP-0 / RP-1 (28/10/2026)

## Estado y siguientes tareas

**Dirección vigente:** la base vive en un repositorio local separado, `/Users/matias/rom-migration-base`, con revisión fija `ebec67a03a2566a8c5958bdd8d878d6047fdc4db`. No tiene remoto; el acceso es local según los permisos del propietario. Este repositorio sigue siendo dueño de GnG. La base aún contiene solo contratos, comprobación de copia fijada, documentación y pruebas sintéticas: no se ha extraído una CPU, host ni generador.

RP-0 dejó referencia privada y un escenario corto reproducido. RP-1 dejó interfaces, propietarios de constantes y una receta de GnG **en borrador**, más un lock que fija los contratos y su verificador. La salida de diseño RP-1 está cumplida: el esquema exige declarar instrucciones, IRQ, overlays y código dinámico y rechaza capacidades ausentes. La base aún no anuncia ninguna CPU. RP-2/RP-3 deben declarar cobertura real, implementar la composición GnG y terminar el inventario al mover cada componente; RP-5 instalará/actualizará la copia seleccionada. [Plan y tareas](plan-base-reutilizable-2026-10-28.md#4-plan-de-ejecución).

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
