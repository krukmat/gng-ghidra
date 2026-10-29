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
const CPU_HZ=1.5e6; // MC6809 E clock
const MAX_BEHIND=30; // frames; further behind re-anchors and counts a slip
const post=(msg,transfer=[])=>postMessage(msg,transfer);
const ports=new Uint8Array(5);
const SAMPLES_PER_FRAME=1048; // 25152 cycles x 8 ticks / 192 ticks per sample
const SAMPLE_MS=1000/62500;
// Queued source samples kept ahead of playback. Operator (28/10): 8 frames
// (134 ms, within the 200 ms capacity) after 5 frames lost audio on the phone.
const LEAD=8*SAMPLES_PER_FRAME;
const MAX_AUDIO_BACKLOG=120; // frames sent but not yet synthesized
const CLOCK_LOST_MS=250;
const START_WAIT_MS=1000; // a new output may take this long to start consuming
let audioPort=null,audioAcked=0,audioDead=false;
// Output clock: {sessionId, latency (samples), port, last:{sample,at}}.
let clock=null,fillLead=false;
let booted=false,saveWanted=false,saving=null;

onmessage=({data})=>{
  if(data?.type==='boot'&&!booted){booted=true;start(data.checkpoint??null).catch(fail);}
  else if(data?.type==='save')saveWanted=true;
  // AO-4 sends the five input port bytes (SYSTEM, P1, P2, DSW1, DSW2).
  if(data?.type==='ports'&&data.ports?.length===5)ports.set(data.ports);
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
    if(clock?.sessionId===data.sessionId)clock.latency=data.latencyMs/SAMPLE_MS;
  }else if(data?.type==='audio-clock'){
    clock?.port?.close();
    clock=data.sessionId==null?null:{sessionId:data.sessionId,
      latency:data.latencyMs/SAMPLE_MS,port:data.port,last:null,
      startFrame:null,openedAt:null};
    // A new output starts with the whole LEAD queued, not just the prebuffer.
    fillLead=clock!==null;
    if(clock)clock.port.onmessage=({data:m})=>{
      if(m?.type!=='clock'||m.sessionId!==clock?.sessionId)return;
      if(m.state==='PLAYING')clock.last={sample:m.sample,at:performance.now()};
      else clock.last=null;
    };
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
      if(audioFrames-audioAcked>MAX_AUDIO_BACKLOG)
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
        if(heard.length>40)heard.shift(); // ~670 ms: LEAD + output latency
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
    if(image.width!==256||image.height!==224||image.rgba.length!==256*224*4)
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

  const frameMs=CYCLES_PER_FRAME/CPU_HZ*1000;
  let done=restored?restored.frame:0,anchor=performance.now()-done*frameMs;
  let shown=0,slips=0,paced=false;
  let win={since:anchor,frames:0,rendered:0,cpuMs:0,renderMs:0,lateMs:0,audioFrames:0};
  // Source sample being consumed now, extrapolated from the last report.
  const consumed=now=>clock.last.sample+Math.min(now-clock.last.at,40)/SAMPLE_MS;
  const tick=()=>{
    const now=performance.now();
    if(clock?.last&&now-clock.last.at>CLOCK_LOST_MS){
      clock.last=null;post({type:'audio-clock-lost',frame:done});
    }
    let due,frame=latest;
    if(clock?.last&&!audioDead){
      const at=consumed(now);
      due=Math.min(done+MAX_BEHIND,Math.floor((at+LEAD)/SAMPLES_PER_FRAME));
      // Show the newest drawable frame whose audio is already audible.
      const audible=Math.floor((at-clock.latency)/SAMPLES_PER_FRAME)+1;
      frame=heard.findLast(f=>f.index<=audible)??null;
      paced=true;
    }else{
      // Back on the AO-2 clock, anchored at the current frame: no jump.
      if(paced){anchor=now-done*frameMs;paced=false;}
      if(fillLead){anchor-=LEAD/SAMPLES_PER_FRAME*frameMs;fillLead=false;}
      win.lateMs=Math.max(win.lateMs,now-(anchor+(done+1)*frameMs));
      due=Math.floor((now-anchor)/frameMs);
      if(due-done>MAX_BEHIND){anchor=now-done*frameMs;due=done+1;slips++;}
      // Until the new output plays, queue LEAD and no more: real-time frames
      // on top of it would overflow the 200 ms worklet capacity.
      if(clock&&!audioDead&&clock.openedAt===null){
        clock.startFrame=done;clock.openedAt=now;
      }
      if(clock&&!audioDead&&now-clock.openedAt<START_WAIT_MS)
        due=Math.min(due,clock.startFrame+LEAD/SAMPLES_PER_FRAME);
    }
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
      post({type:'stats',t:Math.round(c1-anchor),frames:done,slips,
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
    const wait=clock?.last&&!audioDead?
      Math.min(frameMs,((done+1)*SAMPLES_PER_FRAME-LEAD-consumed(performance.now()))*SAMPLE_MS):
      anchor+(done+1)*frameMs-performance.now();
    setTimeout(guarded,Math.max(0,wait));
  };
  const guarded=()=>{try{tick();}catch(e){fail(e);}};
  guarded();
}
const fail=e=>post({type:'error',message:String(e?.message??e),
  code:e?.code??null,stack:String(e?.stack??'').slice(0,2000)});
