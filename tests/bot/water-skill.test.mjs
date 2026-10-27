import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWaterSkill} from '../../bot/policy/water-skill.mjs';
const make=()=>createWaterSkill({flightFrames:38,runSpeedPxPerFrame:1.085,
  takeoffBufferPx:9});
const observation=(frame,{shift=0,islandLeft=180,...overrides}={})=>({frame,session:'s',
  arthur:{x:128+shift},terrain:{leftBank:{right:137+shift},
    island:{left:islandLeft+shift,right:islandLeft+30+shift}},
  support:'BANK',grounded:true,...overrides});

test('waits for approach rather than jumping after the receding island',()=>{
  const p=make();
  for(let f=0;f<20;f++){
    const r=p.step(observation(f,{islandLeft:180+f*.8}));
    assert.equal(r.action,'neutral');
  }
});
test('camera motion cancels out of the intercept decision',()=>{
  const a=make(),b=make();let left=196,decision;
  for(let f=0;f<=6;f++){
    left-=.8;
    decision=a.step(observation(f,{islandLeft:left}));
    const moved=b.step(observation(f,{islandLeft:left,shift:-f}));
    assert.equal(moved.action,decision.action);
    assert.equal(moved.reason,decision.reason);
  }
  assert.equal(decision.action,'right');
  assert.equal(decision.phase,'RUNUP');
});
test('jump expires and needs two temporal support observations to land',()=>{
  const p=make();let launch;
  for(let f=0;f<=6;f++)launch=p.step(observation(f,{islandLeft:196-.8*(f+1)}));
  assert.equal(launch.phase,'RUNUP');
  for(let f=7;f<10;f++)assert.equal(p.step(observation(f)).action,'right');
  assert.equal(p.step(observation(10)).action,'right_jump');
  assert.equal(p.step(observation(11)).action,'right_jump');
  assert.equal(p.step(observation(12,{support:null,grounded:false})).action,'right_jump');
  for(let f=13;f<44;f++)p.step(observation(f,{support:null,grounded:false}));
  let r=p.step(observation(44,{islandLeft:120,support:'ISLAND'}));
  assert.equal(r.phase,'AIRBORNE');
  r=p.step(observation(45,{islandLeft:120,support:'ISLAND'}));
  assert.equal(r.phase,'BOARDING');
  assert.equal(r.action,'right');
  r=p.step(observation(46,{islandLeft:110,support:'ISLAND',arthur:{x:133}}));
  assert.equal(r.phase,'LANDED');
  assert.equal(r.action,'neutral');
  for(let f=47;f<=60;f++)r=p.step(observation(f,{support:null,grounded:null}));
  assert.equal(r.phase,'STOP');
  assert.equal(r.reason,'RESET_REQUIRED');
});
test('unknown support does not authorize a launch, and session changes stop',()=>{
  const p=make();
  for(let f=0;f<=10;f++)assert.equal(p.step(observation(f,
    {support:null,grounded:null,islandLeft:196-f*.8})).action,'neutral');
  const stopped=p.step({...observation(11),session:'new'});
  assert.equal(stopped.phase,'STOP');
  assert.equal(stopped.action,'neutral');
});

// M2: second hop after LANDED, from the held island to the far bank.
const landedSkill=(options={})=>{
  const p=createWaterSkill({flightFrames:38,runSpeedPxPerFrame:1.085,
    takeoffBufferPx:9,...options});
  for(let f=0;f<=6;f++)p.step(observation(f,{islandLeft:196-.8*(f+1)}));
  for(let f=7;f<44;f++)p.step(observation(f,{support:null,grounded:false}));
  p.step(observation(44,{islandLeft:120,support:'ISLAND'}));
  p.step(observation(45,{islandLeft:120,support:'ISLAND'}));
  assert.equal(p.step(observation(46,{islandLeft:110,support:'ISLAND',
    arthur:{x:133}})).phase,'LANDED');
  return p;
};
const ride=(frame,{distance=60,support='ISLAND',grounded=true,land=[0,255]}={})=>({
  frame,session:'s',arthur:{x:128},support,grounded,
  terrain:{leftBank:null,island:{left:110,right:140},
    rightBank:distance===null?null:{left:128+distance},
    landSegments:land?[{left:land[0],right:land[1]}]:[]}});

test('hop is opt-in; LANDED survives the departure bank scrolling out',()=>{
  const p=landedSkill();
  for(let f=47;f<80;f++){
    const r=p.step(ride(f,{distance:10}));
    assert.equal(r.phase,'LANDED');
    assert.equal(r.action,'neutral');
  }
});

test('second hop waits for range, runs up, jumps and needs two RIGHT_BANK samples',()=>{
  const p=landedSkill({hopMaxDistancePx:28});
  assert.equal(p.step(ride(47,{distance:40})).action,'neutral');
  assert.equal(p.step(ride(48,{distance:-2})).action,'neutral');
  let r=p.step(ride(49,{distance:28}));
  assert.deepEqual([r.phase,r.action],['HOP_RUNUP','right']);
  for(let f=50;f<53;f++)assert.equal(p.step(ride(f)).action,'right');
  r=p.step(ride(53));
  assert.deepEqual([r.phase,r.action],['HOP_AIRBORNE','right_jump']);
  for(let f=54;f<58;f++)assert.equal(p.step(ride(f,{support:null,grounded:false})).action,
    'right_jump');
  assert.equal(p.step(ride(58,{support:null,grounded:false})).action,'right');
  // Contact before the calibrated flight time is not a landing.
  assert.equal(p.step(ride(70,{support:'RIGHT_BANK'})).phase,'HOP_AIRBORNE');
  assert.equal(p.step(ride(71,{support:'RIGHT_BANK'})).phase,'HOP_AIRBORNE');
  for(let f=72;f<86;f++)p.step(ride(f,{support:null,grounded:null}));
  assert.equal(p.step(ride(86,{support:'RIGHT_BANK'})).phase,'HOP_AIRBORNE');
  r=p.step(ride(87,{support:'RIGHT_BANK'}));
  assert.deepEqual([r.phase,r.action],['ASHORE','right']);
  // The same land relabeled BANK at the screen edge still supports.
  for(let f=88;f<110;f++)assert.equal(p.step(ride(f,{support:f%2?'BANK':'RIGHT_BANK'})).action,
    'right');
  r=p.step(ride(110,{support:'RIGHT_BANK',land:[0,135]}));
  assert.deepEqual([r.action,r.reason],['neutral','HOLD_BEFORE_LAND_EDGE']);
  for(let f=111;f<=123;f++)r=p.step(ride(f,{support:null,grounded:null}));
  assert.deepEqual([r.phase,r.action,r.reason],['STOP','neutral','RIGHT_BANK_SUPPORT_LOST']);
});

test('an unobserved far-bank landing stops with buttons released',()=>{
  const p=landedSkill({hopMaxDistancePx:28});
  p.step(ride(47,{distance:20}));
  let r;
  for(let f=48;f<=105&&r?.phase!=='STOP';f++)r=p.step(ride(f,{support:null,grounded:false}));
  assert.deepEqual([r.phase,r.action,r.reason],
    ['STOP','neutral','RIGHT_BANK_LANDING_NOT_OBSERVED']);
});
