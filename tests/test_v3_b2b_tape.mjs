import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createV3Tape,V3_PROFILES,PROFILE_FRAMES,CYCLES_PER_FRAME}
  from '../src/v3_b2b_tape.mjs';
test('tapes have distinct, stable hashes, explicit schema and bounded frames',()=>{
  assert.deepEqual(V3_PROFILES,['coin','start','controls']);
  assert.equal(PROFILE_FRAMES,1000);
  assert.equal(CYCLES_PER_FRAME,25152);
  const t=V3_PROFILES.map(createV3Tape);
  assert.equal(new Set(t.map(x=>x.sha256)).size,3);
  assert.deepEqual(t.map(x=>x.sha256),V3_PROFILES.map(x=>createV3Tape(x).sha256));
  for(const x of t){
    assert.equal(x.events.at(-1).cycle<PROFILE_FRAMES*CYCLES_PER_FRAME,true);
    assert.ok(Object.isFrozen(x)&&Object.isFrozen(x.events));
  }
});
test('coin pulse traverses CPU port read then returns to idle',()=>{
  const t=createV3Tape('coin');
  assert.equal(t.read(0x3000,420*CYCLES_PER_FRAME-1),0xff);
  assert.equal(t.read(0x3000,420*CYCLES_PER_FRAME),0xbf);
  assert.equal(t.read(0x3000,422*CYCLES_PER_FRAME),0xff);
});
test('start presses only after coin releases',()=>{
  const a=createV3Tape('start'),b=createV3Tape('coin');
  assert.equal(a.read(0x3000,530*CYCLES_PER_FRAME),0xfe);
  assert.equal(b.read(0x3000,530*CYCLES_PER_FRAME),0xff);
});
test('movement, attack and jump exercise player 1 independently',()=>{
  const t=createV3Tape('controls');
  assert.equal(t.read(0x3001,650*CYCLES_PER_FRAME),0xfe);
  assert.equal(t.read(0x3001,664*CYCLES_PER_FRAME),0xff);
  assert.equal(t.read(0x3001,680*CYCLES_PER_FRAME),0xef);
  assert.equal(t.read(0x3001,720*CYCLES_PER_FRAME),0xfd);
  assert.equal(t.read(0x3001,750*CYCLES_PER_FRAME),0xdf);
  assert.equal(t.read(0x3002,750*CYCLES_PER_FRAME),0xff);
});
test('invalid profile fails closed',()=>{
  assert.throws(()=>createV3Tape('__proto__'),/V3_B2B_UNKNOWN_PROFILE/);
  assert.throws(()=>createV3Tape(''),/V3_B2B_UNKNOWN_PROFILE/);
});
