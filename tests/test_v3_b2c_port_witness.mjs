import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPortReadWitness} from '../src/v3_b2c_port_witness.mjs';

test('idle port reads are not reported as button interaction',()=>{
  const w=createPortReadWitness();
  w.observe({addr:0x3000,cycle:8,pc:0x6000,value:0xff});
  w.observe({addr:0x3001,cycle:9,pc:0x6001,value:0xff});
  const s=w.snapshot();
  assert.equal(s.busReads,2);
  assert.equal(s.systemReads,1);
  assert.equal(s.p1Reads,1);
  assert.equal(Object.values(s.activeSamples).reduce((a,b)=>a+b),0);
  assert.equal(s.lastActive,null);
});
test('Coin1 and Start1 require actual CPU active-low read',()=>{
  const w=createPortReadWitness();
  w.observe({addr:0x3000,cycle:123,pc:0x6123,value:0xbf});
  w.observe({addr:0x3000,cycle:126,pc:0x6123,value:0xbe});
  const s=w.snapshot();
  assert.equal(s.activeSamples.coin1,2);
  assert.equal(s.activeSamples.start1,1);
  assert.deepEqual(s.firstActive.coin1,{control:'coin1',cycle:123,pc:0x6123});
  assert.deepEqual(s.firstActive.start1,{control:'start1',cycle:126,pc:0x6123});
  assert.equal(s.lastActive.control,'start1');
});
test('player 1 attack, jump and directional samples are separately counted',()=>{
  const w=createPortReadWitness();
  w.observe({addr:0x3001,cycle:600,pc:0x6600,value:0xee});
  const s=w.snapshot();
  assert.equal(s.activeSamples['p1.right'],1);
  assert.equal(s.activeSamples['p1.button1'],1);
  assert.equal(s.activeSamples['p1.button2'],0);
  assert.equal(s.activeSamples['p1.left'],0);
});
test('a key being held without a bus read never creates a witness',()=>{
  const w=createPortReadWitness();
  const s=w.snapshot();
  assert.equal(s.activeSamples.coin1,0);
  assert.equal(s.activeSamples.start1,0);
  assert.equal(s.lastActive,null);
});
test('malformed bus samples fail closed',()=>{
  const w=createPortReadWitness();
  for(const read of [null,{}, {addr:0x3000,cycle:-1,value:0xbf},
    {addr:0x3000,cycle:0,value:256},
    {addr:0x3000,cycle:0,value:'191'}]){
    assert.throws(()=>w.observe(read),/V3_B2C_WITNESS_INVALID_READ/);
  }
});
test('snapshots are copies and cannot falsify an internal count',()=>{
  const w=createPortReadWitness();
  w.observe({addr:0x3000,cycle:7,value:0xbf});
  const first=w.snapshot();
  first.activeSamples.coin1=999;
  first.firstActive.coin1.cycle=999;
  assert.equal(w.snapshot().activeSamples.coin1,1);
  assert.equal(w.snapshot().firstActive.coin1.cycle,7);
});
