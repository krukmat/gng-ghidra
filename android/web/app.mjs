/** Offline display and multitouch controls. No keyboard listeners. */
import {createTouchControls,isDirection} from './lib/ao_touch_controls.mjs';

const canvas=document.getElementById('screen');
const ctx2d=canvas.getContext('2d',{alpha:false});
const status=document.getElementById('status');
const hint=document.getElementById('hint');
const halt=document.getElementById('halt');
const systemControls=document.getElementById('system-controls');
const startButton=document.getElementById('start');
const buttons=[...document.querySelectorAll('[data-hold],[data-pulse]')];
const soundButton=document.getElementById('sound');
const log=(tag,data)=>console.log(tag+' '+JSON.stringify(data));
let worker=null,pending=null,drawn=0,playable=false;
// AO-6 sound: the producer runs from boot; output sessions come and go.
let audioWorker=null,audioReady=false,audioDead=null,producerStats=null;
let ctx=null,node=null,gain=null,soundOn=false,session=null,sessionSeq=0;
let worklet=null,audioNote='',av=[],latencyMs=0;
const AUDIO_SAMPLES_PER_FRAME=1048;
let game={credits:0,readyToStart:false,inGame:false};
const fingers=new Map();
const controls=createTouchControls((ports,held)=>{
  worker?.postMessage({type:'ports',ports});
  for(const button of buttons){
    const active=held.includes(button.dataset.hold??button.dataset.pulse);
    button.classList.toggle('held',active);
    button.setAttribute('aria-pressed',String(active));
  }
});
function enable(value){
  playable=value;controls.setEnabled(value);
  for(const button of buttons)button.disabled=!value||
    (button.dataset.pulse&&game.inGame)||
    (button.dataset.pulse==='start1'&&!game.readyToStart);
}
function updateHint(){
  systemControls.hidden=game.inGame;
  hint.hidden=game.inGame;
  startButton.textContent=game.canContinue?'Continuar':'Start';
  hint.textContent=!playable?'Cargando el juego…':game.inGame?
    'Tocá y mantené los controles':game.readyToStart?
    (game.canContinue?'2 · Continuar':'2 · Start'):
    game.credits>0?'Moneda lista · un momento…':'1 · Moneda     2 · Start';
}
function stop(message){
  enable(false);fingers.clear();halt.textContent=message;halt.hidden=false;
  hint.hidden=false;
  hint.textContent='Tocá Reiniciar para volver a empezar.';
}
function updateSound(){
  const usable=audioReady&&!audioDead&&typeof AudioWorkletNode==='function';
  soundButton.disabled=!usable;
  soundButton.textContent=soundOn&&ctx?.state==='running'?'Sonido ON':'Sonido OFF';
  soundButton.setAttribute('aria-pressed',String(soundOn));
  soundButton.title=audioDead??(usable?'':'Preparando el sonido…');
}
function audioStop(code,extra={}){
  log('AO_AUDIO_STOP',{code,...extra});
  if(gain)gain.gain.value=0;
  closeSession();soundOn=false;audioNote='audio: '+code;updateSound();
}
// One output session: worklet, producer and engine clock share its id.
function openSession(){
  const id=++sessionSeq,pcm=new MessageChannel(),tick=new MessageChannel();
  latencyMs=((ctx.outputLatency||ctx.baseLatency||0)*1000)+16;
  node.port.postMessage({kind:'RESET',sessionId:id,pcm:pcm.port1,clock:tick.port1},
    [pcm.port1,tick.port1]);
  audioWorker.postMessage({type:'output',sessionId:id,port:pcm.port2},[pcm.port2]);
  worker.postMessage({type:'audio-clock',sessionId:id,latencyMs,port:tick.port2},
    [tick.port2]);
  session=id;worklet=null;av=[];
  log('AO_AUDIO_SESSION',{sessionId:id,sampleRate:ctx.sampleRate,latencyMs});
}
function closeSession(){
  if(session===null)return;
  session=null;worklet=null;
  node?.port.postMessage({kind:'RESET',sessionId:null});
  audioWorker?.postMessage({type:'output',sessionId:null});
  worker?.postMessage({type:'audio-clock',sessionId:null});
}
async function toggleSound(){
  if(soundOn){soundOn=false;gain.gain.value=0;updateSound();return;}
  try{
    // Created and resumed inside the tap: Android requires the gesture.
    if(!ctx){
      ctx=new AudioContext({latencyHint:'interactive'});
      const resumed=ctx.resume();
      await ctx.audioWorklet.addModule('audio.worklet.mjs');
      node=new AudioWorkletNode(ctx,'ao-pcm-sink',{numberOfInputs:0,
        numberOfOutputs:1,outputChannelCount:[1]});
      gain=ctx.createGain();gain.gain.value=0;
      node.connect(gain).connect(ctx.destination);
      node.port.onmessage=({data})=>{
        if(data?.kind==='STATS'){
          worklet={...data,at:performance.now()};
        }else if(data?.kind==='STOP')audioStop(data.code,data);
      };
      await resumed;
    }else await ctx.resume();
    if(ctx.state!=='running')throw Error('AUDIO_CONTEXT_NOT_RUNNING');
    if(session===null)openSession();
    soundOn=true;audioNote='';gain.gain.value=1;
  }catch(e){
    audioStop(/^AUDIO_/.test(e?.message)?e.message:'AUDIO_CONTEXT_FAILED',
      {message:String(e?.message??e).slice(0,200)});
  }
  updateSound();
}
// Video vs audible audio, in ms (positive: picture ahead of sound).
function measureAv(index){
  if(!worklet||worklet.state!=='PLAYING'||worklet.sessionId!==session)return;
  const ts=ctx.getOutputTimestamp?.();
  const heardAt=ts?.contextTime>0?
    ts.contextTime+(performance.now()-ts.performanceTime)/1000:
    ctx.currentTime-(ctx.outputLatency||ctx.baseLatency||0);
  const sample=worklet.lastInputSample+(heardAt-worklet.endTime)*62500;
  av.push(((index-0.5)*AUDIO_SAMPLES_PER_FRAME-sample)/62.5);
}
function audioStats(){
  if(!audioWorker)return;
  const avMs=av.length?{mean:+(av.reduce((a,b)=>a+b,0)/av.length).toFixed(1),
    maxAbs:+Math.max(...av.map(Math.abs)).toFixed(1),n:av.length}:null;
  log('AO_AUDIO_STATS',{t:Math.round(performance.now()),sound:soundOn,
    context:ctx?.state??null,sessionId:session,gain:gain?.gain.value??null,
    worklet:worklet&&{state:worklet.state,queued:worklet.queuedSourceSamples,
      missing:worklet.missingOutputSamples,stale:worklet.stale,
      outputNonzero:worklet.outputNonzero,sample:worklet.lastInputSample},
    producer:producerStats,avMs,latencyMs:Math.round(latencyMs),dead:audioDead});
  av=[];
  // Closed loop: the reported output latency can be far from what
  // getOutputTimestamp says is heard; the engine shows frames that much later.
  if(avMs&&session!==null&&Math.abs(avMs.mean)>5){
    latencyMs=Math.min(500,Math.max(0,latencyMs+0.7*avMs.mean));
    worker.postMessage({type:'audio-latency',sessionId:session,latencyMs});
  }
}
function startAudio(){
  audioWorker?.terminate();
  audioReady=false;audioDead=null;producerStats=null;updateSound();
  audioWorker=new Worker(new URL('audio.worker.mjs',import.meta.url),{type:'module'});
  const link=new MessageChannel();
  worker.postMessage({type:'audio-port',port:link.port1},[link.port1]);
  audioWorker.postMessage({type:'engine',port:link.port2},[link.port2]);
  audioWorker.onmessage=({data})=>{
    if(data?.type==='ready'){
      audioReady=true;log('AO_AUDIO_READY',data);updateSound();
    }else if(data?.type==='stats')producerStats=data;
    else if(data?.type==='stop'){
      audioDead=data.code;audioStop(data.code,{message:data.message});
    }
  };
  audioWorker.onerror=e=>{
    audioDead='AUDIO_WORKER_ERROR';audioStop(audioDead,{message:e.message});
  };
}
function start(){
  enable(false);fingers.clear();closeSession();worker?.terminate();
  game={credits:0,readyToStart:false,inGame:false};
  pending=null;drawn=0;ctx2d.clearRect(0,0,256,224);halt.hidden=true;
  updateHint();status.textContent='cargando…';
  worker=new Worker(new URL('engine.worker.mjs'+location.search,import.meta.url),
    {type:'module'});
  // Reiniciar rebuilds the Z80 session and the chips with the engine.
  startAudio();
  if(soundOn)openSession();
  worker.onmessage=({data})=>{
    switch(data?.type){
      case 'frame':
        pending=data;
        if(!playable){enable(true);updateHint();}
        break;
      case 'stats':
        log('AO_STATS',{...data,drawn});
        status.textContent=Math.round(drawn*1000/data.windowMs)+' fps'+
          (audioNote?' · '+audioNote:'');
        drawn=0;audioStats();break;
      case 'audio-stop':audioDead=data.code;audioStop(data.code);break;
      case 'audio-clock-lost':log('AO_AUDIO_CLOCK_LOST',data);break;
      case 'ready':log('AO_READY',data);break;
      case 'game-state':
        game=data;enable(playable);updateHint();break;
      case 'check':log('AO_CHECK',data);status.textContent='check '+data.frames;break;
      case 'input-probe':log('AO_INPUT',data);break;
      case 'halt':log('AO_HALT',data);stop('Motor detenido: '+data.status);break;
      case 'error':log('AO_ERROR',data);stop('Error: '+data.message);break;
    }
  };
  worker.onerror=e=>{
    log('AO_ERROR',{message:e.message,filename:e.filename,lineno:e.lineno});
    stop('Error: '+e.message);
  };
}

document.getElementById('layout').addEventListener('pointerdown',e=>{
  const button=e.target.closest('[data-hold],[data-pulse]');
  if(!button||button.disabled||e.button!==0)return;
  e.preventDefault();
  if(button.dataset.pulse){
    controls.pulse(button.dataset.pulse==='start1'&&game.canContinue?
      'continue1':button.dataset.pulse);
    return;
  }
  fingers.set(e.pointerId,isDirection(button.dataset.hold));
  button.setPointerCapture(e.pointerId);
  controls.hold(e.pointerId,button.dataset.hold);
});
document.addEventListener('pointermove',e=>{
  if(!fingers.get(e.pointerId))return;
  const key=document.elementFromPoint(e.clientX,e.clientY)
    ?.closest('[data-hold]')?.dataset.hold;
  if(isDirection(key))controls.hold(e.pointerId,key);
  else controls.release(e.pointerId);
});
const release=e=>{fingers.delete(e.pointerId);controls.release(e.pointerId);};
for(const event of ['pointerup','pointercancel','lostpointercapture'])
  document.addEventListener(event,release);
const releaseAll=()=>{fingers.clear();controls.releaseAll();};
window.addEventListener('blur',releaseAll);
window.addEventListener('pagehide',releaseAll);
document.addEventListener('visibilitychange',()=>{
  if(document.hidden){
    releaseAll();
    // Background: drop the queue and stop output; the game keeps the AO-2 clock.
    if(ctx){closeSession();ctx.suspend();}
  }else if(soundOn&&ctx){
    // Back: a fresh session prebuffers the current state, never old PCM.
    ctx.resume().then(()=>{if(soundOn&&session===null)openSession();updateSound();},
      e=>audioStop('AUDIO_CONTEXT_FAILED',{message:String(e)}));
  }
});
document.addEventListener('contextmenu',e=>e.preventDefault());
document.getElementById('restart').addEventListener('click',start);
soundButton.addEventListener('click',toggleSound);
function draw(){
  if(pending){
    ctx2d.putImageData(new ImageData(new Uint8ClampedArray(pending.rgba),256,224),0,0);
    if(session!==null)measureAv(pending.index);
    pending=null;drawn++;
  }
  requestAnimationFrame(draw);
}
start();requestAnimationFrame(draw);
