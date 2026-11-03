/** Input-only phase tape invariants; no runtime/ROM dependency. */
import {isDeepStrictEqual} from 'node:util';
export const FRAME_CYCLES=25152;
export const phaseToRam=visiblePhase=>{
  if(!Number.isSafeInteger(visiblePhase)||visiblePhase<2||visiblePhase>255)
    throw Error('H3_PHASE_VISIBLE_INVALID');
  return visiblePhase-1;
};
export function assertPhaseCandidate({visiblePhase,initial,candidate,end,initialSha,candidateSha}){
  const from=phaseToRam(visiblePhase),start=initial?.h3?.goalFrame;
  if(!Number.isSafeInteger(start)||start<1||!Number.isSafeInteger(end)||end<=start)
    throw Error('H3_PHASE_FRAME_RANGE_INVALID');
  if(initialSha!==initial.sha256||candidateSha!==candidate.sha256)
    throw Error('H3_PHASE_TAPE_HASH_INVALID');
  if(initial?.h3?.signal?.phase!==from||!(/^[a-f0-9]{64}$/).test(initial?.h3?.ramSha??''))
    throw Error('H3_PHASE_INITIAL_SIGNAL_INVALID');
  if(initial?.h3?.poke||candidate?.h3?.poke)throw Error('H3_PHASE_POKE_FORBIDDEN');
  if(!Number.isSafeInteger(candidate.frames)||candidate.frames<=end)
    throw Error('H3_PHASE_CANDIDATE_HORIZON_INVALID');
  const cut=start*FRAME_CYCLES;
  if(!isDeepStrictEqual(candidate.events.filter(e=>e.cycle<cut),
    initial.events.filter(e=>e.cycle<cut)))throw Error('H3_PHASE_PREFIX_EVENTS_MISMATCH');
  if(candidate.events.some(e=>e.cycle>end*FRAME_CYCLES))throw Error('H3_PHASE_TAIL_PAST_END');
  if(candidate.events.some(e=>e.cycle>=cut&&!e.control.startsWith('p1.')))
    throw Error('H3_PHASE_NON_PLAYER_TAIL');
  const held=new Set();
  for(const e of candidate.events){if(e.pressed)held.add(e.control);else held.delete(e.control);}
  if([...held].some(control=>control.startsWith('p1.')))throw Error('H3_PHASE_CONTROLS_NOT_RELEASED');
  return {from,to:from+1,start,end,cut};
}
export function transitionObserver(from,start){
  let previous=null,transition=null,count=0,otherChanges=[];
  return {
    record(frame,phase){
      if(frame>start&&previous!==null&&phase!==previous){
        if(previous===from&&phase===from+1){transition=frame;count++;}
        else otherChanges.push({frame,from:previous,to:phase});
      }
      previous=phase;
    },
    result(){return {transition,count,otherChanges};}
  };
}
/** Visible phase 6 (RAM 5→6) extra evidence, per docs/agents/ge-w2-phase6-ending-analysis.md.
 * Bytes are static-analysis labels; 0x71/0x7f/0xde are recorded, not required, until replay confirms them. */
export const PHASE6=Object.freeze({shield:3,playable:1,minRest:30});
export const phase6Sample=(frame,b)=>({frame,phase:b[0x72],weapon:b[0x73],mode:b[0x08],
  loop:b[0x71],f7f:b[0x7f],de:b[0xde],lives:b[0x60]});
export function phase6Evidence(rows,{transition,end}){
  const at=f=>rows.find(r=>r.frame===f),before=at(transition-1);
  if(!before||!at(end))throw Error('H3_PHASE6_ROWS_MISSING');
  if(before.phase!==5||before.weapon!==PHASE6.shield)throw Error('H3_PHASE6_NO_SHIELD');
  if(rows.some(r=>r.lives<rows[0].lives))throw Error('H3_PHASE6_LIFE_LOST');
  let rest=null;
  for(const r of rows)if(r.frame>transition&&r.frame<=end)
    rest=r.phase===6&&r.mode===PHASE6.playable?rest??r.frame:null;
  if(rest===null)throw Error('H3_PHASE6_ROOM_NOT_PLAYABLE');
  const restFrames=end-rest+1;
  if(restFrames<PHASE6.minRest)throw Error('H3_PHASE6_REST_SHORT');
  const seen=k=>[...new Set(rows.filter(r=>r.frame>=rest&&r.frame<=end).map(r=>r[k]))];
  return {weaponAtTransition:before.weapon,firstPlayableRoomFrame:rest,restFrames,
    loop:seen('loop'),f7f:seen('f7f'),de:seen('de')};
}
