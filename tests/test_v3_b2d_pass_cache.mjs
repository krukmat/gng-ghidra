import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createB2DCoverageCache} from '../src/v3_b2d_pass_cache.mjs';
const HASH='a'.repeat(64);
const finished=(len=2)=>({
  result:{status:'FRAMES_DONE'},
  hashes:new Array(len).fill(HASH),
  reads:{coin:2,start:0,right:0,left:0,attack:0,jump:0}
});
test('a completed real AOT profile may be skipped until final verification',()=>{
  const c=createB2DCoverageCache(['lateCoin','lateStart']);
  assert.equal(c.has('lateCoin'),false);
  c.remember('lateCoin',finished(),2);
  assert.equal(c.has('lateCoin'),true);
  assert.equal(c.has('lateStart'),false);
  assert.doesNotThrow(()=>c.attest('lateCoin',finished(),2));
});
test('a later AOT change must not alter previously covered state or reads',()=>{
  const c=createB2DCoverageCache(['lateCoin']);
  c.remember('lateCoin',finished(),2);
  const changed=finished();changed.hashes[1]='b'.repeat(64);
  assert.throws(()=>c.attest('lateCoin',changed,2),/FROZEN_DRIFT/);
  const changedPort=finished();changedPort.reads.coin=3;
  assert.throws(()=>c.attest('lateCoin',changedPort,2),/FROZEN_DRIFT/);
});
test('cache does not accept incomplete profile as a completed run',()=>{
  const c=createB2DCoverageCache(['idle']);
  assert.throws(()=>c.remember('idle',{
    ...finished(),result:{status:'UNCOMPILED'}},2),/INVALID_REPLAY/);
  assert.throws(()=>c.remember('idle',finished(1),2),/INVALID_REPLAY/);
  assert.equal(c.has('idle'),false);
});
test('cache is fail-closed on missing attestations and invalid profile names',()=>{
  const c=createB2DCoverageCache(['idle']);
  assert.throws(()=>c.attest('idle',finished(),2),/FROZEN_DRIFT/);
  assert.throws(()=>c.remember('coin',finished(),2),/PROFILE_INVALID/);
  assert.throws(()=>createB2DCoverageCache(['idle','idle']),/PROFILE_INVALID/);
  c.remember('idle',finished(),2);
  assert.throws(()=>c.remember('idle',finished(),2),/DUPLICATE/);
  assert.throws(()=>c.attest('idle',finished(),3),/FROZEN_DRIFT/);
});
