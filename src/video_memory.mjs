/**
 * GNG (gngb) tilemap addressing and pixels — RAM + original gfx ROM.
 *
 * Hardware reference: MAME src/mame/capcom/gng.cpp:
 * fg: 0x2000-0x27ff, 32x32 ROWS, 8x8, transparent pen 3;
 * bg: 0x2800-0x2fff, 32x32 COLS, 16x16, 0x400 attrs;
 * bg scroll: [0x3b08,0x3b09] X, [0x3b0a,0x3b0b] Y;
 * split BG priority masks group0=(front 0xff,back 0x00),
 * group1=(front 0x41,back 0xbe).
 *
 * No 6809 CPU interpretation, no fabricated ROM stage layouts.
 * Rendering is a memory-fixture diagnostic, not game execution.
 */
export const BG_START=0x2800;
export const FG_START=0x2000;
export const TILEMAP_SIZE=0x800;
export const TILEMAP_CELLS=1024;
export const BG_REGION_SIZE=0x18000;
export const FG_REGION_SIZE=0x4000;
export const BG_SCREEN_SIZE=512;
export const FG_SCREEN_SIZE=256;

function requireMem(m){
  if(!(m instanceof Uint8Array)||m.length!==65536)
    throw new RangeError("Expected full 64KiB 6809-address-space RAM buffer");
}
function requireRegion(buf,kind){
  const size=kind==="bg"?BG_REGION_SIZE:kind==="fg"?FG_REGION_SIZE:0;
  if(!(buf instanceof Uint8Array)||!size||buf.length!==size)
    throw new RangeError("Missing graphics region for "+kind);
}
function requireIndex(index,max,label){
  if(!Number.isInteger(index)||index<0||index>=max)
    throw new RangeError(label+" index out of bounds");
}
function bit(rom,at){
  return (rom[at>>>3]>>>(7-(at&7)))&1;
}
/** Real GNG character 8x8 2bpp or background 16x16 3bpp tile pen. */
export function readTilePen(kind,rom,index,x,y){
  requireRegion(rom,kind);
  requireIndex(index,1024,"ROM tile");
  const max=kind==="bg"?16:8;
  requireIndex(x,max,"tile x");
  requireIndex(y,max,"tile y");
  if(kind==="fg"){
    const offset=index*128+y*16+(x<4?x:x+4);
    return (bit(rom,offset+4)<<0)|(bit(rom,offset)<<1);
  }
  const offset=index*256+y*8+(x<8?x:128+x-8);
  return (bit(rom,offset+0x10000*8)<<0) |
         (bit(rom,offset+0x8000*8)<<1) |
         (bit(rom,offset)<<2);
}
/** Source RAM address for a tile; bg is COLUMN-MAJOR, fg ROW-MAJOR. */
export function tileAddress(kind,col,row){
  if(kind!=="bg"&&kind!=="fg")
    throw new RangeError("Tile kind must be bg or fg");
  requireIndex(col,32,"column");
  requireIndex(row,32,"row");
  const index=kind==="bg"?col*32+row:row*32+col;
  return (kind==="bg"?BG_START:FG_START)+index;
}
export function writeTile(mem,kind,col,row,code,color=0,flipX=false,flipY=false,group=0){
  requireMem(mem);
  requireIndex(code,1024,"graphic code");
  if(!Number.isInteger(color)||color<0||color> (kind==="bg"?7:15))
    throw new RangeError("Palette group out of bounds");
  if(group!==0&&group!==1)throw new RangeError("BG split group must be 0 or 1");
  const addr=tileAddress(kind,col,row);
  const attr=((code>>>8)&3)<<6 | (flipX?0x10:0) |(flipY?0x20:0) |
    (kind==="bg"?(color&7)|(group<<3):(color&15));
  mem[addr]=code&255;
  mem[addr+0x400]=attr;
}
export function readTile(mem,kind,col,row){
  requireMem(mem);
  const addr=tileAddress(kind,col,row),attr=mem[addr+0x400];
  return {
    kind,col,row,addr,bytes:[mem[addr],attr],
    graphic:mem[addr]+((attr&0xc0)<<2),
    palette:attr&(kind==="bg"?7:15),
    group:kind==="bg"?(attr>>3)&1:0,
    flipX:!!(attr&0x10),flipY:!!(attr&0x20),
  };
}
export function screenTile(mem,kind,x,y,scrollX=0,scrollY=0){
  requireMem(mem);
  if(!Number.isInteger(x)||!Number.isInteger(y)||
     !Number.isInteger(scrollX)||!Number.isInteger(scrollY))
    throw new RangeError("Tile coordinates and scroll must be integer");
  const extent=kind==="bg"?BG_SCREEN_SIZE:FG_SCREEN_SIZE;
  const dim=kind==="bg"?16:8;
  const wx=((x+scrollX)%extent+extent)%extent;
  const wy=((y+scrollY)%extent+extent)%extent;
  const tile=readTile(mem,kind,wx/dim|0,wy/dim|0);
  return {
    ...tile,
    x:tile.flipX?dim-1-(wx%dim):wx%dim,
    y:tile.flipY?dim-1-(wy%dim):wy%dim,
  };
}
export function bgPixelLayer(group,pen,layer){
  if((group!==0&&group!==1) || !Number.isInteger(pen)||pen<0||pen>7 ||
     (layer!=="back"&&layer!=="front"))
    throw new RangeError("Invalid BG priority group/pen/layer");
  const mask=group===0
    ? (layer==="front"?0xff:0x00)
    : (layer==="front"?0x41:0xbe);
  return (mask&(1<<pen))===0;
}
export function changedTileBytes(a,b,kind){
  requireMem(a);requireMem(b);
  const start=kind==="bg"?BG_START:kind==="fg"?FG_START:-1;
  if(start<0)throw new RangeError("Unknown tile layer");
  const changes=[];
  for(let i=0;i<TILEMAP_SIZE;i++)if(a[start+i]!==b[start+i])
    changes.push({addr:start+i,before:a[start+i],after:b[start+i],
      field:i<0x400?"code":"attribute",tile:i&0x3ff});
  return changes;
}
