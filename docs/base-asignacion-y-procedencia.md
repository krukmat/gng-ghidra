# Base: asignación de GnG y procedencia

La base ([`krukmat/rom-migration-base`](https://github.com/krukmat/rom-migration-base), privada) no nombra ningún juego. Lo específico de GnG que estaba en su documentación vive acá.

## Asignación de GnG

| Fuente o constante | Dueño |
| --- | --- |
| Frontera de banco `0x4000/0x6000`, selector `0x3e00`, cinco bancos | `boards/gng/` |
| `25152` ciclos por frame, IRQ de VBLANK, DMA, scroll, paleta, snapshot `REC` | `boards/gng/` |
| ALU, máscaras, servicio de instrucciones y compilador MC6809 | CPU y build de la base |
| Ejecución y compilador Z80, con la resolución dinámica documentada | CPU y build de la base; bus y tiempos de GnG en la placa |
| `gg*.bin`, revisión gngb, bits de control, DIP, 4-way y Continuar | `games/gngb/` más las entradas de la placa |
| Dos YM2203, direcciones, relación de relojes y mezcla | `boards/gng/audio/`; la síntesis reutilizable en la base |
| Tamaños de imagen `0x1a000/0xa000`, lista fija de módulos y tope de 20.000 frames | Formato de bundle heredado de GnG; el esquema de la base fija solo regiones explícitas y límites validados |
| Raster 256×224 y cadencia de frames | Salida de la placa GnG; el host de la base toma geometría y tiempo del frame y la sesión |
| Puertos del latch de sonido, mapa de RAM del Z80, cadencia de IRQ y conversión al reloj de muestras | Adaptador de audio de la placa GnG |
| Canvas, cola PCM y ciclo de vida Android | Host de la base, con los assets del producto en GnG |

El módulo de composición es `boards/gng/index.mjs#createSession`: importa los componentes fijados en `base/` y `games/gngb/index.mjs`.

## Procedencia de los componentes de la base

- Origen: este repositorio. Revisión revisada al iniciar RP-0: `889114774e3b1bc27f8c159c23c67874fe27c1d0`; referencia del consumidor en ese momento: `b8725b48cfa5bec24f1782f9cf38e24b461cac92`.
- RP-2 (revisión `1fc0557`, 29/10/2026): `src/cpu/mc6809/alu.mjs` sale de `src/mc6809_aot_lib.mjs`; `src/build/mc6809/compiler.mjs`, de `src/mc6809_aot.mjs`; la lógica de registros, IRQ y ejecución de `src/cpu/mc6809/executor.mjs`, de `src/gngb_runtime.mjs`. Compilador y ejecutor pasaron a recibir callbacks de la placa.
- RP-3 (revisión `15c9c14`, 29/10/2026): `src/gngb_z80_static_codegen.mjs`, `src/gngb_z80_irq_boundary.mjs`, `src/gngb_z80_scheduler_lab.mjs`, `src/gngb_z80_live_session.mjs`, `src/gngb_audio_resampler.mjs` y `src/gngb_audio_pcm_queue.mjs`. El compilador Z80 acepta una ROM del tamaño que da el llamador, el scheduler recibe bus y período de IRQ inyectados y el remuestreador una frecuencia de entrada explícita. Los wrappers de placa quedaron acá.
- RP-3 (revisión `5c7b0e5`): `src/devices/ym2203/{bank.cpp,wasm.mjs,build.mjs}` vienen de `src/ao_ym2203_wasm.cpp`, `src/ym2203_checkpoint.h`, `src/ao_ym2203_wasm.mjs` y `scripts/ao_build_audio_wasm.sh`. Cantidad de chips, relojes, ganancias y tamaño de bloque pasaron a parámetros, y la decodificación de direcciones a la placa. `src/host/web/engine-worker.mjs` y `audio-worker.mjs` vienen de `android/web/engine.worker.mjs` y `audio.worker.mjs`, con carga de programa, render, observadores, texto de checkpoint y productor inyectados.
- RP-4 (revisión `30cb8d5`): `src/build/mc6809/discover.mjs`, `src/build/discover-run.mjs`, `src/build/bundle.mjs` y `src/build/package.mjs` se reescribieron sobre la vista de código a partir del cierre estático, la recuperación de tablas de salto, el descubrimiento bajo demanda, el bundle congelado y las herramientas de assets web de este repositorio. Tamaños de región, disposición de bancos, nombres de archivo y límites de frames quedaron acá.
