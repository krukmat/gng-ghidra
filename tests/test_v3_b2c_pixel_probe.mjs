import {test} from 'node:test';
import assert from 'node:assert/strict';
import {FRAME_BYTES,inspectRealFrame}
  from '../src/v3_b2c_pixel_probe.mjs';
test('fully black authentic buffer is detected, never declared visible',()=>{
  const rgba=new Uint8Array(FRAME_BYTES);
  for(let i=3;i<rgba.length;i+=4)rgba[i]=255;
  const s=inspectRealFrame(rgba);
  assert.equal(s.allBlack,true);
  assert.equal(s.nonBlackPixels,0);
  assert.equal(s.rgbColors,1);
  assert.equal(s.transparentPixels,0);
});
test('real non-black colour and alpha are counted without mutation',()=>{
  const rgba=new Uint8Array(FRAME_BYTES);
  for(let i=3;i<rgba.length;i+=4)rgba[i]=255;
  rgba[0]=240;rgba[1]=12;rgba[2]=9;
  const prior=Uint8Array.from(rgba);
  const s=inspectRealFrame(rgba);
  assert.equal(s.nonBlackPixels,1);
  assert.equal(s.rgbColors,2);
  assert.equal(s.maxChannel,240);
  assert.equal(s.allBlack,false);
  assert.deepEqual(rgba,prior);
});
test('fully transparent data is reported separately from visual brightness',()=>{
  const rgba=new Uint8Array(FRAME_BYTES);
  rgba[0]=20;
  const s=inspectRealFrame(rgba);
  assert.equal(s.nonBlackPixels,1);
  assert.equal(s.transparentPixels,256*224);
  assert.equal(s.nonOpaquePixels,256*224);
});
test('malformed geometry and types fail rather than invent pixels',()=>{
  assert.throws(()=>inspectRealFrame(null),/INVALID_FRAME_TYPE/);
  assert.throws(()=>inspectRealFrame(Buffer.alloc(10)),/INVALID_FRAME_LENGTH/);
  assert.throws(()=>inspectRealFrame(new Array(FRAME_BYTES)),/INVALID_FRAME_TYPE/);
});
