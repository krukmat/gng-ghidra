import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createBossWaterJourney} from '../../bot/policy/boss-water-journey.mjs';
const config={island:{flightFrames:12,runSpeedPxPerFrame:2,jumpHoldFrames:3,
  maxObservationGap:5},mainland:{flightFrames:12,runSpeedPxPerFrame:2,
  jumpHoldFrames:3,maxFrameGap:5}};
const killed={status:'DEFEATED',evidence:'KILL_ANIMATION',confidence:1};
const o=(frame,extra={})=>({frame,session:'s',lifeKey:'l',playing:true,
  arthur:{x:89,feetY:100,grounded:true,confidence:1},
  water:{left:100,right:200,confidence:1},
  platform:{left:118-(frame-1),right:150-(frame-1),
    topY:100,confidence:1},
  island:{left:118-(frame-1),right:150-(frame-1),
    topY:100,confidence:1},
  land:{left:125,right:240,topY:100,confidence:1},...extra});

test('strict order: boss, inputs released, island, then mainland',()=>{
  const j=createBossWaterJourney(config);
  let r=j.step(o(1,{boss:{status:'VISIBLE',confidence:1}}));
  assert.equal(r.stage,'BOSS');
  assert.equal(r.delegate,'EXISTING_BOSS_COMBAT');
  r=j.step(o(2,{boss:killed}));
  assert.equal(r.stage,'BOSS');
  r=j.step(o(3,{boss:killed}));
  assert.equal(r.phase,'BOSS_GATE_PASSED');
  assert.equal(r.stage,'HANDOFF');
  assert.equal(j.step(o(4)).phase,'AWAIT_COMBAT_RELEASE');
  assert.equal(j.step(o(5,{combatReleased:true})).phase,'WATER_READY');
  assert.equal(j.step(o(6)).phase,'WAIT');
  assert.equal(j.step(o(7)).phase,'WAIT');
  r=j.step(o(8));
  assert.equal(r.phase,'TAKEOFF');
  assert.equal(r.commands.find(x=>x.control==='p1.button2')?.pressed,true);
  for(let f=9;f<=19;f++) {
    r=j.step(o(f,{arthur:{x:89+(f-8)*2,feetY:90,
      grounded:false,confidence:1}}));
    assert.equal(r.stage,'ISLAND');
  }
  r=j.step(o(20,{arthur:{x:112,feetY:100,grounded:true,confidence:1}}));
  assert.equal(r.stage,'ISLAND');
  r=j.step(o(21,{arthur:{x:111,feetY:100,grounded:true,confidence:1}}));
  assert.equal(r.stage,'MAINLAND');
  assert.equal(r.phase,'LANDED');
  // Island landing is not the same as reaching the right bank.
  r=j.step(o(22,{arthur:{x:105,feetY:100,grounded:true,confidence:1}}));
  assert.equal(r.phase,'TAKEOFF_MAINLAND');
  assert.equal(r.stage,'MAINLAND');
  for(let f=23;f<=33;f++)j.step(o(f,{arthur:{x:105+(f-22)*2,
    feetY:90,grounded:false,confidence:1}}));
  j.step(o(34,{arthur:{x:129,feetY:100,grounded:true,confidence:1}}));
  r=j.step(o(35,{arthur:{x:131,feetY:100,grounded:true,confidence:1}}));
  assert.equal(r.stage,'DONE');
  assert.equal(r.reason,'RIGHT_BANK_CONFIRMED');
});
test('invisible boss cannot unlock water',()=>{
  const j=createBossWaterJourney(config);
  for(let f=1;f<=5;f++){
    const r=j.step(o(f,{boss:{status:'HIDDEN',confidence:1}}));
    assert.equal(r.stage,'BOSS');
    assert.equal(r.commands.length,0);
  }
});
test('handoff is invalidated by a new life even with release acknowledged',()=>{
  const j=createBossWaterJourney(config);
  j.step(o(1,{boss:killed}));
  assert.equal(j.step(o(2,{boss:killed})).stage,'HANDOFF');
  const r=j.step(o(3,{lifeKey:'new',combatReleased:true}));
  assert.equal(r.stage,'STOP');
  assert.equal(r.reason,'JOURNEY_LIFE_OR_FRAMES_UNRELIABLE');
  assert.equal(r.commands.length,0);
});
