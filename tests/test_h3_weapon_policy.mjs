import test from 'node:test';
import assert from 'node:assert/strict';
import {FINAL_ENCOUNTER_POLICY,weaponPolicyForPhase,phaseOutcome,
  progressionCandidate,weaponPriority} from '../src/h3_weapon_policy.mjs';

test('phase-5 weapon policy is specific and read-only',()=>{
  assert.equal(weaponPolicyForPhase(4),null);
  assert.equal(weaponPolicyForPhase(5),FINAL_ENCOUNTER_POLICY);
  assert.equal(FINAL_ENCOUNTER_POLICY.weaponAddress,0x73);
  assert.equal(FINAL_ENCOUNTER_POLICY.requiredWeapon,3);
});

test('45814 regression: phase 5 to 4 with weapon 4 cannot be success',()=>{
  const outcome=phaseOutcome(5,4,4);
  assert.equal(outcome,'INVALID_WEAPON_ROLLBACK');
  assert.equal(progressionCandidate(outcome),false);
  assert.equal(phaseOutcome(5,5,4),'UNCHANGED');
  assert.equal(phaseOutcome(5,4,3),'PHASE_ROLLBACK');
  assert.equal(progressionCandidate(phaseOutcome(3,2,3)),false);
});

test('shield required for final encounter; room and ending not assumed',()=>{
  assert.equal(phaseOutcome(5,6,4),'WEAPON_PRECONDITION_UNMET');
  assert.equal(progressionCandidate(phaseOutcome(5,6,4)),false);
  assert.equal(phaseOutcome(5,6,3),'FORWARD_TRANSITION_UNVERIFIED');
  assert.equal(progressionCandidate(phaseOutcome(5,6,3)),true);
  assert.equal(phaseOutcome(4,5,4),'PHASE_ADVANCED');
  assert.equal(progressionCandidate(phaseOutcome(4,5,4)),true);
  assert.equal(weaponPriority({weapon:3},weaponPolicyForPhase(5)),1);
  assert.equal(weaponPriority({weapon:4},weaponPolicyForPhase(5)),0);
  assert.equal(weaponPriority({weapon:3},null),0);
});
