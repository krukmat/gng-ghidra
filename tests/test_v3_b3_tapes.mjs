import {test} from 'node:test';
import assert from 'node:assert/strict';
import {B3_PROFILES,B3_HORIZONS,b3Tape,botEvents,sustainEvents} from '../src/v3_b3_tapes.mjs';
import {CYCLES_PER_FRAME} from '../src/gngb_runtime.mjs';
import {seedFromKey} from '../src/v3_b3_ondemand.mjs';
import {blockKey} from '../src/gngb_block_key.mjs';
const F=f=>f*CYCLES_PER_FRAME;
test('human early-Coin tape matches the operator session that halted at 0x519D',()=>{
  const t=b3Tape('humanEarlyCoin');
  assert.equal(t.read(0x3000,F(311)-1)&0x40,0x40);
  assert.equal(t.read(0x3000,F(311))&0x40,0);
  assert.equal(t.read(0x3000,F(333)-1)&0x40,0);
  assert.equal(t.read(0x3000,F(333))&0x40,0x40);
  assert.equal(t.read(0x3000,F(481))&0x01,0);
  assert.equal(t.read(0x3000,F(498))&0x01,0x01);
});
test('tapes are deterministic, distinct and within horizons',()=>{
  const seen=new Set();
  for(const p of B3_PROFILES){
    const a=b3Tape(p),b=b3Tape(p);
    assert.equal(a.sha256,b.sha256);
    seen.add(a.sha256);
    for(const e of a.events)assert.ok(e.cycle<F(B3_HORIZONS[p]));
  }
  assert.equal(seen.size,B3_PROFILES.length);
  assert.throws(()=>b3Tape('nope'),/V3_B3_PROFILE_INVALID/);
});
test('bot uses only P1 controls, one direction at a time',()=>{
  const ev=botEvents(7,1200,6000);
  assert.ok(ev.length>100);
  assert.ok(ev.every(e=>e.control.startsWith('p1.')));
  assert.deepEqual(botEvents(7,1200,6000),ev);
});
test('on-demand seeds round-trip the shared block identity',()=>{
  for(const s of [{bank:null,pc:0x6a9d,overlay:null},{bank:3,pc:0x519d,overlay:null},
    {bank:0,pc:0x4000,overlay:null},{bank:null,pc:0x1a00,overlay:2}])
    assert.deepEqual(seedFromKey(blockKey(s.bank,s.pc,s.overlay)),s);
  assert.throws(()=>seedFromKey(-1),/V3_B3_KEY_INVALID/);
});
test('sustain tapes re-insert Coin/Start periodically',()=>{
  const ev=sustainEvents(7,1200,6000);
  for(let i=1;i<ev.length;i++)assert.ok(ev[i].cycle>=ev[i-1].cycle);
  assert.equal(ev.filter(e=>e.control==='coin1'&&e.pressed).length,5);
  assert.equal(ev.filter(e=>e.control==='start1'&&e.pressed).length,5);
  for(const p of ['sustainA','sustainB'])assert.equal(b3Tape(p).frames,24000);
});
