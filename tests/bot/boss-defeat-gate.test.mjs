import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createBossDefeatGate} from '../../bot/policy/boss-defeat-gate.mjs';
const o=(frame,boss,extra={})=>({frame,session:'s',lifeKey:'l',playing:true,
  boss,...extra});
const killed={status:'DEFEATED',evidence:'KILL_ANIMATION',confidence:0.99};

test('the boss must be killed before water is eligible',()=>{
  const g=createBossDefeatGate();
  assert.equal(g.observe(o(1,{status:'VISIBLE',confidence:1})).phase,'BOSS_COMBAT');
  assert.equal(g.observe(o(2,{status:'HIDDEN',confidence:1})).phase,'BOSS_COMBAT');
  assert.equal(g.observe(o(3,{status:'DEFEATED',evidence:'DISAPPEARANCE',confidence:1})).phase,'BOSS_COMBAT');
  assert.equal(g.observe(o(4,killed)).phase,'BOSS_COMBAT');
  assert.equal(g.observe(o(5,killed)).phase,'BOSS_DEFEATED');
  assert.equal(g.observe(o(6,{status:'UNKNOWN'})).phase,'BOSS_DEFEATED');
});
test('the kill confirmation is tied to the same life and session',()=>{
  const g=createBossDefeatGate();g.observe(o(1,killed));
  assert.equal(g.observe(o(2,killed,{lifeKey:'new'})).phase,'STOP');
});
test('stale frames or invalid playing mode fail closed',()=>{
  const g=createBossDefeatGate();g.observe(o(1,killed));
  assert.equal(g.observe(o(30,killed)).phase,'STOP');
  const h=createBossDefeatGate();
  assert.equal(h.observe(o(1,killed,{playing:false})).phase,'STOP');
});
test('confidence must be high and consecutive',()=>{
  const g=createBossDefeatGate();
  assert.equal(g.observe(o(1,killed)).phase,'BOSS_COMBAT');
  assert.equal(g.observe(o(2,{...killed,confidence:0.5})).phase,'BOSS_COMBAT');
  assert.equal(g.observe(o(3,killed)).phase,'BOSS_COMBAT');
  assert.equal(g.observe(o(4,killed)).phase,'BOSS_DEFEATED');
});
