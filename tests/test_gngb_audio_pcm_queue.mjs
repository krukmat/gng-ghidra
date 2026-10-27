import test from 'node:test';
import assert from 'node:assert/strict';
import {MonoPCMQueue,AudioPCMStop} from '../src/gngb_audio_pcm_queue.mjs';

test('bounded PCM preserves order and reports every underflow',()=>{
  const q=new MonoPCMQueue(128);
  q.push(new Float32Array([0.25,-0.5,1]));
  const a=new Float32Array(2);
  assert.deepEqual(q.pull(a),{delivered:2,missing:0,queued:1});
  assert.deepEqual([...a],[0.25,-0.5]);
  const b=new Float32Array(3);
  assert.deepEqual(q.pull(b),{delivered:1,missing:2,queued:0});
  assert.deepEqual([...b],[1,0,0]);
  assert.equal(q.underruns,2);
});
test('overflows and invalid audio never become silent success',()=>{
  const q=new MonoPCMQueue(128);
  assert.throws(()=>q.push(new Float32Array(129)),AudioPCMStop);
  assert.throws(()=>q.push(new Float32Array([Number.NaN])),AudioPCMStop);
  q.push(new Float32Array([0.5]));
  q.clear();
  assert.equal(q.length,0);
});
