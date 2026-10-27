import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWaterCrossingPolicy} from '../../bot/policy/water-crossing.mjs';

const policy=()=>createWaterCrossingPolicy({flightFrames:12,
  runSpeedPxPerFrame:2,jumpHoldFrames:3,approachRangePx:64,
  takeoffBufferPx:15,landingHeightTolerancePx:10,
  minPlatformDisplacementPx:1,maxObservationGap:5});
const obs=(frame,extra={})=>({frame,session:'s1',lifeKey:'life-1',playing:true,
  arthur:{x:89,feetY:100,grounded:true,confidence:1},
  water:{left:100,right:200,confidence:1},
  platform:{left:118-(frame-1)*2,right:150-(frame-1)*2,
    topY:100,confidence:1},...extra});

test('waits for motion instead of issuing blind jumps',()=>{
  const p=policy();
  assert.equal(p.observe(obs(1)).phase,'WAIT');
  assert.equal(p.observe(obs(2,{platform:{left:118,right:150,topY:100,confidence:1}})).phase,'WAIT');
  assert.equal(p.observe(obs(2)).phase,'STOP');
});

test('controlled jump only when projected landing overlaps moving platform',()=>{
  const p=policy();
  const a=p.observe(obs(1));
  assert.equal(a.phase,'WAIT');
  assert.equal(p.observe(obs(2)).phase,'WAIT');
  const b=p.observe(obs(3));
  assert.equal(b.phase,'TAKEOFF');
  assert.equal(b.action,'right_jump');
  assert.equal(b.projectedLandingX,113);
  for(let f=4;f<=14;f++){
    const result=p.observe(obs(f,{arthur:{x:89+(f-3)*2,feetY:100,
      grounded:false,confidence:1}}));
    assert.equal(result.phase,'AIRBORNE');
  }
  const pending=p.observe(obs(15,{arthur:{x:113,feetY:100,grounded:true,
    confidence:1}}));
  assert.equal(pending.reason,'LANDING_CONFIRMATION_PENDING');
  const landed=p.observe(obs(16,{arthur:{x:113,feetY:100,grounded:true,
    confidence:1}}));
  assert.equal(landed.phase,'LANDED');
  assert.equal(landed.action,'neutral');
  assert.equal(p.observe(obs(17)).phase,'LANDED');
});

test('rejected intercept waits; timeout stops without a blind jump',()=>{
  const p=createWaterCrossingPolicy({flightFrames:12,runSpeedPxPerFrame:2,
    maxWaitFrames:2,minPlatformDisplacementPx:1});
  assert.equal(p.observe(obs(1,{platform:{left:200,right:220,topY:100,
    confidence:1}})).phase,'WAIT');
  for(let f=2;f<=3;f++)assert.equal(p.observe(obs(f,{platform:{
    left:200+(f-1),right:220+(f-1),topY:100,confidence:1}})).phase,'WAIT');
  assert.equal(p.observe(obs(4,{platform:{left:203,right:223,topY:100,
    confidence:1}})).phase,'STOP');
});

test('outside activation range gives control to regular policy',()=>{
  const p=policy();
  const o=obs(1,{arthur:{x:10,feetY:100,grounded:true,confidence:1}});
  assert.equal(p.observe(o).phase,'OUTSIDE_ZONE');
});

test('moving ahead cannot walk off bank without safe intercept',()=>{
  const p=policy();
  assert.equal(p.observe(obs(1,{arthur:{x:65,feetY:100,
    grounded:true,confidence:1}})).phase,'APPROACH');
  assert.equal(p.observe(obs(2,{arthur:{x:101,feetY:100,
    grounded:true,confidence:1}})).reason,'ALREADY_OVER_WATER');
});

test('low confidence, session change and stale frames stop',()=>{
  for(const changed of [
    {platform:{left:110,right:142,topY:100,confidence:0.1}},
    {playing:false},
  ])assert.equal(policy().observe(obs(1,changed)).phase,'STOP');
  const p=policy();p.observe(obs(1));
  assert.equal(p.observe(obs(2,{lifeKey:'life-2'})).reason,
    'SESSION_OR_LIFE_CHANGED');
  const q=policy();q.observe(obs(1));
  assert.equal(q.observe(obs(7)).reason,'STALE_FRAME');
});

test('jump without visual landing evidence never counts as success',()=>{
  const p=policy();p.observe(obs(1));p.observe(obs(2));
  assert.equal(p.observe(obs(3)).phase,'TAKEOFF');
  let last;
  for(let f=4;f<=24;f++){
    last=p.observe(obs(f,{arthur:{x:87,feetY:75,
      grounded:false,confidence:1}}));
  }
  assert.equal(last.phase,'STOP');
  assert.equal(last.reason,'LANDING_NOT_CONFIRMED');
});

test('calibration must be explicit; no gameplay constants inferred',()=>{
  assert.throws(()=>createWaterCrossingPolicy(),/CALIBRATION_REQUIRED/);
  assert.ok(createWaterCrossingPolicy({flightFrames:12,runSpeedPxPerFrame:0}));
  assert.throws(()=>createWaterCrossingPolicy({flightFrames:12,
    runSpeedPxPerFrame:-1}),/CALIBRATION_REQUIRED/);
});


test('camera scroll alone is not mistaken for island movement',()=>{
  const p=policy();
  const shifted=(f,dx)=>obs(f,{arthur:{x:89+dx,feetY:100,
    grounded:true,confidence:1},water:{left:100+dx,right:200+dx,
    confidence:1},platform:{left:118+dx,right:150+dx,topY:100,
    confidence:1}});
  assert.equal(p.observe(shifted(1,0)).phase,'WAIT');
  assert.equal(p.observe(shifted(2,3)).phase,'WAIT');
  const r=p.observe(shifted(3,6));
  assert.equal(r.phase,'WAIT');
  assert.equal(r.reason,'PLATFORM_MOTION_UNCONFIRMED');
});
