/** GnG engine worker entry: the frozen AOT bundle on the GnG board behind the
 * base browser engine host (base/src/host/web/engine-worker.mjs), which owns
 * pacing, presentation, audio batches and the save protocol. GnG supplies
 * input ports 0x3000-0x3004, the drawable rule (no unknown bytes), the
 * renderer, game-state observation and gng.checkpoint.v1
 * (src/checkpoint_format.mjs): 'boot' carries the saved text or null and a
 * loaded session starts cold from that state, like Reiniciar.
 */
import {startEngineWorker} from './base/src/host/web/engine-worker.mjs';
import {GNG_WEB_HOST} from './boards/gng/web-host-config.mjs';

async function bytes(name){
  const res=await fetch(name);
  if(!res.ok)throw Error('AO_FETCH_'+res.status+' '+name);
  return new Uint8Array(await res.arrayBuffer());
}
async function createGngEngine({checkpoint:checkpointText,ports,sink}){
  const [{blocks},{createBoard},{mapGngFrozenBlocks},
    {renderGngbRgba},
    {rendererInputs},{rendererUnknownCount},{INPUT_DEFAULTS},
    {frozenCode,unpackGfx},{createPortReadWitness},{observeGameState},
    {encodeCheckpoint,decodeCheckpoint},{createPortRecorder}]=await Promise.all([
    import('./bundle/program.mjs'),import('./boards/gng/runtime.mjs'),
    import('./boards/gng/code-view.mjs'),
    import('./lib/gngb_frame_renderer.mjs'),import('./lib/gngb_render_inputs.mjs'),
    import('./lib/v2_b1_observable.mjs'),import('./lib/gngb_input_contract.mjs'),
    import('./lib/ao_web_assets.mjs'),import('./lib/v3_b2c_port_witness.mjs'),
    import('./lib/ao_game_state.mjs'),import('./lib/checkpoint_format.mjs'),
    import('./lib/v3_b3_live_tape.mjs')]);
  const res=await fetch('bundle/manifest.json');
  if(!res.ok)throw Error('AO_FETCH_'+res.status+' manifest');
  const manifest=await res.json();
  if(!(blocks instanceof Map)||blocks.size!==manifest.blocks)
    throw Error('AO_BLOCK_COUNT_MISMATCH');
  const [codeBin,overlays,gfxBin]=await Promise.all(
    ['bundle/code.bin','bundle/overlays.bin','gfx.bin'].map(bytes));
  const code=frozenCode(manifest,codeBin,overlays),gfx=unpackGfx(gfxBin);
  const programSha256=manifest.files['program.mjs'];
  // Refused if made by another AOT program or inconsistent.
  const restored=checkpointText&&decodeCheckpoint(checkpointText,{programSha256});
  // Port changes from reset: a loaded session continues the saved tape.
  const recorder=createPortRecorder(),tape=restored?restored.tape.map(c=>[...c]):[];
  ports.set(INPUT_DEFAULTS);
  const witness=createPortReadWitness();
  const readPorts=new Uint8Array(3).fill(255);
  let last=null,stateKey=null,gameState=null;
  const cpu=createBoard(code,mapGngFrozenBlocks(code,blocks),{
    frames:Number.MAX_SAFE_INTEGER,
    portRead:addr=>ports[addr-0x3000],
    onPortRead:read=>{
      witness.observe(read);readPorts[read.addr-0x3000]=read.value;
      recorder.observe(read.addr,read.cycle,read.value);
    },
    onAudioEvent:sink.audioEvent,
    onAudioComplete:mark=>sink.audioFrame(mark.frames),
    onFrame:frame=>{
      last=frame;
      // Same rule as the live wrapper: never draw a frame with unknown bytes.
      sink.frame(frame,rendererUnknownCount(frame)===0);
      const state=observeGameState(frame);
      if(state){
        gameState=state;
        const key=JSON.stringify(state);
        if(key!==stateKey){stateKey=key;sink.observe(state);}
      }
      // Only the frame object is kept; the runtime never reads either log.
      cpu.state.records[frame.index-1]=null;
      cpu.state.events.length=0;
    }});
  if(restored)cpu.importState(restored.cpu);
  return {
    resumeFrame:restored?restored.frame:0,
    // Z80, queued events and both YM2203 of the save, for the audio worker.
    audioState:restored?{audio:restored.audio,ym:restored.ym}:null,
    ready:{blocks:blocks.size},
    step(until){
      const result=cpu.run(until);
      return {status:result?.status??null,frame:cpu.state.records.length,
        cycle:cpu.state.C};
    },
    render:frame=>renderGngbRgba(rendererInputs(frame.record,
      {scroll:frame.scroll,latch:frame.latch},gfx)),
    checkpointPart(frame){
      for(const c of recorder.drain())tape.push(c);
      return {frame,cpu:cpu.exportState(),tape:tape.map(c=>[...c])};
    },
    encodeCheckpoint:(part,audio)=>encodeCheckpoint({programSha256,
      frame:part.frame,cpu:part.cpu,audio:audio.audio,ym:audio.ym,tape:part.tape}),
    probe:()=>({witness:witness.snapshot(),ports:[...ports],reads:[...readPorts],
      ram2:last?.record[2],ram5:last?.record[5],ram23:last?.record[0x23],gameState}),
  };
}
startEngineWorker({config:GNG_WEB_HOST,createEngine:createGngEngine});
