/** Stage-6 Shield/Cross acquisition objective: pure goal + event classifiers.
 * The item is identified by RAM[0x73]===3. This code never mutates RAM,
 * patches inputs, assumes the item spawned, or equates a pickup with stage completion.
 */
import {weaponPolicyForPhase,phaseOutcome,progressionCandidate} from './h3_weapon_policy.mjs';

export const WEAPON_GOAL='weapon';
export const PHASE_GOAL='phase';

export function selectExploreGoal(requested=PHASE_GOAL,fromState=null){
  if(requested!==PHASE_GOAL&&requested!==WEAPON_GOAL)
    throw Error('H3_GOAL_INVALID '+requested);
  if(requested===WEAPON_GOAL){
    if(!fromState||!weaponPolicyForPhase(fromState.phase))
      throw Error('H3_GOAL_WEAPON_REQUIRES_FINAL_STAGE_SEED');
    const target=weaponPolicyForPhase(fromState.phase).requiredWeapon;
    if(fromState.weapon===target)throw Error('H3_GOAL_WEAPON_ALREADY_EQUIPPED');
    return Object.freeze({kind:WEAPON_GOAL,phase:fromState.phase,weapon:target});
  }
  return Object.freeze({kind:PHASE_GOAL});
}

export function exploreGoalSatisfied(goal,initial,current,weaponAtExit=null){
  if(goal.kind===WEAPON_GOAL)return current.phase===goal.phase&&current.weapon===goal.weapon;
  if(!initial)return current.phase===0&&current.scroll>=3072;
  return progressionCandidate(phaseOutcome(initial.phase,current.phase,
    weaponAtExit??current.weapon,weaponPolicyForPhase(initial.phase)));
}

/** Simple observable transition: not proof of the source of the pickup.
 * Requires observed consecutive frames, so callers must not skip frames. */
export function weaponTransition(before,after,frame){
  if(!before||!Number.isSafeInteger(frame)||frame<1) return null;
  if(before.weapon===after.weapon)return null;
  return Object.freeze({frame,from:before.weapon,to:after.weapon,
    phase:after.phase,x:after.x,y:after.y,
    required:after.weapon===weaponPolicyForPhase(after.phase)?.requiredWeapon});
}
