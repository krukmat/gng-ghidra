# Base reutilizable para nuevos proyectos de migración

**Dirección vigente:** crear un repositorio separado para extraer de esta versión una base agnóstica y versionada, con herramientas para generar proyectos independientes. Cada proyecto contendrá un juego integrado y generado desde sus binarios originales. Este repositorio conserva GnG como primera integración de referencia y consumidor de la base. La implementación de placa y la integración de juego quedan fuera del repositorio compartido; los compiladores se reutilizan por arquitectura de CPU.

**Estado actual (31/10/2026):** RP-0 a RP-5 completadas; RP-6 diferida hasta clonar otro juego. Sigue la verificación final del proyecto. La base local está en `090c44dba90c26bea5886b6450ebc765cfa39c86`, lock v8; GnG se construye desde `roms/gng.zip` con `base/tools/migrate.mjs`. RP-3 extrajo Z80, transporte PCM, protocolo AudioWorklet, reloj de frames, banco YM2203, hosts de navegador de engine y audio y la plantilla del shell Android. GnG entra por la receta (`boards/gng/index.mjs#createSession`, y el build de assets aplica las mismas comprobaciones), y web, escritorio y Android usan la misma app sobre esos hosts. La prueba en un teléfono físico se hace en la verificación final del proyecto (decisión del operador, 31/10/2026). La base está en el repositorio privado [`krukmat/rom-migration-base`](https://github.com/krukmat/rom-migration-base), versión `v0.1.0` (`bec61dd`), con generador de proyectos. GnG sigue fijado en `090c44d`: los 28 archivos que copia son idénticos en `v0.1.0`. La base no está certificada. [Checkpoint y resultados RP-3](rp0-rp1-checkpoint-2026-10-28.md#rp-3--z80-audio-y-worker-29102026). `cfg/` y `gng-ghidra/` siguen fuera de la extracción.

**Tareas ejecutables propuestas:** [RP-0: referencia](#rp-0--fijar-la-referencia), [RP-1: contratos](#rp-1--definir-las-fronteras), [RP-2: CPU y placa](#rp-2--separar-compilación-cpu-y-placa), [RP-3: host y audio](#rp-3--separar-host-audio-e-interfaz), [RP-4: construcción](#rp-4--construir-desde-el-binario-original), [RP-5: proyecto nuevo](#rp-5--generar-un-proyecto-independiente), [RP-6: certificación](#rp-6--certificar-y-versionar-la-base).

El análisis previo se concretó en esta conversación. Las fuentes enlazadas abajo justifican los puntos de extracción; los planes históricos de [jugabilidad](plan-100pct-jugable-2026-10-26.md) y [Android](plan-android-offline-2026-10-28.md) conservan sus propios hitos. Este plan no declara esos hitos completados ni sustituye su ejecución.

## 1. Resultado esperado y límites

Un nuevo proyecto debe poder fijar una versión de la base, declarar su CPU y placa, verificar sus propios binarios, generar sus artefactos y empaquetar una aplicación con un único juego integrado. Crear otro proyecto no debe exigir modificar la base para introducir nombres de chips ROM, direcciones del juego o reconocimiento de pantallas.

Esta extracción incluye herramientas de migración, ejecución y validación. No incluye incorporar ahora otro juego, completar toda la ISA 6809/Z80, implementar otras CPUs, certificar otras placas ni crear carga intercambiable de juegos en ejecución. La arquitectura admite extensiones concretas cuando una migración las necesite.

La reutilización depende del caso:

| Nuevo proyecto | Componentes que puede compartir | Trabajo propio que sigue siendo obligatorio |
| --- | --- | --- |
| Otra revisión compatible con la misma placa | Compiladores, dispositivos, implementación de placa, host y herramientas | Identificación de ROM, generación, cobertura y validación de esa revisión |
| Otra placa con CPU ya soportada | Compilador de esa CPU, ejecución extraída, dispositivos coincidentes, host y herramientas | Mapa, bancos, conexión de dispositivos, interrupciones, vídeo y pruebas propias |
| Otra arquitectura de CPU | Host, contratos aplicables, empaquetado y método de validación | Compilador y ejecución de la nueva CPU, placa, dispositivos que falten y validación |

Compartir una CPU o un chip no demuestra compatibilidad completa ni transfiere la evidencia de GnG.

### Repositorios y propiedad del código

| Repositorio | Responsabilidad | Contenido propio |
| --- | --- | --- |
| `rom-migration-base` (nombre de trabajo, nuevo) | Desarrollar, probar y versionar la base agnóstica; generar proyectos | Compiladores, ejecución CPU, dispositivos reutilizables, contratos, herramientas, host, plantillas y tests sintéticos |
| `gng-ghidra` (este) | Mantener el producto GnG y validar que consume la base extraída sin regresiones | Placa GnG, revisión gngb, controles, observadores, recetas, validación y referencias privadas locales |
| Un repositorio por nueva migración | Integrar y validar su propio juego desde el binario original | Placa/adaptadores que necesite, receta del binario, assets generados privados, aplicación y pruebas propias |

La extracción se implementará en el repositorio nuevo; los cambios en este se limitarán a consumirla y conectar su integración. La base tendrá historial, versiones y documentación propios. Se incorporará únicamente el código seleccionado, conservando procedencia y avisos; no se clonará todo GnG para eliminar contenido después.

GnG será el consumidor de referencia externo. Sus adaptadores y escenarios de aceptación se ejecutarán desde este repositorio contra una revisión exacta de la base. Los tests de la base usarán programas sintéticos y contratos; no requerirán este checkout, ROM de GnG, carpetas `out/` ni acceso a capturas privadas. Hasta que GnG pueda consumirla, la versión original permanece como referencia ejecutable.

El repositorio es `krukmat/rom-migration-base`, privado (31/10/2026). `gng-ghidra` es público como muestra del proceso, por decisión del operador; eso deja visible la copia de la base fijada en `base/`.

## 2. Inventario de extracción

| Origen actual | Destino propuesto | Tratamiento |
| --- | --- | --- |
| [mc6809_aot_lib.mjs](../src/mc6809_aot_lib.mjs) | `base/cpu/mc6809/` | Extraer ALU y máscaras de valores conocidos; documentar el estado CPU que consumen |
| [mc6809_aot.mjs](../src/mc6809_aot.mjs) | `base/build/mc6809/` | Conservar semántica y tiempos; sustituir mapa y claves de GnG por resolución de código explícita |
| [gngb_block_key.mjs](../src/gngb_block_key.mjs) | Identidad de código en la base + resolución en placa | Quitar del núcleo los límites `0x4000/0x6000`; distinguir espacio, contexto de banco y versión de overlay |
| [gngb_runtime.mjs](../src/gngb_runtime.mjs) | Ejecución 6809 + `boards/gng/` | Separar CPU/reset/servicio de IRQ de mapa, línea de IRQ, DMA, paleta, scroll, latch y snapshots |
| [checkpoint_runtime.mjs](../src/checkpoint_runtime.mjs), [checkpoint_format.mjs](../src/checkpoint_format.mjs) | Estado nativo de placa/CPU en RP-2; formato y composición completa en RP-3 | Los commits `6f86ac5` y `1fc0557` añadieron guardado exacto. La ruta extraída ofrece `exportState`/`importState` sin parche textual; Z80, YM, PCM, web y Android siguen en RP-3 |
| [gngb_frame_renderer.mjs](../src/gngb_frame_renderer.mjs), [video_memory.mjs](../src/video_memory.mjs), [sprite_memory.mjs](../src/sprite_memory.mjs) | `boards/gng/video/` | Mantener la implementación específica; exponer imagen y geometría al host mediante contrato |
| [gngb_z80_static_codegen.mjs](../src/gngb_z80_static_codegen.mjs), [gngb_z80_irq_boundary.mjs](../src/gngb_z80_irq_boundary.mjs) | `base/build/z80/` y `base/cpu/z80/` | Extraer lo implementado; publicar límites de instrucciones, interrupciones y ejecución |
| [gngb_z80_scheduler_lab.mjs](../src/gngb_z80_scheduler_lab.mjs), [gngb_z80_sound_bus.mjs](../src/gngb_z80_sound_bus.mjs), [gngb_z80_live_session.mjs](../src/gngb_z80_live_session.mjs) | Ejecución Z80 + `boards/gng/audio/` + herramienta de resolución | Separar bus y temporización de placa; conservar y declarar la resolución dinámica actual |
| [ao_ym2203_wasm.cpp](../src/ao_ym2203_wasm.cpp), [ao_ym2203_wasm.mjs](../src/ao_ym2203_wasm.mjs) | `base/devices/ym2203/` + configuración de placa | Separar síntesis del número de chips, direcciones, frecuencias, mezcla y conversiones de tiempo |
| [gngb_audio_resampler.mjs](../src/gngb_audio_resampler.mjs), [gngb_audio_pcm_queue.mjs](../src/gngb_audio_pcm_queue.mjs) | `base/audio/` | Extraer transporte PCM y remuestreo con límites explícitos |
| [engine.worker.mjs](../android/web/engine.worker.mjs), [audio.worker.mjs](../android/web/audio.worker.mjs), [audio.worklet.mjs](../android/web/audio.worklet.mjs) | `base/host/web/` + adaptadores | Eliminar supuestos de GnG sobre frecuencia, puertos, geometría, ROM sonora y muestras por frame |
| `MainActivity.kt` y proyecto Gradle (ahora `base/templates/android/app/`) | `templates/android/` | Reutilizar shell, ciclo de vida y carga local; parametrizar identidad y assets del producto |
| [gngb_input_contract.mjs](../src/gngb_input_contract.mjs), [ao_touch_controls.mjs](../src/ao_touch_controls.mjs) | Entradas genéricas + placa/juego | Separar eventos de entrada de bits, DIP, 4-way y combinación específica para continuar |
| [ao_game_state.mjs](../src/ao_game_state.mjs), etiquetas del bot y tapes | `games/gngb/` y validación de GnG | Conservar direcciones, créditos, pantallas y objetivos en la integración del juego |
| [v2_b1_frozen.mjs](../src/v2_b1_frozen.mjs), [ao_web_assets.mjs](../src/ao_web_assets.mjs), [ao_build_assets.mjs](../scripts/ao_build_assets.mjs) | `base/build/` + receta de GnG | Extraer formato, hashes y empaquetado; retirar tamaños fijos, nombres de módulos y selección implícita de bundle |
| [v3_b3_ondemand.mjs](../src/v3_b3_ondemand.mjs), [v3_b3_static_closure.mjs](../src/v3_b3_static_closure.mjs), [v3_b3_jump_tables.mjs](../src/v3_b3_jump_tables.mjs) | Herramientas de descubrimiento + estrategias por CPU/placa/juego | Conservar descubrimiento y reconstrucción estática; declarar las heurísticas sin prometer cobertura total |
| [v3_b3_discover.mjs](../scripts/v3_b3_discover.mjs), capturadores y gates históricos | Flujo común + recetas y evidencia de GnG | Extraer pasos útiles; quitar como prerrequisito de un proyecto nuevo la genealogía B2-D/B3 |

No se copiarán en bloque `scripts/`, `tests/` ni `out/`: contienen historia, supuestos y artefactos específicos. Los tests acompañarán al componente dueño de la conducta que verifican. Ghidra y sus exportadores quedan como herramientas de análisis opcionales; el formato de ejecución no dependerá de un proyecto Ghidra existente.

## 3. Fronteras y contratos mínimos

El repositorio de la base contendrá las fuentes comunes y el generador:

```text
rom-migration-base/
  src/{build,cpu,devices,audio,host}/
  templates/               proyecto mínimo y shell Android
  tools/                   generador y comandos de migración
  tests/                   contratos y programas sintéticos
  docs/                    API, capacidades y guía de migración
```

Cada repositorio consumidor tendrá esta estructura. `base/` será una copia versionada de los componentes seleccionados de una revisión de `rom-migration-base`, con procedencia y hashes fijados; no será un enlace al directorio del desarrollador ni una segunda fuente de mantenimiento.

```text
proyecto nuevo
  base/                    versión fija, con componentes seleccionados
    build/                 verificación, compilación y empaquetado
    cpu/                   ejecución por arquitectura
    devices/               dispositivos concretos reutilizables
    audio/                 transporte PCM y remuestreo
    host/web/              presentación, entrada y ciclo de vida
  boards/<placa>/           bus, mapas, bancos, dispositivos y señales
  games/<juego>/            revisión ROM, receta, controles y observadores
  tools/                   comandos de migración y validación
  tests/                   pruebas propias y contratos de integración
  android/                 opcional, generado desde el shell
  roms/                    entrada privada, ignorada
  out/                     artefactos y evidencia privados, ignorados
  migration.json           selección y configuración del proyecto
  migration.lock.json      versión y hashes de componentes/herramientas
```

Los nombres son orientativos; la dirección de dependencia es obligatoria: la integración usa la base y la placa; la base no importa juegos ni placas concretas. Una placa puede usar dispositivos compartidos. La composición selecciona módulos explícitamente durante la construcción.

Las correcciones de componentes comunes se desarrollan en `rom-migration-base`; los consumidores adoptan una revisión mediante actualización explícita y sus propias regresiones. Una corrección descubierta en GnG se reduce primero a un caso sintético cuando sea posible. El lock registra la revisión íntegra, versiones de contratos y hashes; ninguna build sigue automáticamente `main` o «latest».

| Contrato | Requisito para la extracción |
| --- | --- |
| Binario → regiones | Identificar revisión, validar tamaños/hashes y aplicar una receta de disposición explícita. El binario plano necesita descripción de carga; el ZIP puede aportar varias regiones |
| Compilador → vista de código | Obtener bytes e identidad del código por contexto, sin conocer puertos ni fronteras bancarias de GnG. Invalidar/reseleccionar bloques cuando cambie un contexto relevante |
| CPU ↔ placa | Lecturas/escrituras con tiempo y máscaras conocidas donde existan; las líneas externas vienen de la placa y la CPU realiza su servicio según su arquitectura |
| Ejecución → host | Crear sesión, avanzar hasta un límite explícito y recibir estado de parada. Reset de CPU, reset de placa y nueva sesión se distinguen; ningún cambio de audio reinicia el juego |
| Placa → vídeo | Frame con geometría, secuencia y marca temporal. El host no consume direcciones de VRAM ni el layout privado `REC` |
| Placa → sonido | Eventos fechados y PCM con frecuencia, posición de muestra y sesión. La placa define conversiones de reloj y conexión de chips |
| Usuario → juego → placa | Acciones lógicas traducidas a entradas de hardware; secuencias especiales y DIP fuera del host común |
| Juego → UI | Observadores opcionales de crédito/estado. El núcleo no depende de su presencia ni interpreta RAM de gameplay |
| Artefactos → cargador | Esquema versionado, componentes y hashes; capacidades declaradas, incluida generación dinámica de código cuando corresponda |
| Oráculo → comparador | Evidencia identificada por binario, herramientas, escenario, cronología y ámbito. No transferir un PASS entre revisiones o componentes sin validación |

El tiempo de máquina se expresa con unidades explícitas y conversiones enteras/racionales. El reloj de presentación puede seguir al audio, pero no cambia la cronología de instrucciones, accesos e interrupciones. Se preservan los puntos de suspensión del 6809 y se documenta el exceso de límite permitido por el Z80 actual; no se introduce redondeo por frame ni se presume que todas las placas generan una IRQ por frame.

La interfaz de bus debe permitir una implementación directa o especializada durante la construcción. No se impondrá una cadena de callbacks por acceso sin medir su impacto.

## 4. Plan de ejecución

Cada tarea deja un cambio pequeño y revisable. No ejecutar la extracción completa por el solo hecho de aprobar este documento. Si una fase rompe equivalencia o supera el presupuesto medido, conservar la referencia y acotar el fallo antes de ampliar el alcance.

### RP-0 — Fijar la referencia

- [x] Crear el repositorio independiente de la base con estructura mínima, documentación de alcance e historial propio. Registrar ubicación, identidad y política de acceso al concretar su creación.
- [x] Registrar commit, herramientas, dependencias nativas/WASM y hashes de los bundles privados elegidos; no seleccionar automáticamente «el último» durante las pruebas.
- [x] Registrar en la base la procedencia de las fuentes extraídas: repositorio original, commit y rutas. Mantener GnG y sus adaptadores en este repositorio; no copiar su historial completo ni artefactos privados. Aún no hay fuentes de implementación extraídas.
- [x] Separar fuentes públicas de ROM, código generado, capturas, credenciales y claves de firma. Inventariar dependencias externas y conservar sus avisos/licencias al empaquetar componentes. El inventario inicial está en el checkpoint; la revisión de avisos se repetirá al incorporar cada dependencia.
- [x] Identificar escenarios existentes útiles: arranque, Coin/Start, movimiento/salto/ataque, Game Over/continuación, scroll/DMA y sonido ON/OFF, según la evidencia realmente disponible.
- [x] Guardar baseline semántico y de rendimiento del host elegido, con intervalos y condiciones de medida. Reusar capturas válidas antes de ejecutar MAME.

**Salida:** repositorio de base inicializado, manifiesto privado de referencia en el consumidor y matriz de evidencia con campos «demostrado / pendiente». **GO:** repositorios separados, reproducción de un escenario corto y trazabilidad de sus artefactos. No se bloquea toda la extracción por contenido de GnG aún no certificado; ese límite queda explícito.

### RP-1 — Definir las fronteras

**Depende de RP-0.**

- [x] Convertir los contratos de la sección 3 en interfaces pequeñas y documentadas, con unidades temporales y condiciones de error. La implementación de CPU/host sigue en RP-2/RP-3.
- [x] Definir una receta de proyecto que seleccione CPU, placa, dispositivos, revisión de binario, plataforma y escenarios. Los comportamientos ejecutables van en módulos; el manifiesto contiene datos y referencias. La receta privada GnG es un borrador sin módulos ejecutables aún.
- [x] Definir versiones de contrato y capacidades: instrucciones/IRQ soportadas, overlays admitidos y política de código estático/dinámico por CPU. Ninguna CPU se anuncia como disponible antes de extraerla y declarar su cobertura real en RP-2/RP-3.
- [x] Definir el punto de composición de GnG para que el host reciba una sesión integrada sin imports específicos del juego. Su implementación sigue pendiente.
- [x] Definir el consumo entre repositorios y la verificación de compatibilidad: revisión fija, contratos, capacidades y actualización reproducible de la copia seleccionada. La instalación/actualización automatizada sigue pendiente de RP-5.

**Salida:** contratos y receta GnG inicial. **GO:** cada constante específica inventariada tiene dueño; ninguna exige colocar el juego dentro de la base.

### RP-2 — Separar compilación, CPU y placa

**Depende de RP-1.**

- [x] Extraer ALU/estado/ejecución 6809 y pasar la vista de código al compilador. Mover resolución de bancos, bus, señales y snapshots a la placa GnG.
- [x] Preservar máscaras conocidas, control de overlays y rechazo de instrucciones o código no soportados.
- [x] Hacer nativa la API reanudable; retirar de la ruta nueva el parche textual de [ao_resumable_runtime.mjs](../src/ao_resumable_runtime.mjs). Mantener los bundles originales intactos.
- [x] Probar el compilador con vistas sintéticas pequeñas de distinta disposición de ROM y bancos. Estos casos prueban el contrato, no representan un segundo juego certificado.
- [x] Comparar ejecución segmentada y continua con la referencia: estado CPU, accesos/eventos relevantes y snapshots, conservando ciclos y cortes de frame. La cinta privada fijada cambia el recorrido y se comparó durante 900 frames; el checkpoint CPU se restauró en el frame 450.

**Salida RP-2:** compilador sin dependencia de `gngb_block_key`, ejecución 6809 y placa GnG separadas. **GO alcanzado en el alcance 6809:** mismos resultados semánticos en arranque de 120 frames y cinta privada de 900 frames; no se exige que el texto JS generado conserve su hash tras reorganizar código. El lock privado fija seis componentes de la base. La receta completa aún falla cerrada por falta de Z80; [evidencia y pendientes](rp0-rp1-checkpoint-2026-10-28.md#rp-2--extraccion-6809-29102026).

### RP-3 — Separar host, audio e interfaz

**Depende de RP-2.**

- [x] Sustituir constantes de puertos, geometría y tiempo del worker por contratos de la sesión integrada. El host de la base recibe reloj, geometría, número de puertos y límites de `boards/gng/web-host-config.mjs`; las direcciones `0x3000–0x3004` quedan en la composición GnG.
- [x] Mover interpretación de RAM, etiquetas, política 4-way y combinación de continuación a placa/juego según corresponda. RAM y etiquetas en `games/gngb/state.mjs`; puertos, bits y registro por frame en `boards/gng/`; DIP, 4-way y Continuar en `games/gngb/inputs.mjs`. Comparación RP-3 idéntica y AO4 PASS en Chromium.
- [x] Extraer transporte PCM y síntesis YM2203; mantener en GnG la conexión de chips, frecuencias, mezcla, reset y relación de relojes. Banco `src/devices/ym2203/` en la base; dos chips, 12/1,5 MHz, mezcla y `0xe000–0xe003` en `boards/gng/audio/ym2203.mjs`. PCM y `GYM1` idénticos a la referencia.
- [x] Integrar `gng.checkpoint.v1` con la sesión compuesta: restaurar Z80, YM, lotes PCM y workers web/Android sin perder el estado exacto ya demostrado por los commits `6f86ac5` y `1fc0557`. Conservar en GnG la política de un slot y almacenamiento de producto. Checkpoint GO en Chromium y en emulador Android; el formato y el slot siguen en GnG.
- [x] Separar ejecución Z80, bus sonoro y resolución de bloques. La ruta actual de [gngb_z80_live_session.mjs](../src/gngb_z80_live_session.mjs) compila al iniciar y resuelve destinos durante la ejecución: declararlo y conservarlo al extraer. Congelar también el Z80 sería un trabajo posterior con gate propio.
- [x] Parametrizar shell Android, identidad de producto y empaquetado; conservar controles, ciclo de vida, funcionamiento offline y sincronización audio/vídeo. Identidad y assets parametrizados; en emulador, `org.example.rp3` funciona offline con audio sincronizado y checkpoint GO. La plantilla del shell está en la base (`templates/android/app`, base `da867a7`) y GnG la compila desde la copia fijada. La prueba en un dispositivo físico (controles y ciclo de vida) pasa a la verificación final del proyecto, por decisión del operador del 31/10/2026.

**Salida:** host común y GnG compuesto mediante adaptadores. **GO:** píxeles y secuencia PCM idénticos para los mismos escenarios deterministas; entradas, pausa/reanudación, audio ON/OFF y rendimiento sin regresiones fuera de la tolerancia fijada en RP-0. No se extiende una prueba de PCM a una afirmación nueva de paridad Z80 nativa.

**Avance parcial:** extraídos el transporte PCM, el protocolo AudioWorklet, el reloj de frames, el banco YM2203 y los hosts de engine/audio; shell Android parametrizable. La comparación privada de 120 y 900 frames da PCM idéntico y restauración CPU/Z80/`GYM1`, con los locks v4, v5 y v6. Los workers Android/web son composiciones sobre los hosts comunes: 290/290 frames dibujables iguales, audio GO en Chromium, y `PASS_EMULATOR` más checkpoint GO en Android. El escritorio usa la app común con teclado y exporta cintas que `rp3_compare` reproduce; el servidor anterior queda solo como laboratorio del bot. El build web/Android aplica las comprobaciones de entrada de la receta. La receta RP-1 original falla cerrada por NMI no implementada; la derivada RP-3 exige solo IRQ y pasa el contrato. [Evidencia, límites y siguientes pasos](rp0-rp1-checkpoint-2026-10-28.md#rp-3--z80-audio-y-worker-29102026).

### RP-4 — Construir desde el binario original

**Depende de RP-2 y RP-3.**

Lo que esta fase mueve a la base entra sin GnG: los nombres, las constantes, las rutas y los tamaños de GnG se quedan en `gng-ghidra` (`boards/gng`, `games/gngb`, receta).

- [x] Separar verificador de binarios de la receta de archivos, hashes y regiones de GnG. `base/src/build/input.mjs` lee ZIP o plano y verifica las regiones declaradas; GnG conserva los roles y la disposición.
- [x] Extraer descubrimiento, compilación, congelado y empaquetado para que acepten entradas explícitas. Admitir comenzar con un proyecto vacío de artefactos, sin B2-D/B3 ni rutas de `out/` de este repositorio. La construcción de GnG parte de `roms/gng.zip` solo.
- [x] Mantener saltos indirectos y análisis estático como estrategias declaradas por arquitectura/placa/juego; registrar destinos faltantes y límites de cobertura. El reporte registra salidas indirectas y semillas halladas en ejecución.
- [x] Crear el formato nuevo de bundle con módulos y regiones declarados (`rom-migration.bundle.v1`). Preservar hashes, rechazo de corrupción y trazabilidad del origen; no heredar tamaños `0x1a000/0xa000`, lista fija de módulos ni límite de 20.000 frames como contrato universal.
- [x] Definir comandos estables para verificar entorno/entrada, construir, validar y empaquetar; implementación inicial en CLI con entradas no interactivas y errores claros (`base/tools/migrate.mjs`).

**Salida:** receta GnG ejecutable desde sus entradas originales y herramientas bloqueadas por versión. **GO (decisión del operador, 31/10/2026):**
- Una corrida de la cadena movida a la base con la ROM de GnG produce un bundle idéntico al vigente, sin copiar bundles anteriores ni acceder a ellos implícitamente. El oráculo no es dependencia de ejecución del producto.
- Con ese bundle se repiten las pruebas de jugabilidad, que son obligatorias:
  - web en Chromium: controles, teclado, audio y checkpoint;
  - emulador Android: `ao_android_check --audio`, `ao_checkpoint_check --android` y `ao_stick_android_check`.
- No se reconstruye desde un checkout limpio.

**Resultado (31/10/2026, aceptado por el operador):** GO completo con el bundle construido por la base; igualdad funcional con g6 por decisión del operador. [Evidencia](rp0-rp1-checkpoint-2026-10-28.md#rp-4--construcción-desde-el-binario-original-31102026).

**Objetivo final del proyecto:** que `gng-ghidra` funcione como corresponde sobre la base al terminar RP-4. Después viene la verificación final, que incluye la prueba en un teléfono físico.

### RP-5 — Generar un proyecto independiente

**Hecha (31/10/2026; el operador la adelantó).** Base `v0.1.0` = `bec61dd` en `krukmat/rom-migration-base` (privado). Suite de la base: 29 pruebas pasan, 3 omitidas.

**Depende de RP-4.**

- [x] La base contiene solo lo agnóstico. La tabla de asignación de GnG y la procedencia archivo por archivo pasaron a [base-asignacion-y-procedencia.md](base-asignacion-y-procedencia.md). `tests/no-game-identity.test.mjs` falla si un archivo de la base nombra un juego.
- [x] `tools/project.mjs init` genera la estructura de la sección 3 con identidad de proyecto y grupos de componentes explícitos (`core` más `mc6809`, `z80`, `ym2203`, `web`, `android`). Un módulo seleccionado no puede importar archivos fuera de la selección.
- [x] `migration.lock.json` fija repositorio, revisión íntegra, grupos y hashes. `update --to` reemplaza la copia desde otra revisión y rechaza una copia editada a mano.
- [x] El ejemplo sintético es un programa 6809 de 32 KiB con una placa de una CPU. `tools/example.mjs` lo verifica, construye y valida con la cadena fijada y corre 3 frames. No incluye ROM, assets, bundles ni evidencia de GnG.
- [x] GnG ya construye su receta desde `roms/gng.zip` con `base/tools/migrate.mjs` (RP-4). Sigue fijado en `090c44d`; no se repitieron los gates de RP-4 porque sus componentes no cambiaron.
- [x] `tests/project.test.mjs` genera el proyecto desde un clon temporal, comprueba que no haya rutas absolutas, borra el clon y corre las pruebas del proyecto (4/4). También comprueba que entradas incompletas o incompatibles se rechacen con un código concreto.

**Salida:** generador y plantilla utilizables. **GO:** el proyecto es independiente y no contiene rutas absolutas ni conocimiento implícito de GnG. Esto demuestra separación y generación, no compatibilidad con un segundo juego.

### RP-6 — Certificar y versionar la base

**Diferida (decisión del operador, 31/10/2026):** hasta clonar otro juego. No habrá reconstrucción de GnG desde un checkout limpio; la validación con GnG es la de RP-4.

**Depende de RP-5.**

- [ ] Ejecutar las pruebas de componentes movidos y contratos, con casos de ROM/bancos alternativos, artefacto corrupto y componente incompatible.
- [ ] Reconstruir GnG desde su repositorio consumidor y sus binarios, usando la revisión fija de la base; verificar los escenarios de RP-0, imagen, sonido, controles y rendimiento. Repetir la construcción en un checkout limpio del consumidor sin acceso implícito al checkout de desarrollo de la base.
- [ ] Revisar dependencias: la base no importa `boards/gng`, `games/gngb`, observadores de gameplay ni scripts históricos. Auditar dependencias ejecutables y supuestos, además de nombres de archivo.
- [ ] Documentar cómo iniciar una migración, qué componentes están disponibles y qué sigue sin soporte/evidencia. Registrar procedencia y cambios de la primera versión reutilizable.

**Salida:** versión candidata de la base, plantilla y reporte de alcance. **GO:** GnG funciona con la base extraída dentro del alcance demostrado y el proyecto nuevo funciona sin este checkout. Publicar o distribuir la versión es una acción posterior; no está incluida en esta planificación.

## 5. Presupuesto y orden

Estimación orientativa de consumo de plan, no tiempo de calendario; se recalibra con RP-0. Los porcentajes de esta tabla son **puntos de allowance consumidos** en cada ventana. La disponibilidad inicial comunicada fue 28% en 5 h y 73% semanal, antes del análisis y de redactar este plan; no representa el saldo actual.

| Paso | Ventana de 5 h | Semanal |
| --- | --- | --- |
| RP-0 | 2–3 puntos | 0,3–0,6 puntos |
| RP-1 | 2–4 puntos | 0,4–0,8 puntos |
| RP-2 | 5–8 puntos | 1–1,6 puntos |
| RP-3 | 5–8 puntos | 1–1,6 puntos |
| RP-4 | 4–7 puntos | 0,8–1,4 puntos |
| RP-5 | diferida | — |
| RP-6 | diferida | — |
| **Total provisional** | **24–40 puntos** | **4,7–8 puntos** |

La extracción completa puede superar la ventana disponible. El primer bloque de implementación debe limitarse a RP-0 + RP-1 (4–7 puntos / 0,7–1,4 semanal), entregar referencia y contratos y recalibrar antes de RP-2. No iniciar suites costosas sin comprobar versiones de runtime, herramientas nativas y dependencias de staging/Docker requeridas por el gate elegido; sin coverage salvo exigencia del gate.

## 6. Qué se repite en cada migración

1. Elegir versión de la base y verificar que sus capacidades cubren la CPU/placa o identificar la extensión necesaria.
2. Incorporar y verificar los binarios originales de esa revisión; describir carga, mapa y dispositivos.
3. Generar código, resolver rutas indirectas/overlays y registrar bloqueos con datos del proyecto nuevo.
4. Extraer assets y conectar entradas/observadores propios sin mover reglas de gameplay al núcleo.
5. Validar contra la referencia original con escenarios y evidencia propios; ampliar cobertura cuando aparezcan rutas nuevas.
6. Congelar y empaquetar el juego integrado, fijando herramientas, capacidades y hashes del producto.

**Criterio final:** reutilizar compiladores, dispositivos, host y método sin repetir su implementación; repetir para cada binario la generación, la integración de hardware y la demostración de equivalencia que correspondan. La primera versión no se llamará «motor universal»: será una base extraída y verificada con GnG, preparada para extenderse mediante proyectos de migración independientes.
