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
