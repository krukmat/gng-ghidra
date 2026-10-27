import {test} from 'node:test';
import assert from 'node:assert/strict';
import {detectWaterTerrain,createIslandVelocityTracker}
  from '../../bot/perception/terrain-water.mjs';
const frame=(shore,island)=>{
  const rgba=new Uint8Array(256*224*4);
  for(let i=3;i<rgba.length;i+=4)rgba[i]=255;
  const paint=(x,y,c)=>rgba.set([...c,255],(y*256+x)*4);
  for(let x=0;x<=shore;x++)for(let y=192;y<=206;y++)paint(x,y,[85,119,0]);
  for(let x=island;x<island+32;x++)for(let y=196;y<=200;y++)
    paint(x,y,[0,119,0]);
  return {rgba};
};
test('island is separate from departure bank and never verified',()=>{
  const r=detectWaterTerrain(frame(130,175));
  assert.equal(r.island.left,175);
  assert.equal(r.island.right,206);
  assert.ok(r.leftBank.right>=129&&r.leftBank.right<=135);
  assert.equal(r.rightBank,null);
  assert.equal(r.verified,false);
});
test('blank pixels never invent land or island',()=>{
  const r=detectWaterTerrain({rgba:new Uint8Array(256*224*4)});
  assert.equal(r.hasWaterGap,false);
  assert.equal(r.leftBank,null);
  assert.equal(r.island,null);
});
test('camera-relative island velocity can be measured from three observations',()=>{
  const t=createIslandVelocityTracker();
  const sample=(n,s,i)=>t.observe({frame:n,session:'s',
    terrain:detectWaterTerrain(frame(s,i))});
  assert.equal(sample(2700,141,178).status,'UNKNOWN');
  assert.equal(sample(2710,130,175).status,'UNKNOWN');
  const r=sample(2720,127,180);
  assert.equal(r.status,'MOTION_CANDIDATE');
  assert.ok(r.velocity>0.7&&r.velocity<0.9);
  assert.equal(r.calibrated,false);
});
test('session change and absent observations fail closed',()=>{
  const t=createIslandVelocityTracker();
  t.observe({frame:1,session:'a',terrain:detectWaterTerrain(frame(130,180))});
  assert.equal(t.observe({frame:2,session:'b',
    terrain:detectWaterTerrain(frame(128,180))}).status,'UNKNOWN');
  assert.equal(t.observe({frame:3,session:'b',terrain:null}).status,'UNKNOWN');
});
