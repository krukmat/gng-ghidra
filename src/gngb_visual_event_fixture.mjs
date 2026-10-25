/**
 * R4.2.D deterministic ROM-free event fixture.
 * Uses deliberate laboratory graphics, not any game ROM or MAME capture.
 */
export function makeR42dLabFixture(){
  const chars=new Uint8Array(0x4000);chars.fill(255);
  const tiles=new Uint8Array(0x18000);
  // A single distinct BG tile in column 1, row 1 to expose scroll effects.
  tiles.fill(255,32,64);tiles.fill(255,0x8000+32,0x8000+64);
  tiles.fill(255,0x10000+32,0x10000+64);
  const sprites=new Uint8Array(0x20000);sprites.fill(255);
  sprites.fill(0,0,64);sprites.fill(0,0x10000,0x10040);
  const events=[];
  const write=(address,value)=>events.push({seq:events.length,kind:'WRITE8',address,value});
  const dma=()=>events.push({seq:events.length,kind:'DMA',address:0x3c00,value:0});
  const checkpoint=id=>events.push({seq:events.length,kind:'CHECKPOINT',id});
  for(let addr=0x2000;addr<=0x2fff;addr++)write(addr,0);
  write(0x2821,1); // FG/BG from the board, never composited manually
  for(let addr=0x1e00;addr<=0x1fff;addr++)write(addr,0xf8);
  for(const [address,value] of [[0x1e00,0],[0x1e01,0],[0x1e02,82],[0x1e03,34]])
    write(address,value);
  for(let i=0;i<256;i++){
    write(0x3800+i,((i&15)<<4)|((i>>>4)&15));
    write(0x3900+i,((i>>>4)&15)<<4);
  }
  for(let addr=0x3b08;addr<=0x3b0b;addr++)write(addr,0);
  write(0x0100,0); // unrelated RAM write; useful negative divergence
  dma();checkpoint('initial-dma');
  write(0x1e03,132);checkpoint('cpu-write-only');
  dma();checkpoint('second-dma');
  write(0x3800,0xf0);checkpoint('palette-update');
  write(0x3b08,16);checkpoint('scroll-update');
  return {events,chars,tiles,sprites,source:'SYNTHETIC_LAB'};
}
