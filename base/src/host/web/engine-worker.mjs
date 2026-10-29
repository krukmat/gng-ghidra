/** Browser engine worker host: an integration's engine at real speed, without
 * SharedArrayBuffer. Each tick runs the due frames, then posts the selected
 * drawable frame as transferred RGBA. ?check=N runs N frames unpaced and
 * posts the SHA-256 of each newest drawable frame instead. Each completed
 * frame's sound events go to the audio worker as one batch; while an output
 * session plays, the consumed source sample paces the CPU (frame-pacer.mjs)
 * and the frame shown is the one being heard. A save is taken at the next
 * frame boundary, after that frame's batch; the audio worker adds its state
 * on the same port and the integration encodes the checkpoint text.
 *
 * `config`: cpuHz, cyclesPerFrame, width, height, inputPortCount,
 * maxAudioBacklog, maxAudioEvents, heardCapacity and the pacer fields.
 * `createEngine({checkpoint, ports, sink})` loads the program and resolves to
 * {resumeFrame, audioState, ready, step(frame), render(frame),
 * checkpointPart(frame), encodeCheckpoint(part, audioState), probe()}; it
 * reports through sink.audioEvent(e), sink.audioFrame(frames),
 * sink.frame(frame, drawable) and sink.observe(state).
 */
import {createFramePacer} from './frame-pacer.mjs';

export function startEngineWorker({config,createEngine,scope=globalThis,
  params=new URLSearchParams(scope.location?.search??'')}){
  const post=(msg,transfer=[])=>scope.postMessage(msg,transfer);
  const ports=new Uint8Array(config.inputPortCount);
  const pacer=createFramePacer({...config,
    frameMs:config.cyclesPerFrame/config.cpuHz*1000});
  let audioPort=null,audioAcked=0,audioDead=false;
  let booted=false,saveWanted=false,saving=null,engine=null;

  const fail=e=>post({type:'error',message:String(e?.message??e),
    code:e?.code??null,stack:String(e?.stack??'').slice(0,2000)});
  scope.onmessage=({data})=>{
    if(data?.type==='boot'&&!booted){booted=true;start(data.checkpoint??null).catch(fail);}
    else if(data?.type==='save')saveWanted=true;
    else if(data?.type==='ports'&&data.ports?.length===ports.length)ports.set(data.ports);
    // Test only (?audioTest): block this worker, as a slow phone frame would.
    else if(data?.type==='test-stall'&&params.has('audioTest')){
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
      post({type:'checkpoint',frame:s.frame,
        text:engine.encodeCheckpoint(s.part,m.state)});
    }catch(e){post({type:'checkpoint-failed',code:e?.code??'CK_SAVE_FAILED'});}
  };

  async function start(checkpoint){
    const t0=performance.now();
    let last=null,latest=null,audioEvents=[],audioFrames=0;
    const heard=[]; // newest drawable frames, for audio-paced presentation
    const sink={
      audioEvent:e=>{
        if(!audioPort||audioDead)return;
        audioEvents.push({kind:e.kind,value:e.value,cycle:e.cycle});
        if(audioEvents.length>config.maxAudioEvents)
          audioStop('AUDIO_ENGINE_EVENT_OVERFLOW');
      },
      // One batch per completed frame.
      audioFrame:frames=>{
        if(frames<=audioFrames)return;
        audioFrames=frames;
        if(saveWanted&&(!audioPort||audioDead)){
          saveWanted=false;post({type:'checkpoint-failed',code:'CK_AUDIO_STOPPED'});
        }
        if(!audioPort||audioDead)return;
        if(audioFrames-audioAcked>config.maxAudioBacklog)
          return audioStop('AUDIO_PRODUCER_BEHIND');
        audioPort.postMessage({type:'batch',frame:audioFrames,
          throughCycle:audioFrames*config.cyclesPerFrame,events:audioEvents});
        audioEvents=[];
        // Frame boundary, between instructions: the only valid save point.
        if(saveWanted&&!saving){
          saveWanted=false;
          saving={frame:audioFrames,part:engine.checkpointPart(audioFrames)};
          audioPort.postMessage({type:'save'});
        }
      },
      frame:(frame,drawable)=>{
        last=frame;
        if(drawable){
          latest=frame;heard.push(frame);
          if(heard.length>config.heardCapacity)heard.shift();
        }
      },
      observe:state=>post({type:'game-state',...state}),
    };
    engine=await createEngine({checkpoint,ports,sink});
    audioFrames=engine.resumeFrame;
    if(engine.audioState){
      audioAcked=engine.resumeFrame;
      // Before any batch: the producer state saved with the checkpoint.
      audioPort?.postMessage({type:'restore',state:engine.audioState});
    }
    const render=frame=>{
      const image=engine.render(frame);
      if(image.width!==config.width||image.height!==config.height||
         image.rgba.length!==image.width*image.height*4)
        throw Error('HOST_RENDER_GEOMETRY');
      return image.rgba;
    };
    const step=until=>{
      const result=engine.step(until);
      if(result?.status==='FRAMES_DONE')return true;
      post({type:'halt',status:result?.status??null,frame:result?.frame??null,
        cycle:result?.cycle??null});
      return false;
    };
    post({type:'ready',loadMs:Math.round(performance.now()-t0),...engine.ready});

    const check=Number(params.get('check'));
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

    const inputCheck=params.has('inputCheck');
    let done=engine.resumeFrame;
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
        // Test-only observation of the integration, never a state write.
        if(inputCheck)post({type:'input-probe',frame:done,...engine.probe()});
        win={since:c1,frames:0,rendered:0,cpuMs:0,renderMs:0,lateMs:0,audioFrames:0};
      }
      const wait=pacer.wait(performance.now(),done,audioDead);
      setTimeout(guarded,Math.max(0,wait));
    };
    const guarded=()=>{try{tick();}catch(e){fail(e);}};
    guarded();
  }
}
