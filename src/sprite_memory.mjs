/**
 * Strict sprite-RAM decoder for Ghosts 'n Goblins (gngb) visual fixtures.
 *
 * MAME Capcom gng.cpp: buffered spriteram8, 0x1e00..0x1fff (128 records
 * of 4 bytes); reversed draw order; code high bits from attribute bits
 * 6-7, X high sign bit from attribute bit 0, flip flags 2/3, palette 4/5.
 * 16x16 four-bitplane sprites decoded with the original spritelayout.
 *
 * Test-only / visual-runtime helper. No Motorola 6809 emulation here.
 */
export const SPRITE_RAM_START=0x1e00;
export const SPRITE_RAM_LENGTH=0x200;
export const SPRITE_RECORD_SIZE=4;
export const SPRITE_COUNT=128;
export const SCREEN_WIDTH=256;
export const SCREEN_HEIGHT=240;
export const SPRITE_COUNT_ROM=1024;
export const SPRITE_REGION_SIZE=0x20000;
const HALF_BITS=0x10000*8;
const PLANE_OFFSETS=[HALF_BITS+4,HALF_BITS,4,0];
const X_OFFSETS=[0,1,2,3,8,9,10,11,256,257,258,259,264,265,266,267];

function isBytes(value){
  return value instanceof Uint8Array;
}
function ensureByte(x,label){
  if(!Number.isInteger(x)||x<0||x>255)
    throw new RangeError(label+" must be a byte");
}
function ensureSlot(slot){
  if(!Number.isInteger(slot)||slot<0||slot>=SPRITE_COUNT)
    throw new RangeError("Sprite slot must be 0..127");
}
function ensureImage(rom){
  if(!isBytes(rom)||rom.length!==SPRITE_REGION_SIZE)
    throw new RangeError("GNG sprite graphics region must be 131072 bytes");
}
export function readSpritePen(rom,index,x,y){
  ensureImage(rom);
  if(!Number.isInteger(index)||index<0||index>=SPRITE_COUNT_ROM||
     !Number.isInteger(x)||x<0||x>=16||
     !Number.isInteger(y)||y<0||y>=16)
    throw new RangeError("Sprite index or x/y outside original ROM layout");
  let pen=0;
  for(let plane=0;plane<4;plane++){
    const bitpos=index*512+PLANE_OFFSETS[plane]+
      X_OFFSETS[x]+(y<8?y*16:128+(y-8)*16);
    const bit=(rom[bitpos>>>3]>>>(7-(bitpos&7)))&1;
    pen|=bit<<plane;
  }
  return pen;
}
export function writeSprite(memory,slot,bytes){
  if(!isBytes(memory)||memory.length!==65536)
    throw new RangeError("Expected full 64KiB CPU RAM fixture");
  ensureSlot(slot);
  if(!Array.isArray(bytes)||bytes.length!==4)
    throw new RangeError("Four exact sprite record bytes required");
  bytes.forEach((v,i)=>ensureByte(v,"sprite byte "+i));
  memory.set(bytes,SPRITE_RAM_START+slot*SPRITE_RECORD_SIZE);
}
export function snapshotSprites(memory){
  if(!isBytes(memory)||memory.length!==65536)
    throw new RangeError("Expected 64KiB CPU address space");
  return memory.slice(SPRITE_RAM_START,SPRITE_RAM_START+SPRITE_RAM_LENGTH);
}
export function spriteFromBuffer(buffer,slot){
  if(!isBytes(buffer)||buffer.length!==SPRITE_RAM_LENGTH)
    throw new RangeError("Buffered sprite RAM must be exactly 512 bytes");
  ensureSlot(slot);
  const i=slot*SPRITE_RECORD_SIZE;
  const code=buffer[i],attributes=buffer[i+1],
    sy=buffer[i+2],rawX=buffer[i+3];
  return {
    slot,sourceAddress:SPRITE_RAM_START+i,
    bytes:[code,attributes,sy,rawX],
    graphic:code+((attributes<<2)&0x300),
    paletteGroup:(attributes>>4)&3,
    x:rawX-0x100*(attributes&1),
    y:sy,
    flipX:!!(attributes&4),
    flipY:!!(attributes&8),
  };
}
export function drawOrder(buffer){
  const sprites=[];
  // MAME renders highest RAM offsets first; lower slots overdraw them.
  for(let slot=SPRITE_COUNT-1;slot>=0;slot--){
    const sprite=spriteFromBuffer(buffer,slot);
    if(sprite.x+15<0 || sprite.x>=SCREEN_WIDTH ||
       sprite.y+15<0 || sprite.y>=SCREEN_HEIGHT)continue;
    sprites.push(sprite);
  }
  return sprites;
}
export function changedSpriteBytes(before,after){
  if(!isBytes(before)||before.length!==SPRITE_RAM_LENGTH||
     !isBytes(after)||after.length!==SPRITE_RAM_LENGTH)
    throw new RangeError("Compare only two complete buffered sprite RAM snapshots");
  const changed=[];
  for(let i=0;i<SPRITE_RAM_LENGTH;i++)if(before[i]!==after[i])
    changed.push({addr:SPRITE_RAM_START+i,slot:i>>2,field:i&3,
      before:before[i],after:after[i]});
  return changed;
}
