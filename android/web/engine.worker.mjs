/** GnG engine worker entry: the program bundle on the GnG board behind the
 * base browser engine host (base/src/host/web/engine-worker.mjs), which owns
 * pacing, presentation, audio batches and the save protocol. GnG supplies
 * input ports 0x3000-0x3004, the drawable rule (no unknown bytes), the
 * renderer, game-state observation (games/gngb/state.mjs) and gng.checkpoint.v1
 * (src/checkpoint_format.mjs): 'boot' carries the saved text or null and a
 * loaded session starts cold from that state, like Reiniciar. 'boot' also
 * carries the game options (games/gngb/options.mjs: DIP lives/difficulty and
 * the enemy pace); a loaded session keeps the options it was saved with.
 * `net` ({role: 'host'|'guest'}) plays a two-player game over a link
 * (src/netplay_turns.mjs): from reset only, without saves; session messages
 * go out as engine messages {type:'net', m} and come in the same way.
 * The P1 port is read through the input shaper (src/ao_input_shaper.mjs,
 * numbers in games/gngb/inputs.mjs): the page sends its fingers as engine
 * messages {type:'p1', value} and {type:'p1-repeat', fire}; Coin, Start and
 * Continue taps stay in the host's `ports`.
 */
import {startEngineWorker} from './base/src/host/web/engine-worker.mjs';
import {GNG_WEB_HOST} from './boards/gng/web-host-config.mjs';

async function bytes(name){
  const res=await fetch(name);
  if(!res.ok)throw Error('AO_FETCH_'+res.status+' '+name);
  return new Uint8Array(await res.arrayBuffer());
}
async function createGngEngine({checkpoint:checkpointText,ports,sink,options:chosen,net}){
  const [{blocks},{createBoard},{gngCode},
    {renderGngbRgba},
    {rendererInputs},{rendererUnknownCount},{INPUT_DEFAULTS,INPUT_CONTROLS},
    {unpackGfx},{createPortReadWitness},{observeGameState},
    {encodeCheckpoint,decodeCheckpoint},{createPortRecorder},
    {gameOptions,optionDips,withGameOptions},
    {createTurnSession},{createGngTurnRule},
    {createInputShaper},{p1Shaper,P1_SHAPING}]=await Promise.all([
    import('./bundle/program.mjs'),import('./boards/gng/runtime.mjs'),
    import('./boards/gng/bundle.mjs'),
    import('./lib/gngb_frame_renderer.mjs'),import('./lib/gngb_render_inputs.mjs'),
    import('./lib/v2_b1_observable.mjs'),import('./lib/gngb_input_contract.mjs'),
    import('./lib/ao_web_assets.mjs'),import('./lib/v3_b2c_port_witness.mjs'),
    import('./games/gngb/state.mjs'),import('./lib/checkpoint_format.mjs'),
    import('./lib/v3_b3_live_tape.mjs'),import('./games/gngb/options.mjs'),
    import('./lib/netplay_turns.mjs'),import('./games/gngb/netplay.mjs'),
    import('./lib/ao_input_shaper.mjs'),import('./games/gngb/inputs.mjs')]);
  const res=await fetch('bundle/manifest.json');
  if(!res.ok)throw Error('AO_FETCH_'+res.status+' manifest');
  const manifest=await res.json();
  if(!(blocks instanceof Map)||blocks.size!==manifest.program.blocks)
    throw Error('AO_BLOCK_COUNT_MISMATCH');
  const [codeBin,overlays,gfxBin]=await Promise.all(
    ['bundle/code.bin','bundle/overlays.bin','gfx.bin'].map(bytes));
  const code=gngCode(manifest,codeBin,overlays),gfx=unpackGfx(gfxBin);
  const programSha256=manifest.files['program.mjs'];
  // Refused if made by another AOT program or inconsistent.
  const restored=checkpointText&&decodeCheckpoint(checkpointText,{programSha256});
  const options=gameOptions(restored?restored.options:{...chosen,continues:false}),
    dips=optionDips(options);
  // Port changes from reset: a loaded session continues the saved tape; a
  // new one starts with its DIP bytes, which the board serves from `dips`
  // (it only asks portRead for 0x3000-0x3002).
  const recorder=createPortRecorder(),tape=restored?restored.tape.map(c=>[...c]):
    [[3,0,dips[0]],[4,0,dips[1]]];
  ports.set(INPUT_DEFAULTS);
  if(net&&restored)throw Error('NET_FROM_RESET_ONLY');
  const session=net?createTurnSession({role:net.role,ownerAfter:createGngTurnRule(),
    defaults:INPUT_DEFAULTS.slice(0,3),send:m=>sink.post({type:'net',m}),
    onEvent:event=>sink.post({type:'net-event',event})}):null;
  // Our controls: P1 as shaped for this frame once the page reports fingers.
  const shaper=createInputShaper(p1Shaper(INPUT_CONTROLS,INPUT_DEFAULTS[1]));
  let p1=INPUT_DEFAULTS[1];
  const own=addr=>addr===0x3001&&shaper.active?p1:ports[addr-0x3000];
  // In a session the frames the peer owns read its stream, not our controls.
  const portRead=session?(addr,cycle)=>session.owns()?own(addr):
    session.read(addr-0x3000,cycle):own;
  const witness=createPortReadWitness();
  const readPorts=new Uint8Array(3).fill(255);
  let last=null,stateKey=null,gameState=null;
  const cpu=createBoard(code,withGameOptions(blocks,options),{
    frames:Number.MAX_SAFE_INTEGER,dips,
    portRead,
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
    ready:{blocks:blocks.size,options,net:session?{role:session.role}:null},
    step(until){
      // A frame the peer has not sent yet (or a session that ended) waits.
      if(session&&!session.canRun(until))
        return {status:'WAIT',frame:cpu.state.records.length,cycle:cpu.state.C};
      // A bit the host's tap latch presses and no finger holds stays pressed.
      p1=shaper.frame()&(ports[1]|~shaper.raw)&0xff;
      const result=cpu.run(until);
      if(session&&result?.status==='FRAMES_DONE'){
        // Drained when run returns: every read of this frame is in it.
        const changes=recorder.drain();
        for(const c of changes)tape.push(c);
        session.frameEnd(until,last.record,changes);
      }
      return {status:result?.status??null,frame:cpu.state.records.length,
        cycle:cpu.state.C};
    },
    message(m){
      if(m?.type==='net')session?.receive(m.m);
      else if(m?.type==='net-leave')session?.leave();
      else if(m?.type==='p1')shaper.push(m.value&0xff);
      else if(m?.type==='p1-repeat')
        shaper.setRepeat(INPUT_CONTROLS[P1_SHAPING.fire.control].bit,m.fire);
    },
    render:frame=>renderGngbRgba(rendererInputs(frame.record,
      {scroll:frame.scroll,latch:frame.latch},gfx)),
    checkpointPart(frame){
      // Runs inside cpu.run: a session's refusal waits for encodeCheckpoint,
      // whose errors become checkpoint-failed.
      if(session)return {frame,net:true};
      for(const c of recorder.drain())tape.push(c);
      return {frame,cpu:cpu.exportState(),tape:tape.map(c=>[...c])};
    },
    encodeCheckpoint:(part,audio)=>part.net?
      (()=>{const e=Error('NET_SESSION_NO_SAVE');e.code=e.message;throw e;})():
      encodeCheckpoint({programSha256,
      frame:part.frame,cpu:part.cpu,audio:audio.audio,ym:audio.ym,tape:part.tape,
      options}),
    probe:()=>({witness:witness.snapshot(),ports:[...ports],reads:[...readPorts],
      ram2:last?.record[2],ram5:last?.record[5],ram23:last?.record[0x23],gameState,
      net:session?.stats()??null}),
  };
}
startEngineWorker({config:GNG_WEB_HOST,createEngine:createGngEngine});
