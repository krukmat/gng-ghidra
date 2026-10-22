# Ruta crítica del port recompilado — R3.5 → R4 (22/10/2026)

## Estado y condiciones de verdad

Objetivo: ejecutar Ghosts 'n Goblins con **código MC6809 recompilado a JS**,
sin usar MAME ni intérprete MC6809 como runtime. La ROM original sigue privada.

| Hito | Estado y evidencia |
| --- | --- |
| R0 (replay nativo) | PASS: Blackbox MAME reproducible |
| R1 (renderer JS) | PASS: frames 1660 y 1700, 0/57.344 píxeles distintos cada uno |
| R2 (oráculo CPU integral) | PARTIAL: preestados y taps; no postestado/bus global |
| R3.2 (bloque inicial) | PASS acotado: 1.192/1.192 checkpoints admitidos, 389 pasos consecutivos de registros |
| R3.3 (RAM de sprites) | PASS acotado: 768/768 bytes nativos comparados en dos arranques |
| R3.4 (frontera) | PASS: primer PC sin compilar 0x6016 |
| R3.5.A (SYNC estático) | Código y ROM contrastados: entrada SYNC_WAIT; causa del wake NO verificada |
| R3.5.B1 | Código + CI PASS; análisis real del reset/causalidad aún pendiente en Mac |
| R3.5.B2 (IRQ/SYNCACK nativo) | Instrumentación de fuente y parser PREPARADOS; sin binario compilado/captura real |
| R3.6.A (después de 0x6017) | Explorador offline PREPARADO; resultado real pendiente |
| R3.6.B (continuación JS) | PENDIENTE: requiere opcode y efecto observado |
| R4 (primer frame calculado por JS) | PENDIENTE: memoria/MMIO y CPU entre VBLANK |

La primera época de SYNC acaba observando PC=0x6000 bajo el soft reset
controlado. La segunda observa PC=0x6017, con I/F enmascaradas. El segundo
resultado **no** demuestra por sí solo una señal de IRQ.

## Bloque crítico A — avanzar en el ROM con la evidencia actual

**A1. Reset vs SYNC (B1)**

- A1.1 Revalidar las dos épocas ROM + CPU + escrituras de RAM.
- A1.2 Exigir SOFT_RESET_REQUESTED → RESET_NOTIFICATION, y no atribuir el
  primer salto a IRQ.

**A2. Encuesta post-SYNC (R3.6.A; depende de A1 y R3.3)**

- A2.1 Identificar el opcode soportado o la primera instrucción ausente
  a partir del PC nativo real 0x6017; no usar bytes ni registros inventados.
- A2.2 Generar un resumen seguro de PC/familia; no afirmar que JS haya
  superado SYNC ni que exista aceptación IRQ.

**Ejecución inmediata en Mac, sin nuevo MAME:**

~~~bash
git pull --ff-only
node scripts/r3_sync_reset_causality.mjs
node scripts/r3_post_sync_frontier.mjs
~~~

Compartir SOLO los dos JSON resumidos. No subir ROM, los archivos en
out/r2/mame-probe, los módulos generados ni eventos de bus.

**Gate para R3.6.B:** conocer el primer opcode real posterior a 0x6017;
implementarlo con semántica MC6809 y comprobar registros, RAM y MMIO según
corresponda antes de conectar el siguiente bloque continuo.

## Bloque crítico B — evidencia de IRQ/SYNCACK nativa

**B1. Fuente MAME instrumentada (implementada como generador, no compilada)**

- B1.1 En un árbol fuente MAME local **separado**, ejecutar:

~~~bash
python3 scripts/r3_prepare_native_mame_hook.py \
  --mame-source /ruta/a/mame-src
~~~

El script exige los anchors actuales del núcleo y escribe **copias** de
m6809.cpp y base6x09.lst bajo out/r3/native-mame-overlay/src/... .
No modifica la instalación Homebrew, el repo original ni el binario. Si
la revisión MAME no coincide, bloquea el proceso.

- B1.2 Aplicar las copias a un *worktree experimental* de MAME, compilar
  y conservar el hash del binario. No automatizamos una compilación pesada
  en este proyecto sin fuente/build disponibles. El núcleo instrumentado
  registra CPU_RESET, LINE_DELIVERED, SYNC_ENTER, SYNC_EXIT, IRQ_ENTRY y
  VECTOR_FETCH con contador de ciclos. Las llamadas del núcleo registran
  señales **reales** en vez de reconstruirlas desde el PC. Los callbacks
  estándar de MAME y el juego no se sustituyen.

**B2. Oráculo y comparación (preparado, validación real pendiente)**

- B2.1 Con el binario compilado realmente desde el código parcheado,
  ejecutar en el Mac:

~~~bash
GNG_R3_MAME_BIN=/ruta/al/mame-instrumentado \
  bash scripts/r3-native-irq-verify.sh
~~~

Se rechazan binarios no indicados explícitamente o sin el marcador
instrumentado. El wrapper respalda out/r2/mame-probe antes de ejecutar,
usa -oslog dentro de la captura privada y vuelve a analizar preestados
y escrituras de sprites. **La presencia del marcador en el ejecutable
no autentica la compilación**.

- B2.2 El analizador r3_native_irq_report.mjs exige una afirmación de
  línea IRQ/FIRQ/NMI observada entre SYNC_ENTER y SYNC_EXIT, junto con
  el nivel real de las líneas en la salida. Sin ese evento, no confirma
  la causalidad. Distingue señal enmascarada de IRQ_ENTRY/VECTOR_FETCH;
  no declara equivalencia de pila/vector ni de JS. Todos los datos crudos
  se mantienen en out/ privado.

**Gate B2:** muestra directamente la entrega de IRQ, la salida de SYNC,
y cuando haya entrada a handler, la aceptación y vector. Hasta observarlo,
R3.5.B2 = PENDING aunque todos los tests sintéticos sean PASS.

## Bloque crítico C — primer frame autónomo (R3.6.B → R4)

- C1. Extender recompilación estática para el siguiente bloque real,
  trabajando por CFG/PC y contratos de memoria (no opcodes arbitrarios).
- C2. Modelo de bus mínimo del juego: RAM, MMIO de scroll/paleta,
  bank select, DMA de sprites y reloj de VBLANK; comparar efectos nativos.
- C3. Conectar con renderer R1, **sin cargar un frame MAME como entrada**.
- C4. Comparar hash de frame y estado con el oráculo y rechazar la
  primera divergencia. Aceptar R4 solo con al menos un frame producido
  por runtime JS original en forma autónoma.

### Reglas operativas

1. No confundir CI ROM-free con PASS de hardware MAME real.
2. No admitir eventos generados manualmente como captura nativa.
3. No compartir código ROM-derived ni datasets de CPU y memoria.
4. No instalar un intérprete 6809 en el runtime final para eludir R3.
5. Si el compilador alcanza un límite hardware, modelar y certificar
   solo la capacidad que se necesita para llegar a R4.
