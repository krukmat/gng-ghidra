/** Phase-specific exploration guard. Read-only: never writes RAM or input events.
 * Phase 5 in 0x72 is the visible final-boss stage; no later phase is assumed.
 * A forward RAM change is a candidate, NOT proof of a final room or ending.
 */
export const FINAL_ENCOUNTER_POLICY=Object.freeze({
  id:'final-boss-weapon',phase:5,weaponAddress:0x73,requiredWeapon:3,
  rollbackPhase:4,rollbackCode:'INVALID_WEAPON_ROLLBACK',
});

export const weaponPolicyForPhase=phase=>
  phase===FINAL_ENCOUNTER_POLICY.phase?FINAL_ENCOUNTER_POLICY:null;

/** Never treat a backward transition as success. An otherwise forward phase
 * change in the final encounter is still only a candidate for investigation. */
export function phaseOutcome(from,to,weapon,policy=weaponPolicyForPhase(from)){
  if(from===to)return 'UNCHANGED';
  if(to<from)return policy&&to===policy.rollbackPhase&&weapon!==policy.requiredWeapon?
    policy.rollbackCode:'PHASE_ROLLBACK';
  if(policy)return weapon===policy.requiredWeapon?
    'FORWARD_TRANSITION_UNVERIFIED':'WEAPON_PRECONDITION_UNMET';
  return 'PHASE_ADVANCED';
}

export const progressionCandidate=outcome=>
  outcome==='PHASE_ADVANCED'||outcome==='FORWARD_TRANSITION_UNVERIFIED';

/** The required weapon has ranking priority over geography and score, but
 * unarmed routes remain explorable so enemies can be killed for item drops. */
export const weaponPriority=(s,policy)=>policy&&s.weapon===policy.requiredWeapon?1:0;
