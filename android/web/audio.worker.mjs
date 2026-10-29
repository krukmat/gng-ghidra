/** AO-6 audio worker: MC6809 batches from the engine worker -> Z80 session ->
 * WASM dual YM2203 -> Int16 PCM at 62.5 kHz. It runs from the engine's first
 * frame whether Sound is ON or OFF; PCM goes to the AudioWorklet only while an
 * output session is open, so turning Sound on never replays past audio.
 * Checkpoint: 'restore' (before any batch) loads the saved Z80 and YM state;
 * 'save' answers on the engine port with the state after every earlier batch.
 */
const ROM_SHA1='7ef9ec5c2072e21c787a6bbf700033f50c759c1d';
const post=m=>postMessage(m);
const safeCode=e=>/^AUDIO_[A-Z0-9_]{3,80}$/.test(e?.code??e?.message)?
  (e.code??e.message):'AUDIO_PRODUCER_UNEXPECTED_STOP';
let stopped=false,source=null,ym=null,applyCommand=null,batches=0;
let output=null,sessionId=null;
let frames=0,produced=0,nonzero=0,sent=0,synthMs=0;

const stop=e=>{
  if(stopped)return;
  stopped=true;
  post({type:'stop',code:safeCode(e),message:String(e?.message??e).slice(0,200)});
};
async function bytes(name){
  const res=await fetch(name);
  if(!res.ok)throw Error('AUDIO_FETCH_'+res.status);
  return new Uint8Array(await res.arrayBuffer());
}
async function init(){
  const t0=performance.now();
  const [commands,{loadYm2203},rom,wasm]=await Promise.all([
    import('./lib/ao_audio_commands.mjs'),import('./lib/ao_ym2203_wasm.mjs'),
    bytes('audio/gg2.bin'),bytes('audio/ym2203.wasm')]);
  const sha1=[...new Uint8Array(await crypto.subtle.digest('SHA-1',rom))]
    .map(b=>b.toString(16).padStart(2,'0')).join('');
  if(rom.length!==0x8000||sha1!==ROM_SHA1)throw Error('AUDIO_ROM_INVALID');
  ym=(await loadYm2203(wasm)).create();
  source=await commands.createAudioCommandSource(rom);
  applyCommand=commands.applyCommand;
  post({type:'ready',loadMs:Math.round(performance.now()-t0)});
}
function batch(engine,m){
  if(stopped)return;
  const t0=performance.now();
  batches++;
  const {commands,stats}=source.batch(m.throughCycle,m.events);
  let block=null;
  for(const c of commands)block=applyCommand(ym,c)??block;
  synthMs+=performance.now()-t0;
  const samples=block.samples;
  for(let i=0;i<samples.length;i++)if(samples[i])nonzero++;
  produced+=samples.length;frames++;
  if(output&&sessionId!==null&&samples.length){
    sent+=samples.length; // before the transfer empties the view
    output.postMessage({kind:'PCM',sessionId,firstSample:block.firstSample,
      sampleRate:62500,samples},[samples.buffer]);
  }
  engine.postMessage({type:'ack',frame:m.frame});
  if(frames%60===0){
    post({type:'stats',frames,producedSamples:produced,nonzeroSamples:nonzero,
      sentSamples:sent,synthMsPerFrame:+(synthMs/60).toFixed(3),
      ymWrites:stats.ymWrites,commands:stats.mainCommands,
      resetTransitions:stats.resetTransitions});
    synthMs=0;
  }
}
const initialized=init();
let chain=initialized;
initialized.catch(stop);
onmessage=({data})=>{
  if(data?.type==='engine'){
    const engine=data.port;
    engine.onmessage=({data:m})=>{
      if(m?.type==='batch')chain=chain.then(()=>batch(engine,m)).catch(stop);
      else if(m?.type==='restore')chain=chain.then(()=>{
        if(batches)throw Error('AUDIO_CK_RESTORE_LATE');
        source.importState(m.audio);ym.load(m.ym);
      }).catch(stop);
      else if(m?.type==='save')chain=chain.then(()=>{
        if(stopped)throw Error('AUDIO_CK_STOPPED');
        engine.postMessage({type:'checkpoint',audio:source.exportState(),ym:ym.save()});
      }).catch(e=>{engine.postMessage({type:'checkpoint-failed'});stop(e);});
    };
  }else if(data?.type==='output'){
    // A new session replaces the port; null closes the output.
    output?.close();
    output=data.port??null;sessionId=data.sessionId??null;
  }
};
