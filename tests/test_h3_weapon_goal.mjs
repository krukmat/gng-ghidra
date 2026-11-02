import test from 'node:test';
import assert from 'node:assert/strict';
import {selectExploreGoal,exploreGoalSatisfied,weaponTransition}
  from '../src/h3_weapon_goal.mjs';

const start={phase:5,weapon:4,scroll:7424,x:7400,y:1600};
test('GE-W2: only final-stage input-only seeds can target the shield',()=>{
  assert.deepEqual(selectExploreGoal('weapon',start),
    {kind:'weapon',phase:5,weapon:3});
  assert.deepEqual(selectExploreGoal('phase',start),{kind:'phase'});
  assert.throws(()=>selectExploreGoal('weapon',null),/FINAL_STAGE_SEED/);
  assert.throws(()=>selectExploreGoal('weapon',{...start,phase:4}),/FINAL_STAGE_SEED/);
  assert.throws(()=>selectExploreGoal('weapon',{...start,weapon:3}),/ALREADY_EQUIPPED/);
  assert.throws(()=>selectExploreGoal('other',start),/GOAL_INVALID/);
});

test('GE-W2: picking up shield is distinct from finishing the stage',()=>{
  const weapon=selectExploreGoal('weapon',start),phase=selectExploreGoal();
  assert.equal(exploreGoalSatisfied(weapon,start,start),false);
  assert.equal(exploreGoalSatisfied(weapon,start,{...start,weapon:3,x:7412}),true);
  assert.equal(exploreGoalSatisfied(weapon,start,{...start,weapon:3,phase:4}),false);
  assert.equal(exploreGoalSatisfied(phase,start,{...start,phase:4},4),false);
  assert.equal(exploreGoalSatisfied(phase,start,{...start,phase:6,weapon:4},4),false);
  assert.equal(exploreGoalSatisfied(phase,start,{...start,phase:6,weapon:4},3),true);
  assert.equal(exploreGoalSatisfied(phase,null,{phase:0,scroll:3072}),true);
  assert.equal(exploreGoalSatisfied(phase,null,{phase:1,scroll:3072}),false);
});

test('GE-W2: read-only weapon transitions record pickup frame and position',()=>{
  const shield={...start,weapon:3,x:7412};
  assert.deepEqual(weaponTransition(start,shield,41820),{
    frame:41820,from:4,to:3,phase:5,x:7412,y:1600,required:true
  });
  assert.equal(weaponTransition(shield,shield,41821),null);
  assert.deepEqual(weaponTransition(shield,start,41900),{
    frame:41900,from:3,to:4,phase:5,x:7400,y:1600,required:false
  });
  assert.equal(weaponTransition(null,shield,41820),null);
  assert.equal(weaponTransition(start,shield,0),null);
});
