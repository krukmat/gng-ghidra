import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  SPRITE_RAM_START,SPRITE_RAM_LENGTH,SPRITE_REGION_SIZE,
  SPRITE_COUNT,readSpritePen,writeSprite,snapshotSprites,
  spriteFromBuffer,drawOrder,changedSpriteBytes
} from '../src/sprite_memory.mjs';

function empty(){
  const mem=new Uint8Array(65536);
  mem.fill(0xf8,SPRITE_RAM_START,SPRITE_RAM_START+SPRITE_RAM_LENGTH);
  return mem;
}
test('sprite RAM occupies exactly 0x1e00..0x1fff (128 x 4-byte entries)',()=>{
  assert.equal(SPRITE_RAM_START,0x1e00);
  assert.equal(SPRITE_RAM_LENGTH,0x200);
  assert.equal(SPRITE_COUNT,128);
  const mem=empty();
  writeSprite(mem,127,[0xaa,0x37,0xcc,0xdd]);
  assert.deepEqual(Array.from(mem.slice(0x1ffc,0x2000)),[0xaa,0x37,0xcc,0xdd]);
  assert.equal(mem[0x2000],0);
});
test('MAME sprite record: high graphic bits, X sign, y, color and flips',()=>{
  const mem=empty();
  writeSprite(mem,3,[0x55,0xfD,0x60,0xf8]);
  const sprite=spriteFromBuffer(snapshotSprites(mem),3);
  assert.deepEqual(sprite.bytes,[0x55,0xfd,0x60,0xf8]);
  assert.equal(sprite.graphic,0x355);
  assert.equal(sprite.x,-8);
  assert.equal(sprite.y,96);
  assert.equal(sprite.paletteGroup,3);
  assert.equal(sprite.flipX,true);
  assert.equal(sprite.flipY,true);
  assert.equal(sprite.sourceAddress,0x1e0c);
});
test('RGBA graphics are not invented: four planar bits yield pen 0..15, 15 transparent',()=>{
  const rom=new Uint8Array(SPRITE_REGION_SIZE);
  assert.equal(readSpritePen(rom,0,0,0),0);
  rom[0]=0x88;rom[0x10000]=0x88;
  assert.equal(readSpritePen(rom,0,0,0),15);
  assert.equal(readSpritePen(rom,0,4,0),0);
  rom[1]=0x80;
  assert.equal(readSpritePen(rom,0,4,0),8);
  rom[0x10000]=0x80;
  assert.equal(readSpritePen(rom,0,0,0),14);
  // Plane/sample address changes when selecting a new 64-byte sprite.
  rom[64]=0x80;
  assert.equal(readSpritePen(rom,1,0,0),8);
  assert.throws(()=>readSpritePen(rom,1024,0,0),/outside/);
  assert.throws(()=>readSpritePen(rom,0,16,0),/outside/);
});
test('sprite drawing order is reversed and invisible y=248 entries are culled',()=>{
  const mem=empty();
  writeSprite(mem,0,[0,0,90,20]);
  writeSprite(mem,1,[0,0,90,25]);
  writeSprite(mem,127,[0,0,230,250]);
  assert.deepEqual(drawOrder(snapshotSprites(mem)).map(x=>x.slot),[127,1,0]);
  assert.deepEqual(drawOrder(snapshotSprites(empty())),[]);
});
test('DMA snapshots are isolated: writes to CPU RAM only appear after explicit copy',()=>{
  const mem=empty();
  writeSprite(mem,0,[3,0,100,40]);
  const before=snapshotSprites(mem);
  writeSprite(mem,0,[4,0x10,100,110]);
  const after=snapshotSprites(mem);
  assert.deepEqual(spriteFromBuffer(before,0).bytes,[3,0,100,40]);
  assert.deepEqual(spriteFromBuffer(after,0).bytes,[4,0x10,100,110]);
  assert.deepEqual(changedSpriteBytes(before,after).map(x=>x.addr),
    [0x1e00,0x1e01,0x1e03]);
  assert.equal(mem[0x1e00],4);
});
test('unknown memory sizes, malformed records and array aliases are rejected',()=>{
  const mem=empty();
  assert.throws(()=>writeSprite(mem,128,[0,0,0,0]),/slot/);
  assert.throws(()=>writeSprite(mem,0,[0,0,300,0]),/byte/);
  assert.throws(()=>writeSprite(mem,0,[0,0,0]),/Four exact/);
  assert.throws(()=>snapshotSprites(new Uint8Array(512)),/64KiB/);
  assert.throws(()=>spriteFromBuffer(new Uint8Array(65536),0),/512/);
  assert.throws(()=>changedSpriteBytes(new Uint8Array(3),new Uint8Array(512)),/complete/);
});
