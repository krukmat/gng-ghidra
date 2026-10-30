/** Layout of the per-frame record the GnG board snapshots: work RAM, sprite
 * RAM, DMA-buffered sprites, fg/bg video RAM, palette bytes and RGBA.
 * Free of Node APIs so browser workers can import it.
 */
export const REC={ram:0,sprites:0x1e00,buffered:0x2000,fg:0x2200,bg:0x2a00,
  palExt:0x3200,pal:0x3300,rgba:0x3400,size:0x3800};
