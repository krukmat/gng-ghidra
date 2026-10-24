import test from 'node:test';
import assert from 'node:assert/strict';
import {createGngbVideoRegisters} from '../src/gngb_video_registers.mjs';
const reg=()=>createGngbVideoRegisters();
function complete(r){
  for(let i=0;i<256;i++){r.write8(0x3800+i,0);r.write8(0x3900+i,0);}
  for(let a=0x3b08;a<=0x3b0b;a++)r.write8(a,0);
}
test('R4.2.C1 little-endian scroll is unavailable until all 4 bytes were written',()=>{
  const r=reg();complete(r);
  r.write8(0x3b08,0x34);r.write8(0x3b09,0x12);
  r.write8(0x3b0a,0xef);r.write8(0x3b0b,0xcd);
  assert.deepEqual(r.snapshot().scroll,{x:0x1234,y:0xcdef});
  assert.equal(r.stats().scroll_register_bytes_written,4);
  assert.equal(r.stats().video_registers_complete,true);
});
test('R4.2.C2 MAME RGBx_444 decodes EXT high + base low with alpha 255',()=>{
  const r=reg();complete(r);
  r.write8(0x3800+12,0xa3);r.write8(0x3900+12,0xf1);
  assert.deepEqual([...r.snapshot().palette.slice(12*4,12*4+4)],[170,51,255,255]);
  r.write8(0x3900+12,0xf9); // low nibble ignored by RGBx_444
  assert.deepEqual([...r.snapshot().palette.slice(12*4,12*4+4)],[170,51,255,255]);
  r.write8(0x3900+12,0x21);
  assert.deepEqual([...r.snapshot().palette.slice(12*4,12*4+4)],[170,51,34,255]);
});
test('R4.2.C2 missing palette plane or scroll is never silently zero-initialized',()=>{
  const r=reg();
  assert.throws(()=>r.snapshot(),/R42_VIDEO_REGISTERS_UNINITIALIZED/);
  for(let i=0;i<256;i++)r.write8(0x3800+i,0);
  for(let a=0x3b08;a<=0x3b0b;a++)r.write8(a,0);
  assert.throws(()=>r.snapshot(),/R42_VIDEO_REGISTERS_UNINITIALIZED/);
  for(let i=0;i<255;i++)r.write8(0x3900+i,0);
  assert.throws(()=>r.snapshot(),/R42_VIDEO_REGISTERS_UNINITIALIZED/);
  r.write8(0x39ff,0);
  assert.equal(r.snapshot().palette.length,1024);
});
test('R4.2.C3 snapshot never aliases writable palette and clear invalidates state',()=>{
  const r=reg();complete(r);
  const first=r.snapshot();first.palette[0]=190;
  assert.equal(r.snapshot().palette[0],0);
  r.write8(0x3800,0xf0);
  assert.equal(r.snapshot().palette[0],255);
  assert.equal(first.scroll.x,0);
  r.clear();
  assert.equal(r.stats().video_mmio_writes,0);
  assert.equal(r.stats().video_registers_complete,false);
  assert.throws(()=>r.snapshot(),/UNINITIALIZED/);
});
test('R4.2.C4 bad addresses/data do not corrupt previous video register state',()=>{
  const r=reg();complete(r);const previous=r.snapshot();
  for(const [a,d] of [[0x3b07,0],[0x3b0c,0],[0x37ff,0],[0x3a00,0],
    [0x3900,-1],[0x3900,256],[0x3900,NaN],[0x3800,1.25]])
    assert.throws(()=>r.write8(a,d),/R42_VIDEO_MMIO_WRITE_INVALID/);
  assert.deepEqual(r.snapshot(),previous);
});
