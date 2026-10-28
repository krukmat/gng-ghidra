import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LIVE_FRAMES,MAX_LIVE_FRAMES,validateLiveFrames}
  from '../src/v3_b2c_session_policy.mjs';

test('certified AOT bundles run as genuine ~10-minute live sessions',()=>{
  assert.equal(LIVE_FRAMES,36000);
  assert.equal(MAX_LIVE_FRAMES,216000);
  assert.equal(validateLiveFrames({frames:600,blocks:354}),36000);
  assert.equal(validateLiveFrames({frames:6000,blocks:2266}),36000);
  assert.equal(validateLiveFrames({frames:6000,blocks:38084}),36000);
});
test('live bound never weakens bundled evidence or mutates manifest',()=>{
  const manifest=Object.freeze({frames:600,blocks:354});
  assert.equal(validateLiveFrames(manifest,8500),8500);
  assert.equal(manifest.frames,600);
});
test('unverified manifests and unsupported requested frame counts fail closed',()=>{
  for(const manifest of [null,{}, {frames:599,blocks:354},
    {frames:600,blocks:0},{frames:600,blocks:40001},
    {frames:216001,blocks:354}, {frames:NaN,blocks:354}]){
    assert.throws(()=>validateLiveFrames(manifest),/V3_B2C_UNVERIFIED_BUNDLE/);
  }
  for(const frames of [599,NaN,Infinity,216001,600.5,-1,'6000']){
    assert.throws(()=>validateLiveFrames({frames:600,blocks:354},frames),
      /V3_B2C_SESSION_FRAMES_INVALID/);
  }
  assert.throws(()=>validateLiveFrames({frames:1000,blocks:354},600),
    /V3_B2C_SESSION_FRAMES_INVALID/);
});
