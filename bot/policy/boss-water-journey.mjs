/** Ordered orchestration; enemy and terrain detections are supplied as pixels.
 * Existing combat policy owns P1 until BOSS_DEFEATED + combat-release ack.
 * Gates ISLAND landing before SECOND hop to RIGHT_BANK. No gameplay claims.
 */
import {createBossDefeatGate} from './boss-defeat-gate.mjs';
import {createWaterCrossingPolicy} from './water-crossing.mjs';
import {createMainlandHopPolicy} from './mainland-hop.mjs';
import {createWaterPortAdapter} from '../control/water-ports.mjs';

export function createBossWaterJourney({boss={},island,mainland}={}){
  const gate=createBossDefeatGate(boss);
  const toIsland=createWaterCrossingPolicy(island);
  const toMainland=createMainlandHopPolicy(mainland);
  const ports=createWaterPortAdapter();
  let state='BOSS',identity=null,lastFrame=null;
  function reset(){gate.reset();toIsland.reset();toMainland.reset();
    state='BOSS';identity=null;lastFrame=null;return ports.reset();}
  function step(o){
    if(!o||typeof o.session!=='string'||!o.session||
      !(typeof o.lifeKey==='string'&&o.lifeKey||
        Number.isSafeInteger(o.lifeKey)&&o.lifeKey>=0)||
      !Number.isSafeInteger(o.frame)||o.frame<0)
      throw Error('BOT_JOURNEY_OBSERVATION');
    if(state==='DONE')return {stage:'DONE',phase:'DONE',action:'neutral',
      commands:[],reason:'RIGHT_BANK_CONFIRMED'};
    if(!identity)identity={session:o.session,lifeKey:o.lifeKey};
    if(identity.session!==o.session||identity.lifeKey!==o.lifeKey||
      o.playing!==true||
      (lastFrame!==null&&(o.frame<=lastFrame||o.frame-lastFrame>12))){
      state='STOP';
      const {commands}=ports.step({session:identity.session,action:'neutral',
        phase:'STOP'});
      return {stage:'STOP',phase:'STOP',reason:'JOURNEY_LIFE_OR_FRAMES_UNRELIABLE',
        commands,action:'neutral'};
    }
    lastFrame=o.frame;
    if(state==='BOSS'){
      const b=gate.observe(o);
      if(b.phase==='STOP'){state='STOP';return {...b,stage:'STOP',commands:[],
        action:'neutral'};}
      if(b.phase!=='BOSS_DEFEATED')return {...b,stage:'BOSS',
        delegate:'EXISTING_BOSS_COMBAT',commands:[],action:null};
      state='HANDOFF';
      return {stage:'HANDOFF',phase:'BOSS_GATE_PASSED',
        reason:'RELEASE_COMBAT_INPUTS_BEFORE_WATER',commands:[],action:null};
    }
    if(state==='STOP')return {stage:'STOP',phase:'STOP',action:'neutral',
      reason:'JOURNEY_STOPPED',commands:[]};
    if(state==='HANDOFF'){
      if(o.combatReleased!==true)return {stage:'HANDOFF',phase:'AWAIT_COMBAT_RELEASE',
        reason:'WAITING_FOR_COMBAT_POLICY_TO_RELEASE_INPUTS',action:null,commands:[]};
      state='ISLAND';
      return {stage:'ISLAND',phase:'WATER_READY',action:'neutral',commands:[],
        reason:'COMBAT_INPUTS_RELEASED'};
    }
    const decision=state==='ISLAND'?toIsland.observe(o):toMainland.observe(o);
    if(decision.phase==='STOP')state='STOP';
    const isIslandLanding=state==='ISLAND'&&decision.phase==='LANDED';
    const isRightBank=state==='MAINLAND'&&decision.phase==='LANDED';
    // Do not latch the port adapter after first landing: another hop remains.
    const portPhase=isIslandLanding?'TRANSFER_TO_MAINLAND':decision.phase;
    const {commands,status}=ports.step({session:o.session,
      action:decision.action,phase:portPhase});
    if(isIslandLanding)state='MAINLAND';
    if(isRightBank)state='DONE';
    return {...decision,stage:state,commands,portStatus:status};
  }
  return {step,reset};
}
