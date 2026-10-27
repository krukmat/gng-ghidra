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
