import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createVisibleFrameGate} from '../src/v3_b2c_visible_gate.mjs';
test('unknown frames always advance until first genuine video frame',()=>{
  const g=createVisibleFrameGate();
  assert.equal(g.shouldAdvance({index:310,known:false}),true);
  assert.equal(g.snapshot().armed,true);
  assert.equal(g.shouldAdvance({index:311,known:true}),false);
  assert.equal(g.snapshot().firstVisible,311);
  assert.equal(g.snapshot().paused,true);
});
test('operator releases precisely the existing frozen VBlank, no RAM writes',()=>{
  const g=createVisibleFrameGate();
  g.shouldAdvance({index:311,known:true});
  assert.equal(g.release(),true);
  assert.equal(g.release(),false);
  assert.equal(g.shouldAdvance({index:312,known:true}),true);
  assert.equal(g.snapshot().paused,false);
});
test('pressed hardware Coin prevents unnecessary operator pause',()=>{
  const g=createVisibleFrameGate();
  assert.equal(g.shouldAdvance({index:311,known:true,coinHeld:true}),true);
  assert.equal(g.snapshot().paused,false);
});
test('invalid or synthetic VBlank markers fail closed',()=>{
  const g=createVisibleFrameGate();
  assert.throws(()=>g.shouldAdvance({index:0,known:true}),/FRAME_INVALID/);
  assert.throws(()=>g.shouldAdvance({index:1,known:1}),/FRAME_INVALID/);
});
