/** AO-2 engine worker: the frozen AOT engine at real speed, without
 * SharedArrayBuffer. Each tick runs the frames that are due through the
 * board runtime (run(until)), then renders the newest fully known frame
 * and transfers its RGBA to the page. ?check=N runs N frames unpaced instead
 * and posts the SHA-256 of every rendered frame for the Node comparison.
 * AO-6: each frame's audio events go to the audio worker. While an output
 * session plays, the consumed source sample paces the CPU (LEAD ahead) and
 * the frame shown is the one being heard; otherwise the AO-2 clock rules.
 * Checkpoint (gng.checkpoint.v1, src/checkpoint_format.mjs): 'boot' carries
 * the saved text or null; a loaded session starts cold from that state, like
 * Reiniciar. 'save' exports the board at the next frame boundary, after that
 * frame's audio batch, and the audio worker adds Z80 and YM on the same port.
 */
import {createFramePacer} from './base/src/host/web/frame-pacer.mjs';
import {GNG_WEB_HOST} from './boards/gng/web-host-config.mjs';

const post=(msg,transfer=[])=>postMessage(msg,transfer);
const ports=new Uint8Array(GNG_WEB_HOST.inputPortCount);
const pacer=createFramePacer({...GNG_WEB_HOST,
  frameMs:GNG_WEB_HOST.cyclesPerFrame/GNG_WEB_HOST.cpuHz*1000});
let audioPort=null,audioAcked=0,audioDead=false;
let booted=false,saveWanted=false,saving=null;

onmessage=({data})=>{
  if(data?.type==='boot'&&!booted){booted=true;start(data.checkpoint??null).catch(fail);}
  else if(data?.type==='save')saveWanted=true;
  // AO-4 sends the five input port bytes (SYSTEM, P1, P2, DSW1, DSW2).
  if(data?.type==='ports'&&data.ports?.length===ports.length)ports.set(data.ports);
  // Test only (?audioTest): block this worker, as a slow phone frame would.
  else if(data?.type==='test-stall'&&new URLSearchParams(location.search).has('audioTest')){
    const end=performance.now()+Math.min(2000,data.ms);
    while(performance.now()<end);
  }else if(data?.type==='audio-port'){
    audioPort=data.port;
    audioPort.onmessage=({data:m})=>{
      if(m?.type==='ack')audioAcked=m.frame;
      else if(m?.type==='checkpoint'||m?.type==='checkpoint-failed')saved(m);
    };
  }else if(data?.type==='audio-latency'){
    pacer.latency(data.sessionId,data.latencyMs);
  }else if(data?.type==='audio-clock'){
    pacer.open(data);
  }
};
const audioStop=code=>{
  if(audioDead)return;
  audioDead=true;post({type:'audio-stop',code});
  if(saving){saving=null;post({type:'checkpoint-failed',code:'CK_AUDIO_STOPPED'});}
};
// The audio worker answers after the batch of the saved frame.
const saved=m=>{
  const s=saving;saving=null;
  if(!s)return;
  if(m.type==='checkpoint-failed')
    return post({type:'checkpoint-failed',code:'CK_AUDIO_STOPPED'});
  try{
    const text=s.encode({programSha256:s.programSha256,frame:s.frame,
      cpu:s.cpu,audio:m.audio,ym:m.ym,tape:s.tape});
    post({type:'checkpoint',frame:s.frame,text});
  }catch(e){post({type:'checkpoint-failed',code:e?.code??'CK_SAVE_FAILED'});}
};

async function bytes(name){
  const res=await fetch(name);
  if(!res.ok)throw Error('AO_FETCH_'+res.status+' '+name);
  return new Uint8Array(await res.arrayBuffer());
}
async function start(checkpointText){
  const t0=performance.now();
  const [{blocks},{createBoard,CYCLES_PER_FRAME},{mapGngFrozenBlocks},
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
  const inputCheck=new URLSearchParams(location.search).has('inputCheck');
  let last=null,latest=null,stateKey=null,gameState=null;
  let audioEvents=[],audioFrames=restored?restored.frame:0;
  const heard=[]; // newest drawable frames, for audio-paced presentation
  const cpu=createBoard(code,mapGngFrozenBlocks(code,blocks),{
    frames:Number.MAX_SAFE_INTEGER,
    portRead:addr=>ports[addr-0x3000],
    onPortRead:read=>{
      witness.observe(read);readPorts[read.addr-0x3000]=read.value;
      recorder.observe(read.addr,read.cycle,read.value);
    },
    onAudioEvent:e=>{
      if(!audioPort||audioDead)return;
      audioEvents.push({kind:e.kind,value:e.value,cycle:e.cycle});
      if(audioEvents.length>5000)audioStop('AUDIO_ENGINE_EVENT_OVERFLOW');
    },
    // One batch per completed frame, as in the live engine worker.
    onAudioComplete:mark=>{
      if(mark.frames<=audioFrames)return;
      audioFrames=mark.frames;
      if(saveWanted&&(!audioPort||audioDead)){
        saveWanted=false;post({type:'checkpoint-failed',code:'CK_AUDIO_STOPPED'});
      }
      if(!audioPort||audioDead)return;
      if(audioFrames-audioAcked>GNG_WEB_HOST.maxAudioBacklog)
        return audioStop('AUDIO_PRODUCER_BEHIND');
      audioPort.postMessage({type:'batch',frame:audioFrames,
        throughCycle:audioFrames*CYCLES_PER_FRAME,events:audioEvents});
      audioEvents=[];
      // Frame boundary, between instructions: the only valid save point.
      if(saveWanted&&!saving){
        saveWanted=false;
        for(const c of recorder.drain())tape.push(c);
        saving={encode:encodeCheckpoint,programSha256,frame:audioFrames,
          cpu:cpu.exportState(),tape:tape.map(c=>[...c])};
        audioPort.postMessage({type:'save'});
      }
    },
    onFrame:frame=>{
      last=frame;
      // Same rule as the live wrapper: never draw a frame with unknown bytes.
      if(rendererUnknownCount(frame)===0){
        latest=frame;heard.push(frame);
        if(heard.length>GNG_WEB_HOST.heardCapacity)heard.shift();
      }
      const state=observeGameState(frame);
      if(state){
        gameState=state;
        const key=JSON.stringify(state);
        if(key!==stateKey){
          stateKey=key;
          post({type:'game-state',...state});
        }
      }
      // Only the frame object is kept; the runtime never reads either log.
      cpu.state.records[frame.index-1]=null;
      cpu.state.events.length=0;
    }});
  if(restored){
    cpu.importState(restored.cpu);
    audioAcked=restored.frame;
    // Before any batch: Z80, queued events and both YM2203 of the save.
    audioPort?.postMessage({type:'restore',audio:restored.audio,ym:restored.ym});
  }
  const render=frame=>{
    const image=renderGngbRgba(rendererInputs(frame.record,
      {scroll:frame.scroll,latch:frame.latch},gfx));
    if(image.width!==GNG_WEB_HOST.width||image.height!==GNG_WEB_HOST.height||
       image.rgba.length!==image.width*image.height*4)
      throw Error('AO_RENDER_GEOMETRY');
    return image.rgba;
  };
  const step=until=>{
    const result=cpu.run(until);
    if(result?.status==='FRAMES_DONE')return true;
    post({type:'halt',status:result?.status??null,frame:cpu.state.records.length,
      cycle:cpu.state.C});
    return false;
  };
  post({type:'ready',loadMs:Math.round(performance.now()-t0),blocks:blocks.size});

  const check=Number(new URLSearchParams(location.search).get('check'));
  if(check>0){
    const hashes=[],c0=performance.now();
    for(let k=1;k<=check;k++){
      if(!step(k))return;
      if(latest!==last){hashes.push(null);continue;}
      const digest=await crypto.subtle.digest('SHA-256',render(latest));
      hashes.push([...new Uint8Array(digest)]
        .map(b=>b.toString(16).padStart(2,'0')).join(''));
    }
    post({type:'check',frames:check,ms:Math.round(performance.now()-c0),hashes});
    return;
  }

  let done=restored?restored.frame:0;
  pacer.reset(done,performance.now());
  let shown=0;
  let win={since:pacer.anchor,frames:0,rendered:0,cpuMs:0,renderMs:0,
    lateMs:0,audioFrames:0};
  const tick=()=>{
    const now=performance.now();
    const {due,frame,paced,clockLost,lateMs}=pacer.select(
      now,done,latest,heard,audioDead);
    if(clockLost)post({type:'audio-clock-lost',frame:done});
    if(lateMs!==null)win.lateMs=Math.max(win.lateMs,lateMs);
    const c0=performance.now();
    for(;done<due;done++){
      if(!step(done+1))return;
      win.frames++;if(paced)win.audioFrames++;
    }
    const c1=performance.now();
    win.cpuMs+=c1-c0;
    if(frame&&frame.index!==shown){
      // A fresh buffer per render: transferred, never copied.
      const rgba=render(frame);
      post({type:'frame',index:frame.index,rgba:rgba.buffer},[rgba.buffer]);
      shown=frame.index;win.rendered++;
      win.renderMs+=performance.now()-c1;
    }
    if(c1-win.since>=1000){
      post({type:'stats',t:Math.round(c1-pacer.anchor),frames:done,slips:pacer.slips,
        audioPaced:win.audioFrames,audioBacklog:audioFrames-audioAcked,
        windowMs:Math.round(c1-win.since),windowFrames:win.frames,
        rendered:win.rendered,cpuMs:+win.cpuMs.toFixed(2),
        renderMs:+win.renderMs.toFixed(2),lateMs:+win.lateMs.toFixed(2)});
      // Test-only observation of real CPU snapshots, never a state write.
      if(inputCheck)post({type:'input-probe',frame:done,
        witness:witness.snapshot(),ports:[...ports],reads:[...readPorts],
        ram2:last?.record[2],ram5:last?.record[5],ram23:last?.record[0x23],gameState});
      win={since:c1,frames:0,rendered:0,cpuMs:0,renderMs:0,lateMs:0,audioFrames:0};
    }
    const wait=pacer.wait(performance.now(),done,audioDead);
    setTimeout(guarded,Math.max(0,wait));
  };
  const guarded=()=>{try{tick();}catch(e){fail(e);}};
  guarded();
}
const fail=e=>post({type:'error',message:String(e?.message??e),
  code:e?.code??null,stack:String(e?.stack??'').slice(0,2000)});
