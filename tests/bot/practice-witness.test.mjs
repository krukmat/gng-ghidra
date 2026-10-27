import {test} from 'node:test';
import assert from 'node:assert/strict';
import {comparePracticeWitness}
  from '../../bot/live/practice-witness.mjs';
const img=(r=0,g=0,b=0)=>{
  const v=new Uint8Array(256*224*4);
  for(let i=0;i<v.length;i+=4)v.set([r,g,b,255],i);
  return v;
};
test('identical historical scene qualifies only as candidate',()=>{
  const a=img(50,130,30);
  const result=comparePracticeWitness(a,new Uint8Array(a));
  assert.equal(result.status,'SCENE_MATCH_CANDIDATE');
  assert.equal(result.notProofOfLife,true);
  assert.equal(result.agreement,1);
});
test('GAME OVER-like replacement scene blocks handoff',()=>{
  const a=img(0,0,0),b=img(85,150,170);
  const result=comparePracticeWitness(a,b);
  assert.equal(result.status,'SCENE_MISMATCH');
  assert.equal(result.agreement,0);
});
test('sprite differences do not invalidate a largely matching scene',()=>{
  const a=img(20,70,150),b=new Uint8Array(a);
  for(let y=130;y<158;y++)for(let x=100;x<137;x++)
    b.set([255,0,0,255],(y*256+x)*4);
  assert.equal(comparePracticeWitness(a,b).status,'SCENE_MATCH_CANDIDATE');
});
test('invalid RGBA dimensions rejected before any success report',()=>{
  assert.throws(()=>comparePracticeWitness(new Uint8Array(12),img()),
    /BOT_PRACTICE_WITNESS_PIXELS_INVALID/);
});
