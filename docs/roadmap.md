## Reorientación R0 — V1.2 rechazado visualmente (16/10/2026)

El operador mostró una captura de V1.2 donde el collage
determinista produce tiles repetidos sin sentido. **Ese
resultado NO está aceptado** y no se arreglará pintando una
escena más bonita ni eligiendo tiles distintos.

**R0 es el próximo gate, NO V1.3.** Capturamos un frame
real de MAME como referencia de laboratorio (PNG,
FG/BG VRAM, paleta RGB real, scroll y sprites bufferizados
con DMA), y producimos **ese mismo estado** con nuestro
renderer JavaScript. El MAME externo no forma parte
del producto, solo de los tests.

Comandos locales (MAME instalado, ROM privada):

```bash
git pull --ff-only
python3 scripts/capture_real_frame.py --system gngb --rompath roms --frame 600
python3 src/reference_frame_view.py --rom roms/gng.zip
open out/visual/frame-compare.html
```

Para un único set `roms/gng.zip`, usar
`--system gng` en el comando de MAME; gngb y gng
son revisiones de programa diferentes y se documentará
la seleccionada. Si falta MAME, indicarlo como bloqueo,
no volver a un fixture inventado.

[Diseño, evidencias y límites de R0](frame-oracle.md).
**No hay equivalencia visual comprobada hasta ejecutar
este flujo en el Mac**. La referencia real sirve para
detectar errores y hacer un avance reconocible; no
implica un motor de juego funcional.

---

# Roadmap orientado a resultados visibles — Ghosts 'n Goblins (gngb)

Actualizado: 15 de octubre de 2026. Fuente de verdad para la siguiente
entrega. **No es un roadmap de «más rutinas verificadas».** Su métrica es
qué puede abrir y comprobar el operador en su Mac.

## Objetivo final

Traducir la lógica *original* MC6809 de la ROM gngb mediante
**Ghidra P-code → IR → JavaScript/TypeScript**, junto con una capa
explícita para los dispositivos de la placa. El resultado debe
ejecutarse en un navegador/runtime moderno **sin emulador 6809 como
motor del producto**. El MC6809 externo solo es un oráculo de pruebas.
ROM y gráficos originales permanecen exclusivamente en la máquina
del operador.

## Realidad actual (sin maquillar)

- El prefijo de arranque original que inicializa 384 bytes de sprite
  RAM se genera y ejecuta en Node, detenido antes de la instrucción
  `SYNC` en 0x6016. El juego no ejecuta todavía un frame completo.
- 0x622c y 0x6755 tienen **60/60** comparaciones por rutina contra
  un núcleo MC6809 independiente usando la ROM real y estados
  sintéticos (120/120 en total). No son estados observados durante
  una partida.
- 0x6239 se ha trabajado como candidato condicionado por punteros
  índice, pero no es un entregable visible ni está validado en la
  ROM real contra el MC6809.
- No existen todavía renderer conectado a memoria de vídeo,
  ciclo de interrupciones/bancos, inputs jugables, sonido, título o
  juego ejecutándose. No es un port jugable.

## Entregas y criterios de aceptación

| Entrega | Lo que puede VER el usuario | Evidencia técnica para aceptarla | Estado |
| --- | --- | --- | --- |
| **V0. Explorador ROM** | Abre `out/graphics-preview.html` en Safari/Chrome y visualiza las hojas de caracteres, escenario y sprites originales | Validación local de 13 chips gfx mediante tamaño/CRC32; hoja renderizada en navegador; ningún recurso ROM en GitHub | Código implementado; **pendiente de ejecución privada del operador** |
| **V1. Renderer de memoria** | Ve una escena de diagnóstico 256 px de ancho creada por memoria de vídeo y sprites; puede modificar los bytes y observar cambios visibles | Canvas renderiza FG/BG/sprites y atributos de la placa a partir de VRAM/control registers; golden frame de *fixture* explícitamente etiquetado, sin fingir juego | No iniciado |
| **V2. Frame original del programa** | Una escena que cambie por ejecución de **código generado de la ROM**, no por composición manual | Integrar arranque, barrera `SYNC`, IRQ y banking con orquestación de eventos y código traducido, sin interpretar opcodes en runtime; comparar estado y efectos con MC6809 independiente | Bloqueado por interrupciones/bancos y alcance de CFG |
| **V3. Primer control jugable** | Usa teclado/gamepad; Arthur y el escenario responden conforme a la lógica original | Loop determinista, inputs, avance de frames, colisiones y registros visibles derivados del código traducido; regresiones diferenciales | No iniciado |
| **V4. Port jugable** | Una partida completa, después audio y refinamientos | Gameplay, Z80/audio, prioridades de sprite/tile, niveles, estados y coherencia con la ROM; sin redistribuir ROM | No iniciado |

## Reglas de ejecución

1. **No se inicia otro bloque de tres rutinas por el mero número de
   PASS**. Las traducciones de funciones pasan a ser tareas
   subordinadas a V2/V3, para desbloquear un comportamiento que el
   operador pueda observar.
2. **El siguiente bloque principal es V1**, pero primero debemos
   conseguir una captura/comprobación de V0 en la ROM local.
3. Diferenciar siempre `ROM GRAPHICS` (V0), `VRAM FIXTURE` (V1)
   y `REAL TRANSLATED GAME FRAME` (V2). Nunca presentar un visor
   de assets o una escena ensamblada como «juego funcionando».
4. Cada avance de V0–V3 debe traer un comando local reproducible,
   una evidencia observable y una limitación explícita.
5. Mantener la distinción entre los 120 vectores *de laboratorio*
   ya comparados y los estados reales de ejecución de partida.

## V0: comando actual para obtener la primera salida visible

Desde la raíz del repositorio:

```bash
git pull --ff-only
python3 src/graphics_preview.py --rom roms/gng.zip
open out/graphics-preview.html
```

Si `gng.zip` es un ROM set separado sin todos los chips gráficos,
pasar el archivo ZIP padre como `--shared /ruta/local/parent.zip`.
El CLI informa el primer chip ausente. El HTML generado **embebe
píxeles procedentes de la ROM**, se guarda en `out/` (ignorado por
Git) y no debe publicarse.

V0 emplea **paletas de inspección**, no los RGB originales que el
programa genera dinámicamente en la RAM de la placa. Es un visor
auténtico de bitplanes ROM, **no** un frame ejecutado ni una escena
reconstruida del juego.

Referencia de hardware visual: [MAME gng.cpp](https://github.com/mamedev/mame/blob/master/src/mame/capcom/gng.cpp)
(`charlayout`, `tilelayout`, `spritelayout`, `gfx_gng`).


## Seguimiento visual entre bloques — obligatorio a partir de V0

Hay **seis checkpoints discretos** en
[`docs/visual-milestones.json`](visual-milestones.json):
V0, V1.1, V1.2, V1.3, V2 y V3. Cada uno define:
salida local visible, dependencia, aceptación independiente de CI y
fase real (`ROM GRAPHICS`, `VRAM FIXTURE`, `TRANSLATED ROM CODE`
o `GAMEPLAY`). Los checkpoints no se cierran por cantidad de pruebas.

El [dashboard local](../scripts/visual-progress.py) compara capturas
privadas y muestra estados **separados del éxito de CI**:

```bash
python3 scripts/visual-progress.py
open out/visual-progress.html
```

Puedes adjuntar imágenes **solo en tu equipo**:

```text
out/visual-evidence/v0/after.png
out/visual-evidence/v1.1/before.png
out/visual-evidence/v1.1/after.png
out/visual-evidence/v1.2/before.png
out/visual-evidence/v1.2/after.png
out/visual-evidence/v1.3/before.png
out/visual-evidence/v1.3/after.png
```

No es necesario adjuntar nada para generar el dashboard: aparecerán
placeholders *Sin captura local*. Al añadir capturas, el HTML las
incluye y permite una comparación visual. **La existencia de capturas
no cambia el estado a ACCEPTED**; eso exige revisión explícita del
usuario, criterios cumplidos y actualización del manifiesto versionado.

### Contrato de cada bloque ejecutado

1. **Tarea + subtareas de máximo 2 niveles** y dependencia con el
   checkpoint anterior. Nada de investigación paralela sin salida visual.
2. **Una salida ejecutable local**: HTML o visor, más comando reproducible.
3. **Una diferencia observable**: captura antes/después (en V0 solo
   captura inicial), con fuente de datos identificada.
4. **Pruebas pertinentes y CI**: no sustituyen la evidencia visual.
5. **STOP/GO**: si no hay cambio observable, no se declara entrega;
   se corrige ese bloque antes de ampliar alcance.

### Primeros dos bloques concretos

**V0 — Visor de ROM** (implementado, pendiente comprobación en Mac).
Se acepta al comprobar localmente la carga de sprites, tiles y
caracteres y capturar `out/visual-evidence/v0/after.png`.
Si el ZIP no contiene gráficos, documentar el chip faltante y usar
`--shared` con ROM propia; no generar gráficos ficticios para dar PASS.

**V1.1 — Primer render en memoria** (siguiente bloque de desarrollo).
Subtareas: **A)** convertir una representación explícita de sprite
RAM en instancias gráficas usando los bitplanes que ya carga V0;
**B)** usar el mismo renderer para dos estados de memoria y guardar
capturas antes/después. Entregar un HTML con control verificable de
posición/índice de sprite. Sin código Motorola 6809 ejecutándose
todavía: etiqueta visible `VRAM FIXTURE`.

**V1.2 — FG/BG y scroll**: depende de V1.1. Subtareas:
**A)** mapear atributos/flip/posición y memoria de tiles sobre
Canvas; **B)** producir dos estados visuales deterministas y
compararlos. No permitir estética aproximada como sustituto de
mapear bytes reales de las ROM.

**V1.3 — Primer efecto visual del programa traducido**:
depende de V1.2. Subtareas: **A)** ejecutar el prefijo ROM ya
traducido hasta `0x6016`; **B)** alimentar el renderer con la
RAM resultante y comparar el estado previo/posterior. Si la
inicialización es visualmente indistinguible, se debe mostrar un
overlay explícito de los bytes modificados, sin inventar gameplay.

Solo después V2 aborda SYNC, IRQ, bank switching y control-flow para
un primer frame auténtico. Las rutinas adicionales deben justificar
cómo habilitan ese frame.


## V1.1 implementado — escena controlada con RAM real de sprites

**Estado: código preparado, pendiente de validación con ROM privada.**
A diferencia de V0, hay dos lienzos lado a lado y un estado
diferente **por bytes de sprite RAM**. No inventamos la escena del juego:
los bitplanes son los de la ROM original y la memoria inicial es
explícitamente un fixture de pruebas.

```bash
git pull --ff-only
python3 src/sprite_scene.py --rom roms/gng.zip
open out/visual/vram-sprites.html
```

Si el ZIP es un *split set*, agregar
`--shared /ruta/local/parent.zip` a la generación. Ambos ZIPs
son privados; el HTML resultante también incluye bytes ROM.

El navegador debe mostrar **ANTES** y **DESPUÉS** simultáneamente.
El panel permite cambiar X, Y, gráfico (0–1023), paleta de
inspección y flips. La edición solo aparece al pulsar
**Aplicar cambios · copiar RAM → buffer**, porque el hardware
usa una transferencia explícita de sprite RAM; en esta prueba
se reproduce solo el contrato de snapshot, no los temporizadores
de placa. La tabla informa qué bytes han cambiado, con direcciones
originales `0x1e00..0x1fff`.

Haz clic en **Guardar ANTES PNG** y **Guardar DESPUÉS PNG**,
y mueve los archivos descargados a:

```text
out/visual-evidence/v1.1/before.png
out/visual-evidence/v1.1/after.png
```

Después `python3 scripts/visual-progress.py` y
`open out/visual-progress.html` mostrarán ambas capturas en
el tablero. **No marcar el hito ACCEPTED sin inspección
visual real con la ROM del operador**, aunque CI pase.

- Fuente: `src/graphics_preview.py` verifica tamaño y CRC32 de
  los 13 chips gfx gngb; `src/sprite_memory.mjs` aplica
  el spritelayout (planos, transparencia 15) y el registro
  hardware de 4 bytes (código/atributos/Y/X).
- Mapa CPU: `0x1e00–0x1fff` (128 sprites), dirección
  `0x3c00` como evento DMA conceptual, sin simular IRQ.
  Se respeta el orden inverso de dibujo y la semántica de
  paleta/flip; los RGB son **paleta de inspección**.
- Aún falta: capas FG/BG, paleta real y ejecución de código
  traducido. Eso corresponde a V1.2 y V1.3.


## V1.1 — Primera captura privada recibida, sin cerrar la estética

La captura aportada por el operador muestra la misma página con
tres fragmentos gráficos visibles: al cambiar el registro, una
pieza cambia de posición/índice entre ANTES y DESPUÉS.
**Esto confirma la reacción visual**, pero no prueba la
correcta interpretación de un escenario ni presenta todavía
una pantalla útil del juego. No se sube la captura ni material
ROM a GitHub. El hito queda pendiente de aceptación formal.

## V1.2 — BG/FG/sprites con scroll, ahora implementado para revisión

El siguiente artefacto disponible reúne las capas de vídeo en la
**misma vista comparativa**, y enlaza los píxeles de ROM auténtica
con registros de memoria del arcade. No tiene lógica de partida.

```bash
git pull --ff-only
python3 src/vram_scene.py --rom roms/gng.zip
open out/visual/vram-scene.html
```

Para set *split*, añadir
`--shared /ruta/al/zip-padre.zip` al segundo comando.
El generador verifica tamaño y CRC32 de los 13 componentes gráficos.

- **FG** (`0x2000–0x27ff`): 32×32 de 8×8, recorrido por filas,
  2bpp, bits altos de código, flips y transparencia `pen=3`.
  La visibilidad de FG es un conmutador **diagnóstico**;
  no equivale a activar/desactivar FG en una partida.
- **BG** (`0x2800–0x2fff`): 32×32 de 16×16,
  recorrido por columnas, 3bpp, paleta 0–7, bit de split
  priority y dos mitades de color/transparencia:
  BG detrás → sprites → BG delante.
- **Scroll BG**: `0x3b08/09` y `0x3b0a/0b` como
  pares de bytes low/high, con wrap 512×512.
- **Sprites**: `0x1e00–0x1fff` de CPU RAM más copia
  explícita al buffer, misma decodificación y transparencia
  de V1.1.
- **Visual**: dos frames Canvas 256×240, uno inmutable
  y otro alterado mediante sliders; tabla de cambios
  en direcciones de RAM/MMIO. Los gráficos provienen
  de la ROM, pero la **disposición de los tiles es un
  collage determinista de laboratorio** y el color
  es una paleta de inspección. No se recrea ni
  se afirma recrear un nivel real del juego.

Pulsa los botones **Guardar PNG** de los dos paneles y
deposita las capturas bajo
`out/visual-evidence/v1.2/before.png` y
`out/visual-evidence/v1.2/after.png`.
El tablero `out/visual-progress.html` las mostrará
al regenerarlo con `python3 scripts/visual-progress.py`.

**Puerta para V1.3:** la revisión local de V1.2 debe
mostrar desplazamiento visual cuando cambian scroll,
código y atributos del tile y posición del sprite.
Solo entonces se conecta el arranque traducido
al renderer. No desplazar el objetivo hacia otra rutina
aislada.
