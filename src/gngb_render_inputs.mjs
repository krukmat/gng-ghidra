/** Frame record layout and renderer inputs, free of Node APIs so that the
 * Android WebView worker can import them. Moved verbatim from
 * scripts/r35_t5_render_check.mjs, which re-exports both.
 */
import {REC} from '../boards/gng/frame-record.mjs';
export {REC};

/** Renderer inputs from one reference record plus its jsonl metadata. */
export function rendererInputs(record,meta,gfx){
  const vas=new Uint8Array(65536);
  vas.set(record.subarray(REC.fg,REC.fg+0x800),0x2000);
  vas.set(record.subarray(REC.bg,REC.bg+0x800),0x2800);
  // machine_reset zeroes scroll; null means never written yet.
  const s=meta.scroll.map(v=>v??0);
  return {videoAddressSpace:vas,
    bufferedSprites:record.slice(REC.buffered,REC.buffered+0x200),
    palette:record.slice(REC.rgba,REC.rgba+0x400),
    scroll:{x:s[0]+256*s[1],y:s[2]+256*s[3]},
    // LS259 resets to 0 and q0 drives flip_screen inverted.
    flipScreen:meta.latch[0]===null||!(meta.latch[0]&1),...gfx};
}
