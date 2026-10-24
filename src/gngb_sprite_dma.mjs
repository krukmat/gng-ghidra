/**
 * R4.2.A: gngb sprite DMA *logical snapshot* (no timing/CPU cycle emulation).
 * MAME gng.cpp maps 0x3c00 to buffered_spriteram8_device::write.
 * A transfer is explicit, preserves 512 bytes, and never aliases CPU RAM.
 */
export const GNG_SPRITE_DMA_TRIGGER=0x3c00;
export const GNG_SPRITE_RAM_START=0x1e00;
export const GNG_SPRITE_RAM_LENGTH=0x200;

export function createGngbSpriteDma(){
  let buffer=null;
  let transfers=0;
  function validateSource(cpuMemory,known){
    if(!(cpuMemory instanceof Uint8Array)||cpuMemory.length!==65536||
        !(known instanceof Uint8Array)||known.length<0x2000)
      throw new TypeError('GNGB_SPRITE_DMA_SOURCE_INVALID');
    for(let i=GNG_SPRITE_RAM_START;i<GNG_SPRITE_RAM_START+GNG_SPRITE_RAM_LENGTH;i++)
      if(known[i]!==1)throw Error('GNGB_SPRITE_DMA_SOURCE_INCOMPLETE');
  }
  function trigger(address,value,cpuMemory,known){
    if(address!==GNG_SPRITE_DMA_TRIGGER||!Number.isInteger(value)||
        value<0||value>255)
      throw new RangeError('GNGB_SPRITE_DMA_TRIGGER_INVALID');
    validateSource(cpuMemory,known);
    buffer=cpuMemory.slice(GNG_SPRITE_RAM_START,
      GNG_SPRITE_RAM_START+GNG_SPRITE_RAM_LENGTH);
    transfers++;
  }
  function snapshot(){
    if(buffer===null)throw Error('GNGB_SPRITE_DMA_NOT_TRIGGERED');
    return buffer.slice();
  }
  function clear(){buffer=null;transfers=0;}
  function stats(){
    return {
      sprite_dma_transfers:transfers,
      sprite_dma_buffer_ready:buffer!==null,
      sprite_dma_buffer_bytes:buffer===null?0:GNG_SPRITE_RAM_LENGTH,
      sprite_dma_timing_native_verified:false
    };
  }
  return Object.freeze({validateSource,trigger,snapshot,clear,stats});
}
