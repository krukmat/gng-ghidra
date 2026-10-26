import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createLiveControls} from '../src/v3_b2c_live_controls.mjs';

test('real-time keyboard ports have the same active-low defaults as V2',()=>{
  const {inputs}=createLiveControls();
  assert.deepEqual([...inputs],[0xff,0xff,0xff]);
});
test('Coin1 and Start1 map to real SYSTEM bits and can be released',()=>{
  const c=createLiveControls();
  assert.equal(c.apply('coin1',true),true);
  assert.equal(c.apply('start1',true),true);
  assert.equal(Atomics.load(c.inputs,0),0xbe);
  assert.deepEqual(c.snapshot(),['coin1','start1']);
  c.release();
  assert.equal(Atomics.load(c.inputs,0),0xff);
  assert.deepEqual(c.snapshot(),[]);
});
test('joystick is 4-way; two directions cannot be held together',()=>{
  const c=createLiveControls();
  assert.equal(c.apply('p1.right',true),true);
  assert.equal(c.apply('p1.up',true),false);
  assert.equal(Atomics.load(c.inputs,1),0xfe);
  assert.equal(c.apply('p1.right',false),true);
  assert.equal(c.apply('p1.up',true),true);
  assert.equal(Atomics.load(c.inputs,1),0xf7);
});
test('buttons coexist with directions; repeated keydown is harmless',()=>{
  const c=createLiveControls();
  assert.equal(c.apply('p1.button1',true),true);
  assert.equal(c.apply('p1.left',true),true);
  assert.equal(c.apply('p1.button1',true),true);
  assert.equal(Atomics.load(c.inputs,1),0xed);
  c.release();
  assert.equal(Atomics.load(c.inputs,1),0xff);
});
test('unapproved keys and types cannot corrupt port bytes',()=>{
  const c=createLiveControls();
  assert.equal(c.apply('__proto__',true),false);
  assert.equal(c.apply('start2',true),false);
  assert.equal(c.apply('p1.right',1),false);
  assert.equal(c.apply('DSW1',true),false);
  assert.deepEqual([...c.inputs],[0xff,0xff,0xff]);
});
