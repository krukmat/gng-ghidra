/** AO-5/AO-6: MC6809 audio batches -> Z80 session -> ordered YM commands.
 * Same rules as consumeBatch in scripts/gngb_live_audio_worker.mjs, without
 * the native process: each batch returns the W/R commands before its
 * exclusive frontier, then one U at that frontier (12 MHz ticks).
 */
import {createZ80LiveSession} from './gngb_z80_live_session.mjs';

const fail=code=>{const e=Error(code);e.code=code;throw e;};
const KINDS=['SOUNDLATCH_WRITE','AUDIO_RESET_LINE'];

export async function createAudioCommandSource(rom){
  let inputEvents=[],ymEvents=[],seq=0,frontier=0;
  const session=await createZ80LiveSession(rom,{onYmEvent:e=>
    ymEvents.push({...e,seq:seq++})});
  const batch=(throughCycle,events)=>{
    if(!Number.isSafeInteger(throughCycle)||throughCycle<frontier||
       !Array.isArray(events)||events.length>5000)
      fail('AUDIO_LIVE_BATCH_INVALID');
    for(const e of events){
      if(!e||!KINDS.includes(e.kind)||
         !Number.isSafeInteger(e.cycle)||e.cycle<frontier||
         !Number.isInteger(e.value)||e.value<0||e.value>255)
        fail('AUDIO_LIVE_BATCH_INVALID');
      inputEvents.push(e);
    }
    if(inputEvents.length>10000)fail('AUDIO_LIVE_INPUT_QUEUE_OVERFLOW');
    inputEvents.sort((a,b)=>a.cycle-b.cycle);
    let consumed=0;
    while(consumed<inputEvents.length&&inputEvents[consumed].cycle<throughCycle){
      session.apply(inputEvents[consumed]);consumed++;
    }
    inputEvents.splice(0,consumed);
    const stats=session.completeThrough(throughCycle);
    if(ymEvents.length>10000)fail('AUDIO_LIVE_YM_QUEUE_OVERFLOW');
    frontier=throughCycle;
    const tick=frontier*8; // MC6809 1.5 MHz cycles -> 12 MHz master ticks
    ymEvents.sort((a,b)=>a.tick-b.tick||a.seq-b.seq);
    let flushed=0;
    const commands=[];
    while(flushed<ymEvents.length&&ymEvents[flushed].tick<tick){
      const {kind,tick:t,addr,value}=ymEvents[flushed++];
      commands.push(kind==='W'?{kind,tick:t,addr,value}:{kind,tick:t});
    }
    ymEvents.splice(0,flushed);
    commands.push({kind:'U',tick});
    return {commands,stats};
  };
  return Object.freeze({batch,snapshot:session.snapshot});
}

// Native --stream protocol text for the same commands.
export const commandLine=c=>c.kind==='W'?`W ${c.tick} ${c.addr} ${c.value}`:
  `${c.kind} ${c.tick}`;

// Applies one command to a loadYm2203() instance; U returns its PCM block.
export function applyCommand(ym,c){
  if(c.kind==='W')ym.write(c.tick,c.addr,c.value);
  else if(c.kind==='R')ym.reset(c.tick);
  else if(c.kind==='U')return ym.render(c.tick);
  else fail('AUDIO_YM_COMMAND_INVALID');
  return null;
}
