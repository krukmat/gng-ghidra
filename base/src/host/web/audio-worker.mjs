/** Browser audio worker host. Batches of dated main-CPU events arrive from the
 * engine worker on a MessagePort; the integration's producer turns each one
 * into a mono Int16 PCM block. The producer runs from the engine's first
 * frame whether sound is on or off; PCM goes to the output port only while an
 * output session is open, so turning sound on never replays past audio.
 * Engine port: 'batch' -> 'ack'; 'restore' (before any batch) imports the
 * producer state; 'save' answers 'checkpoint' with the state after every
 * earlier batch, or 'checkpoint-failed'. Worker messages: 'ready', 'stats',
 * 'stop' (codes AUDIO_*). `load` resolves to {batch, exportState,
 * importState}; batch returns {firstSample, sampleRate, samples, stats}.
 */
export function startAudioWorker({load,scope=globalThis,statsFrames=60}){
  const post=m=>scope.postMessage(m);
  const safeCode=e=>/^AUDIO_[A-Z0-9_]{3,80}$/.test(e?.code??e?.message)?
    (e.code??e.message):'AUDIO_PRODUCER_UNEXPECTED_STOP';
  let stopped=false,producer=null,batches=0;
  let output=null,sessionId=null;
  let frames=0,produced=0,nonzero=0,sent=0,synthMs=0;

  const stop=e=>{
    if(stopped)return;
    stopped=true;
    post({type:'stop',code:safeCode(e),message:String(e?.message??e).slice(0,200)});
  };
  async function init(){
    const t0=performance.now();
    producer=await load();
    post({type:'ready',loadMs:Math.round(performance.now()-t0)});
  }
  function batch(engine,m){
    if(stopped)return;
    const t0=performance.now();
    batches++;
    const block=producer.batch(m.throughCycle,m.events);
    synthMs+=performance.now()-t0;
    const samples=block.samples;
    for(let i=0;i<samples.length;i++)if(samples[i])nonzero++;
    produced+=samples.length;frames++;
    if(output&&sessionId!==null&&samples.length){
      sent+=samples.length; // before the transfer empties the view
      output.postMessage({kind:'PCM',sessionId,firstSample:block.firstSample,
        sampleRate:block.sampleRate,samples},[samples.buffer]);
    }
    engine.postMessage({type:'ack',frame:m.frame});
    if(frames%statsFrames===0){
      post({type:'stats',frames,producedSamples:produced,nonzeroSamples:nonzero,
        sentSamples:sent,synthMsPerFrame:+(synthMs/statsFrames).toFixed(3),
        ...block.stats});
      synthMs=0;
    }
  }
  const initialized=init();
  let chain=initialized;
  initialized.catch(stop);
  scope.onmessage=({data})=>{
    if(data?.type==='engine'){
      const engine=data.port;
      engine.onmessage=({data:m})=>{
        if(m?.type==='batch')chain=chain.then(()=>batch(engine,m)).catch(stop);
        else if(m?.type==='restore')chain=chain.then(()=>{
          if(batches)throw Error('AUDIO_CK_RESTORE_LATE');
          producer.importState(m.state);
        }).catch(stop);
        else if(m?.type==='save')chain=chain.then(()=>{
          if(stopped)throw Error('AUDIO_CK_STOPPED');
          engine.postMessage({type:'checkpoint',state:producer.exportState()});
        }).catch(e=>{engine.postMessage({type:'checkpoint-failed'});stop(e);});
      };
    }else if(data?.type==='output'){
      // A new session replaces the port; null closes the output.
      output?.close();
      output=data.port??null;sessionId=data.sessionId??null;
    }
  };
}
