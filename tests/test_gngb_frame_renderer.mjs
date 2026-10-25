import {test} from 'node:test';
import assert from 'node:assert/strict';
import {renderGngbRgba,GNG_FRAME_WIDTH,GNG_FRAME_HEIGHT} from '../src/gngb_frame_renderer.mjs';
import {createGngbBoardMemory} from '../src/gngb_board_memory.mjs';
import {renderGngbBoardFrame} from '../src/gngb_frame_pipeline.mjs';

function graphics(){
  const chars=new Uint8Array(0x4000),tiles=new Uint8Array(0x18000);
  const sprites=new Uint8Array(0x20000),palette=new Uint8Array(0x400);
  chars.fill(0xff); // pen=3: foreground transparent
  sprites.fill(0xff); // transparent sprite ROM except index 0
  sprites.fill(0,0,64);
  sprites.fill(0,0x10000,0x10040);
  for(let i=0;i<256;i++){
    palette[i*4]=i;palette[i*4+1]=(i*3)&255;
    palette[i*4+2]=(255-i);palette[i*4+3]=255;
  }
  return {chars,tiles,sprites,palette,scroll:{x:0,y:0}};
}
function board(){
  const b=createGngbBoardMemory();
  for(let a=0x2000;a<=0x2fff;a++)b.write8(a,0);
  for(let a=0x1e00;a<=0x1fff;a++)b.write8(a,0xf8);
  // slot0: sprite ROM index 0, on-screen, behind transparent FG.
  b.write8(0x1e00,0);b.write8(0x1e01,0);
  b.write8(0x1e02,40);b.write8(0x1e03,20);
  return b;
}
function colorAt(frame,x,y){
  return [...frame.rgba.slice((y*256+x)*4,(y*256+x)*4+4)];
}
test('compositor uses exact R1 visible raster, real RGBA channels and clipping',()=>{
  const b=board();b.write8(0x3c00,0);
  const f=renderGngbBoardFrame({board:b,...graphics()});
  assert.equal(f.width,GNG_FRAME_WIDTH);
  assert.equal(f.height,GNG_FRAME_HEIGHT);
  assert.equal(f.rgba.length,256*224*4);
  assert.equal(f.schema,'gng.r42.board-frame-pipeline.v1');
  assert.deepEqual(colorAt(f,0,0),[0,0,255,255]); // BG pen 0
  assert.deepEqual(colorAt(f,20,24),[64,192,191,255]); // sprite palette 0x40
  assert.deepEqual(colorAt(f,35,39),[64,192,191,255]);
  assert.deepEqual(colorAt(f,36,24),[0,0,255,255]);
  assert.equal(f.native_pixel_equivalence_verified,false);
  assert.equal(f.autonomous_cpu_frame_rendered,false);
  assert.equal(f.game_playable,false);
});
test('board CPU sprite byte changes do not change pixels before next DMA',()=>{
  const b=board(),assets=graphics();b.write8(0x3c00,0);
  const first=renderGngbBoardFrame({board:b,...assets});
  b.write8(0x1e03,80);
  const noDma=renderGngbBoardFrame({board:b,...assets});
  assert.deepEqual(noDma.rgba,first.rgba);
  b.write8(0x3c00,0);
  const second=renderGngbBoardFrame({board:b,...assets});
  assert.notDeepEqual(second.rgba,first.rgba);
  assert.deepEqual(colorAt(second,20,24),[0,0,255,255]);
  assert.deepEqual(colorAt(second,80,24),[64,192,191,255]);
});
test('wrong dimensions, absent ROM graphics, missing palette or scroll fail closed',()=>{
  const b=board(),assets=graphics();b.write8(0x3c00,0);
  for(const patch of [
    {chars:new Uint8Array(1)},{tiles:new Uint8Array(2)},
    {sprites:new Uint8Array(3)},{palette:new Uint8Array(4)},
    {scroll:{x:-1,y:0}},{scroll:{x:0,y:NaN}},
  ]){
    assert.throws(()=>renderGngbBoardFrame({board:b,...assets,...patch}),
      /R42_INVALID_RENDERER_INPUTS/);
  }
});
test('no initialized board video or no DMA means no pixel output',()=>{
  const b=createGngbBoardMemory(),assets=graphics();
  assert.throws(()=>renderGngbBoardFrame({board:b,...assets}),
    /UNINITIALIZED_RENDERER_MEMORY/);
  for(let a=0x2000;a<=0x2fff;a++)b.write8(a,0);
  assert.throws(()=>renderGngbBoardFrame({board:b,...assets}),/NOT_TRIGGERED/);
});
test('foreground and split background overlay sprite in the original R1 order',()=>{
  const b=board(),assets=graphics();b.write8(0x3c00,0);
  // FG: tile(2,5) draws at x=16,y=40; tile index row5 is address 0x20a2.
  b.write8(0x2000+5*32+2,0);
  b.write8(0x2400+5*32+2,0);
  const background=renderGngbBoardFrame({board:b,...assets});
  assert.deepEqual(colorAt(background,20,24),[64,192,191,255]);
  // Make tile0 foreground pen0 by clearing its two planar bits.
  assets.chars.fill(0);
  const cover=renderGngbBoardFrame({board:b,...assets});
  assert.deepEqual(colorAt(cover,20,24),[128,128,127,255]);
});

test('group1 BG front occludes sprites while group0 leaves sprites in front',()=>{
  const b=board(),assets=graphics();b.write8(0x3c00,0);
  assets.tiles.fill(0xff); // graphics pen 7, group1 is BG-front for pen7
  const bgAddress=0x2800+1*32+2; // x=20, visible y=24 -> hardware y=40
  const group0=renderGngbBoardFrame({board:b,...assets});
  assert.deepEqual(colorAt(group0,20,24),[64,192,191,255]);
  b.write8(bgAddress+0x400,0x08);
  const group1=renderGngbBoardFrame({board:b,...assets});
  assert.deepEqual(colorAt(group1,20,24),[7,21,248,255]);
});
