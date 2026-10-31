/** GnG composition. `createSession` is the recipe entry point: it checks the
 * recipe, verifies the original regions through the game module and binds the
 * AOT program to them. `createGngSession` composes already verified inputs.
 * The two halves are exported for hosts that run them in separate workers.
 */
import {createBoard,CYCLES_PER_FRAME} from './runtime.mjs';
import {createGngAudioProducer} from '../../src/gngb_audio_producer.mjs';
import {validateRecipe} from '../../base/src/contracts/index.mjs';
import {verifyInput,assertProgramMatches,SOUND_REGION}
  from '../../games/gngb/index.mjs';

export {createBoard,CYCLES_PER_FRAME,createGngAudioProducer};

const fail=code=>{const e=Error(code);e.code=code;throw e;};

/** Recipe → session. `program` is the loaded program bundle `{code, blocks}`
 * (boards/gng/bundle.mjs) keyed by code identity; `devices.ym2203` is the
 * bank WASM bytes. */
export async function createSession(recipe,regions,{program,devices,...integration}={}){
  validateRecipe(recipe);
  if(recipe.board.id!=='gng'||recipe.board.module!=='boards/gng/index.mjs'||
     recipe.game.module!=='games/gngb/index.mjs'||
     recipe.devices.length!==1||recipe.devices[0]!=='ym2203')
    fail('GNG_RECIPE_UNSUPPORTED');
  if(!program?.code||!(program.blocks instanceof Map)||
     !(devices?.ym2203 instanceof Uint8Array))fail('GNG_SESSION_CONFIG_INVALID');
  const input=await verifyInput(recipe,regions);
  assertProgramMatches(program.code,input.regions);
  return createGngSession({...integration,code:program.code,
    blocks:program.blocks,
    soundRom:input.regions[SOUND_REGION],wasm:devices.ym2203});
}
export async function createGngSession({code,blocks,soundRom,wasm,
  frames=Number.MAX_SAFE_INTEGER,portRead=null,onFrame=null,onPcm=null,
  checkpoint=null}={}){
  if(!(blocks instanceof Map)||!(soundRom instanceof Uint8Array)||
     soundRom.length!==0x8000||!(wasm instanceof Uint8Array)||
     !Number.isSafeInteger(frames)||frames<1||
     (onFrame!==null&&typeof onFrame!=='function')||
     (onPcm!==null&&typeof onPcm!=='function'))fail('GNG_SESSION_CONFIG_INVALID');
  const audio=await createGngAudioProducer({soundRom,wasm});
  let audioEvents=[],audioFrames=0,closed=false;
  const board=createBoard(code,blocks,{frames,portRead,
    onFrame:r=>{if(onFrame)onFrame(r);},
    onAudioEvent:e=>audioEvents.push({kind:e.kind,value:e.value,cycle:e.cycle}),
    onAudioComplete:mark=>{
      if(mark.frames<=audioFrames)return;
      if(mark.frames!==audioFrames+1)fail('GNG_AUDIO_FRAME_GAP');
      const block=audio.batch(mark.frames*CYCLES_PER_FRAME,audioEvents);
      audioEvents=[];
      audioFrames=mark.frames;
      if(onPcm)onPcm(Object.freeze({session:0,sampleStart:block.firstSample,
        sampleRate:block.sampleRate,samples:block.samples}));
    }});
  if(checkpoint){
    if(!Number.isSafeInteger(checkpoint.frame)||checkpoint.frame<1||
       checkpoint.cpu?.frames!==checkpoint.frame||
       !(checkpoint.ym instanceof Uint8Array))fail('GNG_CHECKPOINT_INVALID');
    board.importState(checkpoint.cpu);
    audio.importState(checkpoint);
    audioFrames=checkpoint.frame;
  }
  const live=()=>{if(closed)fail('GNG_SESSION_CLOSED');};
  const exportState=()=>{
    live();
    if(audioEvents.length||audioFrames!==board.state.records.length)
      fail('GNG_CHECKPOINT_NOT_AT_AUDIO_BOUNDARY');
    return {frame:audioFrames,cpu:board.exportState(),...audio.exportState()};
  };
  return Object.freeze({
    runUntilFrame(frame){live();return board.run(frame);},
    advance(untilCycle){live();return board.advance(untilCycle);},
    exportState,
    snapshot(){live();return {frame:board.state.records.length,
      cycle:board.state.C,audioFrames};},
    close(){if(!closed){audio.close();closed=true;}},
    get board(){return board;}
  });
}
