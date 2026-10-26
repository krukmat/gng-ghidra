import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LIVE_FRAMES,MAX_LIVE_FRAMES,validateLiveFrames}
  from '../src/v3_b2c_session_policy.mjs';

test('certified AOT 600 frames can run as genuine 6000-frame live session',()=>{
  assert.equal(LIVE_FRAMES,6000);
  assert.equal(MAX_LIVE_FRAMES,12000);
  assert.equal(validateLiveFrames({frames:600,blocks:354}),6000);
  assert.equal(validateLiveFrames({frames:1000,blocks:400}),6000);
});
test('live bound never weakens bundled evidence or mutates manifest',()=>{
  const manifest=Object.freeze({frames:600,blocks:354});
  assert.equal(validateLiveFrames(manifest,8500),8500);
  assert.equal(manifest.frames,600);
});
test('unverified manifests and unsupported requested frame counts fail closed',()=>{
  for(const manifest of [null,{}, {frames:599,blocks:354},
    {frames:600,blocks:0},{frames:600,blocks:30001},
    {frames:12001,blocks:354}, {frames:NaN,blocks:354}]){
    assert.throws(()=>validateLiveFrames(manifest),/V3_B2C_UNVERIFIED_BUNDLE/);
  }
  for(const frames of [599,NaN,Infinity,12001,600.5,-1,'6000']){
    assert.throws(()=>validateLiveFrames({frames:600,blocks:354},frames),
      /V3_B2C_SESSION_FRAMES_INVALID/);
  }
  assert.throws(()=>validateLiveFrames({frames:1000,blocks:354},600),
    /V3_B2C_SESSION_FRAMES_INVALID/);
});
