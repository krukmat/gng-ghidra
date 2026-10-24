/**
 * R4.2.C: gngb write-only video control registers.
 * Source: MAME gng.cpp gng_main_map; PALETTE RGBx_444 in emupal.h.
 * 0x3800..0x38ff palette EXT (high byte), 0x3900..0x39ff base (low).
 * 0x3b08..0x3b0b scroll: x low/high, y low/high.
 * No POR defaults are assumed: a renderer snapshot requires all inputs.
 */
export const GNG_PALETTE_EXT_START=0x3800;
export const GNG_PALETTE_BASE_START=0x3900;
export const GNG_SCROLL_START=0x3b08;
const N=256,SCROLL_BYTES=4;
export function isGngVideoRegisterWrite(addr){
  return Number.isInteger(addr) &&
    ((addr>=0x3800&&addr<=0x39ff)||(addr>=0x3b08&&addr<=0x3b0b));
}
export function videoRegisterRegion(addr){
  if(addr>=0x3800&&addr<=0x39ff)return 'PALETTE_MMIO';
  if(addr>=0x3b08&&addr<=0x3b0b)return 'SCROLL_MMIO';
  return null;
}
export function createGngbVideoRegisters(){
  const ext=new Uint8Array(N),base=new Uint8Array(N);
  const extKnown=new Uint8Array(N),baseKnown=new Uint8Array(N);
  const scrollBytes=new Uint8Array(SCROLL_BYTES),scrollKnown=new Uint8Array(SCROLL_BYTES);
  let writes=0;
  function write8(addr,data){
    if(!isGngVideoRegisterWrite(addr)||!Number.isInteger(data)||
        data<0||data>255)
      throw RangeError('R42_VIDEO_MMIO_WRITE_INVALID');
    if(addr<=0x38ff){
      const i=addr-GNG_PALETTE_EXT_START;ext[i]=data;extKnown[i]=1;
    }else if(addr<=0x39ff){
      const i=addr-GNG_PALETTE_BASE_START;base[i]=data;baseKnown[i]=1;
    }else{
      const i=addr-GNG_SCROLL_START;scrollBytes[i]=data;scrollKnown[i]=1;
    }
    writes++;
  }
  function snapshot(){
    if(scrollKnown.some(v=>v!==1)||extKnown.some(v=>v!==1)||
        baseKnown.some(v=>v!==1))
      throw Error('R42_VIDEO_REGISTERS_UNINITIALIZED');
    const palette=new Uint8Array(N*4);
    for(let i=0;i<N;i++){
      // MAME's RGBx_444: word = (ext<<8)|base, RRRRGGGGBBBBxxxx.
      const r=(ext[i]>>>4)&15,g=ext[i]&15,b=(base[i]>>>4)&15;
      palette[i*4]=r*17;palette[i*4+1]=g*17;
      palette[i*4+2]=b*17;palette[i*4+3]=255;
    }
    const scroll=Object.freeze({
      x:scrollBytes[0]|(scrollBytes[1]<<8),
      y:scrollBytes[2]|(scrollBytes[3]<<8)
    });
    return {palette,scroll};
  }
  function clear(){
    ext.fill(0);base.fill(0);extKnown.fill(0);baseKnown.fill(0);
    scrollBytes.fill(0);scrollKnown.fill(0);writes=0;
  }
  function stats(){
    return {
      video_mmio_writes:writes,
      palette_ext_bytes_written:extKnown.reduce((a,b)=>a+b,0),
      palette_base_bytes_written:baseKnown.reduce((a,b)=>a+b,0),
      scroll_register_bytes_written:scrollKnown.reduce((a,b)=>a+b,0),
      video_registers_complete:extKnown.every(v=>v===1)&&
        baseKnown.every(v=>v===1)&&scrollKnown.every(v=>v===1),
      native_palette_reset_or_raster_timing_verified:false
    };
  }
  return Object.freeze({write8,snapshot,clear,stats});
}
