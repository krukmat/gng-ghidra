import {test} from 'node:test';
import assert from 'node:assert/strict';
import {B2D_FRAMES,B2D_PROFILES,b2dTape} from '../src/v3_b2d_tapes.mjs';
import {CYCLES_PER_FRAME} from '../src/gngb_runtime.mjs';
test('profiles are stable, independent, bounded and versioned',()=>{
  assert.equal(B2D_FRAMES,1500);
  assert.deepEqual(B2D_PROFILES,
    ['lateControls','lateStart','lateCoin','idle','earlyControls']);
  const all=B2D_PROFILES.map(b2dTape);
  assert.equal(new Set(all.map(x=>x.sha256)).size,5);
  for(let i=0;i<all.length;i++){
    assert.equal(all[i].sha256,b2dTape(B2D_PROFILES[i]).sha256);
    assert.ok(all[i].events.every(e=>e.cycle<B2D_FRAMES*CYCLES_PER_FRAME));
  }
});
test('idle returns real inactive SYSTEM and P1',()=>{
  const tape=b2dTape('idle');
  assert.equal(tape.read(0x3000,817*CYCLES_PER_FRAME),0xff);
  assert.equal(tape.read(0x3001,945*CYCLES_PER_FRAME),0xff);
});
test('late Coin samples hardware between frames 812 and 822',()=>{
  const tape=b2dTape('lateCoin'),t=b2dTape('lateStart');
  assert.equal(tape.read(0x3000,811*CYCLES_PER_FRAME),0xff);
  assert.equal(tape.read(0x3000,817*CYCLES_PER_FRAME),0xbf);
  assert.equal(tape.read(0x3000,822*CYCLES_PER_FRAME),0xff);
  assert.equal(t.read(0x3000,855*CYCLES_PER_FRAME),0xfe);
  assert.equal(tape.read(0x3000,855*CYCLES_PER_FRAME),0xff);
});
test('late controls expose joystick and buttons only after Start',()=>{
  const t=b2dTape('lateControls');
  assert.equal(t.read(0x3001,905*CYCLES_PER_FRAME),0xfe);
  assert.equal(t.read(0x3001,943*CYCLES_PER_FRAME),0xef);
  assert.equal(t.read(0x3001,975*CYCLES_PER_FRAME),0xfd);
  assert.equal(t.read(0x3001,1015*CYCLES_PER_FRAME),0xdf);
  assert.equal(b2dTape('lateStart').read(0x3001,905*CYCLES_PER_FRAME),0xff);
});
test('early Coin and Start retain original B2B behavior',()=>{
  const t=b2dTape('earlyControls');
  assert.equal(t.read(0x3000,421*CYCLES_PER_FRAME),0xbf);
  assert.equal(t.read(0x3000,531*CYCLES_PER_FRAME),0xfe);
});
test('arbitrary profiles are rejected',()=>{
  assert.throws(()=>b2dTape('__proto__'),/V3_B2D_PROFILE_INVALID/);
  assert.throws(()=>b2dTape('unknown'),/V3_B2D_PROFILE_INVALID/);
});
