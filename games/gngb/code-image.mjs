/** gngb CPU code view from ROM_START(gngb): fixed 0x6000-0xffff + 5 banks. */
export function gngbCodeImage(read){
  const g4=read('gg4.bin'),g3=read('gg3.bin'),g5=read('gg5.bin');
  if(g4.length!==0x4000||g3.length!==0x8000||g5.length!==0x8000)
    throw Error('R35_T5_PROGRAM_ROM_SIZE');
  const region=new Uint8Array(0x18000);
  region.set(g4,0x4000);region.set(g3,0x8000);region.set(g5,0x10000);
  const fixed=new Uint8Array(0x10000);
  fixed.set(region.subarray(0x6000,0x10000),0x6000);
  const banks=new Uint8Array(5*0x2000);
  banks.set(region.subarray(0x10000,0x18000),0);
  banks.set(region.subarray(0x4000,0x6000),4*0x2000);
  return {fixed,banks};
}
