/** V2.B1: renderer-observable inputs; never treat uninitialized RAM as zero. */
const ranges=[[0x2000,0x2200],[0x2200,0x2a00],[0x2a00,0x3200],
              [0x3200,0x3800]];
export function rendererUnknownCount(frame){
  if(!(frame?.known instanceof Uint8Array)||frame.known.length!==0x3800)
    throw Error('V2_B1_KNOWN_MASK_INVALID');
  let n=0;
  for(const [a,b] of ranges)
    for(let i=a;i<b;i++)if(frame.known[i]!==255)n++;
  // MAME's zero-valued reference sprite buffer is not evidence that
  // JS has observed its source before the first DMA transfer.
  if(frame.sprite_buffer_valid!==true)n+=0x200;
  return n;
}
