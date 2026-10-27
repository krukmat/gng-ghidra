import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPortRecorder,liveTapeReader} from '../src/v3_b3_live_tape.mjs';

test('recorder keeps only value changes, first read of each port included', () => {
  const r=createPortRecorder();
  r.observe(0x3000,10,0xff);r.observe(0x3000,20,0xff);r.observe(0x3003,25,0xdf);
  r.observe(0x3000,30,0xbf);r.observe(0x3001,40,0xff);
  assert.deepEqual(r.drain(),[[0,10,0xff],[3,25,0xdf],[0,30,0xbf],[1,40,0xff]]);
  assert.deepEqual(r.drain(),[]);
  r.observe(0x3000,50,0xbf);
  assert.deepEqual(r.drain(),[]);
  assert.throws(()=>r.observe(0x3005,60,0),/PORT/);
});

test('reader replays the recorded values at the same cycles', () => {
  const live=[[0x3000,10,0xff],[0x3000,20,0xff],[0x3001,22,0xfe],[0x3000,30,0xbf],
    [0x3001,31,0xfe],[0x3000,45,0xbf],[0x3001,50,0xff]];
  const r=createPortRecorder();
  for(const [a,c,v] of live)r.observe(a,c,v);
  const read=liveTapeReader(r.drain());
  for(const [a,c,v] of live)assert.equal(read(a,c),v);
});

test('reader rejects unrecorded ports and reads that go back in time', () => {
  const read=liveTapeReader([[0,10,0xff]]);
  assert.throws(()=>read(0x3001,11),/UNRECORDED/);
  assert.equal(read(0x3000,12),0xff);
  assert.throws(()=>read(0x3000,11),/READ_ORDER/);
  assert.throws(()=>liveTapeReader([[0,10,1],[0,9,2]]),/INVALID/);
});
