import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createGngbSpriteDma,GNG_SPRITE_DMA_TRIGGER,GNG_SPRITE_RAM_START,GNG_SPRITE_RAM_LENGTH}
  from '../src/gngb_sprite_dma.mjs';
const setup=()=>{
  const memory=new Uint8Array(65536),known=new Uint8Array(0x3000);
  memory.fill(0xf8,GNG_SPRITE_RAM_START,GNG_SPRITE_RAM_START+GNG_SPRITE_RAM_LENGTH);
  known.fill(1,GNG_SPRITE_RAM_START,GNG_SPRITE_RAM_START+GNG_SPRITE_RAM_LENGTH);
  return {memory,known,dma:createGngbSpriteDma()};
};
test('one trigger latches exactly 512 bytes, independent of later CPU RAM writes',()=>{
  const x=setup();x.memory[0x1e00]=0x45;
  assert.throws(()=>x.dma.snapshot(),/NOT_TRIGGERED/);
  x.dma.trigger(GNG_SPRITE_DMA_TRIGGER,0,x.memory,x.known);
  assert.equal(x.dma.snapshot().length,512);
  assert.equal(x.dma.snapshot()[0],0x45);
  x.memory[0x1e00]=0x67;
  assert.equal(x.dma.snapshot()[0],0x45);
  const view=x.dma.snapshot();view[0]=0;
  assert.equal(x.dma.snapshot()[0],0x45);
  assert.deepEqual(x.dma.stats(),{
    sprite_dma_transfers:1,sprite_dma_buffer_ready:true,sprite_dma_buffer_bytes:512,
    sprite_dma_timing_native_verified:false
  });
});
test('two triggers replace the buffer atomically, preserving the old snapshot',()=>{
  const x=setup();x.memory[0x1fff]=0x52;
  x.dma.trigger(0x3c00,255,x.memory,x.known);
  const first=x.dma.snapshot();
  x.memory[0x1fff]=0x97;
  x.dma.trigger(0x3c00,1,x.memory,x.known);
  assert.equal(first[511],0x52);
  assert.equal(x.dma.snapshot()[511],0x97);
  assert.equal(x.dma.stats().sprite_dma_transfers,2);
});
test('incomplete or malformed source never corrupts a latched frame',()=>{
  const x=setup();x.dma.trigger(0x3c00,0,x.memory,x.known);
  x.known[0x1f4a]=0;
  assert.throws(()=>x.dma.trigger(0x3c00,0,x.memory,x.known),/SOURCE_INCOMPLETE/);
  assert.equal(x.dma.snapshot()[0x14a],0xf8);
  assert.equal(x.dma.stats().sprite_dma_transfers,1);
  assert.throws(()=>x.dma.trigger(0x3c00,0,new Uint8Array(512),x.known),/SOURCE_INVALID/);
  assert.throws(()=>x.dma.trigger(0x3c00,0,x.memory,new Uint8Array(512)),/SOURCE_INVALID/);
});
test('invalid register writes reject without changing DMA state',()=>{
  const x=setup();
  for(const [address,data] of [[0x3c01,0],[0x3c00,256],[0x3c00,-1],[0x3c00,1.5]])
    assert.throws(()=>x.dma.trigger(address,data,x.memory,x.known),/TRIGGER_INVALID/);
  assert.equal(x.dma.stats().sprite_dma_transfers,0);
  assert.throws(()=>x.dma.snapshot(),/NOT_TRIGGERED/);
});
test('lab reset invalidates the buffer and clears counters',()=>{
  const x=setup();x.dma.trigger(0x3c00,0,x.memory,x.known);
  x.dma.clear();
  assert.equal(x.dma.stats().sprite_dma_buffer_ready,false);
  assert.equal(x.dma.stats().sprite_dma_transfers,0);
  assert.throws(()=>x.dma.snapshot(),/NOT_TRIGGERED/);
});
