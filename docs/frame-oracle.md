# R0 — Fotograma auténtico del arcade, no otra escena inventada

## Por qué se ha reemplazado la dirección V1.2

La captura de V1.2 aportada por el operador (2026-10-16) muestra
un mosaico de tiles repetidos y sin sentido como escenario. Es el
resultado correcto para el fixture que programamos, pero **no**
demuestra progresos hacia un port jugable. Fue un error usar un
collage arbitrario como hito visual. La aceptación visual V1.2 se
rechaza y no se mejorará con nuevos patrones o paletas artificiales.

**A partir de aquí un frame se basa en memoria de vídeo REAL
generada por la ROM original, no en un fixture aleatorio.**

## R0, circuito de referencia externo

- **MAME solo como oráculo de pruebas externo.** No se incluye
  en el producto o JS, ni se interpreta MC6809 en el runtime.
- El script Lua de referencia intercepta las escrituras reales
  de scroll (0x3b08–0x3b0b) y DMA (0x3c00), observa el buffer
  de sprites durante DMA, y captura las zonas FG (0x2000–27ff),
  BG (0x2800–2fff), la paleta RGB de 256 entradas y el PNG
  de 256×224 del mismo frame de MAME.
- El HTML generado por Python contiene **solo** los bytes
  de ese fotograma de referencia y los bitplanes gráficos
  originales de la ROM, verificados por CRC. Renderiza el
  fotograma desde dichos bytes con JS y lo compara píxel a píxel
  con el PNG renderizado por MAME.
- El pipeline falla si no hay screenshot, si las direcciones
  de scroll no concuerdan, si no se observó DMA, si la captura
  está incompleta, si los SHA-256 cambiaron o si faltan ROMs.
  **Prohibido sustituirlos por memoria inventada para un PASS.**

La instantánea puede tener diferencias de sincronización (frame,
raster, sprite buffering). Detectarlas es un resultado que
investigaremos, no una excusa para declarar equivalencia.

## Uso local en Mac — necesita MAME solo para la referencia

Si MAME está disponible (comprobar con command -v mame), con tus
archivos ROM exclusivamente locales en roms/:

    git pull --ff-only
    python3 scripts/capture_real_frame.py --system gngb --rompath roms --frame 600
    python3 src/reference_frame_view.py --rom roms/gng.zip
    open out/visual/frame-compare.html

Si tienes **solo** el ROM set gng.zip en lugar de gngb.zip, usa
--system gng en el comando de captura: ambos son revisiones
distintas de CPU ROM; el resultado del capturador registra
qué driver se usó. Para GNGb exacto necesitas su set de
programa gngb y su parent gráfico gng. El sistema no descarga
ROMs ni mezcla silenciosamente revisiones.

Si el ZIP gráfico está dividido, añade al segundo comando
--shared /ruta/local/parent.zip. El primer comando acepta
--mame /ruta/al/binario si no aparece en PATH. El driver real
se puede cambiar usando --system, pero debe quedar anotado.

**Nunca subir** out/reference/, out/visual/frame-compare.html,
ROM ZIP, datos VRAM ni capturas a GitHub. Están en el directorio
ignorado out/ y contienen material del juego.

### Qué espero ver

El HTML comparará dos imágenes del mismo estado:
1. **Fotograma original de referencia (MAME)**. Este sí muestra
   el contenido real producido por la ejecución del programa.
2. **Fotograma reconstruido por JavaScript** desde BG/FG,
   sprites, paleta RGB y scroll capturados. Al igual que las
   pruebas anteriores, usa bitplanes gráficos de ROM; a
   diferencia de V1.2, NO inventa tilemaps.

Un tercer lienzo rojo/gris da discrepancias. El hito
**NO SE ACEPTA** hasta que se confirme con la ROM local
que el panel derecho corresponde sustancialmente al izquierdo,
y se diagnostiquen los errores detectados. Un
pixel-perfect en un frame tampoco demuestra gameplay.

### No confundir R0 con V2

R0 es equivalencia del **renderer de vídeo alimentado con RAM
auténtica de referencia**, sin código Motorola 6809 ejecutándose
en JavaScript. V2 requiere que **nuestro código generado con
Ghidra** produzca esa RAM/scroll/semántica; ese es el paso
hacia el juego real. MAME solo existirá en el entorno de tests.

Documentación del hardware:
[MAME gng.cpp](https://github.com/mamedev/mame/blob/master/src/mame/capcom/gng.cpp).
API Lua: [memory shares/CPU write taps](https://docs.mamedev.org/luascript/ref-mem.html),
[screens/palette](https://docs.mamedev.org/luascript/ref-devices.html),
[frame notifiers](https://docs.mamedev.org/luascript/ref-common.html).
