/** GnG composition for an already verified AOT program and sound region.
 * Binary verification and artifact loading remain owned by the build recipe.
 */
import {createBoard,CYCLES_PER_FRAME} from './runtime.mjs';
import {createAudioCommandSource,applyCommand} from '../../src/ao_audio_commands.mjs';
import {loadYm2203} from '../../src/ao_ym2203_wasm.mjs';

const fail=code=>{const e=Error(code);e.code=code;throw e;};
export async function createGngSession({code,blocks,soundRom,wasm,
  frames=Number.MAX_SAFE_INTEGER,portRead=null,onFrame=null,onPcm=null,
  checkpoint=null}={}){
  if(!(blocks instanceof Map)||!(soundRom instanceof Uint8Array)||
     soundRom.length!==0x8000||!(wasm instanceof Uint8Array)||
     !Number.isSafeInteger(frames)||frames<1||
     (onFrame!==null&&typeof onFrame!=='function')||
     (onPcm!==null&&typeof onPcm!=='function'))fail('GNG_SESSION_CONFIG_INVALID');
  const source=await createAudioCommandSource(soundRom);
  const ym=(await loadYm2203(wasm)).create();
  let audioEvents=[],audioFrames=0,closed=false;
  const board=createBoard(code,blocks,{frames,portRead,
    onFrame:r=>{if(onFrame)onFrame(r);},
    onAudioEvent:e=>audioEvents.push({kind:e.kind,value:e.value,cycle:e.cycle}),
    onAudioComplete:mark=>{
      if(mark.frames<=audioFrames)return;
      if(mark.frames!==audioFrames+1)fail('GNG_AUDIO_FRAME_GAP');
      const {commands}=source.batch(mark.frames*CYCLES_PER_FRAME,audioEvents);
      audioEvents=[];
      let block;
      for(const command of commands)block=applyCommand(ym,command)??block;
      if(!block)fail('GNG_AUDIO_PCM_MISSING');
      audioFrames=mark.frames;
      if(onPcm)onPcm(Object.freeze({session:0,sampleStart:block.firstSample,
        sampleRate:62500,samples:block.samples}));
    }});
  if(checkpoint){
    if(!Number.isSafeInteger(checkpoint.frame)||checkpoint.frame<1||
       checkpoint.cpu?.frames!==checkpoint.frame||
       !(checkpoint.ym instanceof Uint8Array))fail('GNG_CHECKPOINT_INVALID');
    board.importState(checkpoint.cpu);
    source.importState(checkpoint.audio);
    ym.load(checkpoint.ym);
    audioFrames=checkpoint.frame;
  }
  const live=()=>{if(closed)fail('GNG_SESSION_CLOSED');};
  const exportState=()=>{
    live();
    if(audioEvents.length||audioFrames!==board.state.records.length)
      fail('GNG_CHECKPOINT_NOT_AT_AUDIO_BOUNDARY');
    return {frame:audioFrames,cpu:board.exportState(),
      audio:source.exportState(),ym:ym.save()};
  };
  return Object.freeze({
    runUntilFrame(frame){live();return board.run(frame);},
    advance(untilCycle){live();return board.advance(untilCycle);},
    exportState,
    snapshot(){live();return {frame:board.state.records.length,
      cycle:board.state.C,audioFrames};},
    close(){if(!closed){ym.destroy();closed=true;}},
    get board(){return board;}
  });
}
