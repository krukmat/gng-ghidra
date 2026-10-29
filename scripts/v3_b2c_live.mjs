#!/usr/bin/env node
/** GnG's *real* live AOT engine, served only on loopback.
 * Not a capture player, fake scene or MAME emulator.
 * HTTP and keyboard events run on main Node thread, CPU on worker thread.
 */
import {createServer} from 'node:http';
import {Worker} from 'node:worker_threads';
import {performance} from 'node:perf_hooks';
import {resolve,join} from 'node:path';
import {existsSync,readFileSync,writeFileSync,mkdirSync,renameSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createLiveControls} from '../src/v3_b2c_live_controls.mjs';
import {LIVE_FRAMES} from '../src/v3_b2c_session_policy.mjs';
import {loadFrozen} from '../src/v2_b1_frozen.mjs';
import {b2dCertified} from '../src/v3_b2d_selection.mjs';
import {b2eCertified} from '../src/v3_b2e_selection.mjs';
import {selectB3Bundle} from '../src/v3_b3_bundle.mjs';
import {prepareAudioBundle} from '../src/gngb_audio_bundle_overlay.mjs';
import {createVisibleFrameGate} from '../src/v3_b2c_visible_gate.mjs';
import {LIVE_TAPE_SCHEMA} from '../src/v3_b3_live_tape.mjs';
import {checkpointRuntime} from '../src/checkpoint_runtime.mjs';
import {encodeCheckpoint,decodeCheckpoint,ymFirstSample} from '../src/checkpoint_format.mjs';

const ROOT=resolve(fileURLToPath(import.meta.url),'../..');
// Use the offline-discovered gameplay bundle when available. Otherwise
// run the verified B2A Coin1 build; missing AOT blocks stop the CPU.
const B2E=join(ROOT,'out/v3/b2e/frozen');
const B2E_REPORT=join(ROOT,'out/v3/b2e/discovery-report.json');
const B2D=join(ROOT,'out/v3/b2d/frozen');
const B2D_REPORT=join(ROOT,'out/v3/b2d/discovery-report.json');
const B2B=join(ROOT,'out/v3/b2b/frozen');
const B2A=join(ROOT,'out/v3/b2a/frozen');
const B2A_PROOF=join(ROOT,'out/v3/b2a/coin-smoke.json');
const B2B_REPORT=join(ROOT,'out/v3/b2b/discovery-report.json');
function b2bReady(){
  if(!existsSync(B2B)||!existsSync(B2B_REPORT))return false;
  try{
    const r=JSON.parse(readFileSync(B2B_REPORT,'utf8'));
    return r.status==='DISCOVERY_COMPLETE'&&
      r.no_input==='PASS_600_FRAMES_IDENTICAL_V2'&&
      r.frozen_determinism==='PASS_TWO_FROZEN_1000_FRAME_RUNS'&&
      Number.isInteger(r.first_start_effect_frame)&&
      r.first_start_effect_frame>=530&&
      r.comparison_read_counts?.controls?.coin>0&&
      r.comparison_read_counts?.controls?.start>0;
  }catch{return false;}
}
function b2dReady(){
  if(!existsSync(B2D)||!existsSync(B2D_REPORT))return false;
  try{
    const report=JSON.parse(readFileSync(B2D_REPORT,'utf8'));
    const {manifest}=loadFrozen(B2D); // validates EVERY AOT asset SHA-256
    return b2dCertified(report,manifest);
  }catch{return false}
}
function b2eReady(){
  if(!existsSync(B2E)||!existsSync(B2E_REPORT)||!b2dReady())return false;
  try{
    const report=JSON.parse(readFileSync(B2E_REPORT,'utf8'));
    const {manifest}=loadFrozen(B2E);
    const {manifest:parent}=loadFrozen(B2D);
    return b2eCertified(report,manifest,parent);
  }catch{return false;}
}
// Newest certified B3 generation (playable Coin/Start/Arthur routes)
// outranks idle-only B2E; it is only considered on a certified B2-D.
const B3_SELECTED=b2dReady()?selectB3Bundle(ROOT):null;
const B3=B3_SELECTED?.dir;
const BUNDLE=B3??(b2eReady()?B2E:b2dReady()?B2D:b2bReady()?B2B:B2A);
const ZIP=join(ROOT,'roms/gng.zip');
const PORT=18609;
const live=createLiveControls();
const {inputs,apply:applyControl,release:releaseAll,snapshot:heldControls}=live;
// 600 frames is the B2A *certification* horizon, not a live session.
// A bounded LIVE_FRAMES session (~10 min); the worker drops each frame
// snapshot after delivery, so record history no longer grows in RAM. Reset is a
// genuine cold restart of that engine, never a playback or state injection.
const SESSION_FRAMES=LIVE_FRAMES;
let advance=null,worker=null,generation=0,operatorGate=null;
// A real Coin press that arrives after /reset but before the new AOT
// worker reaches its first known VBlank cannot release a gate that
// has nothing paused yet (shouldAdvance has not run for this session).
// Remember that intent and let the very first shouldAdvance honor it,
// instead of silently discarding a credit the operator actually paid.
let earlyCoinPending=false;
let activeBundle=BUNDLE,audioWorker=null,audioPackets=[],audioQueued=0;
let pacingOrigin=null;
let audioActive=false,audioStop=null,audioNextSample=0,audioDelivered=0;
let audioPendingBatches=0;
let audioNonzero=0;
let audioStats=null,workletStats=null,audioDroppedBeforeStart=0;
let frame=null,latest=0,known=false,cycle=0,unknownBytes=null,source=null;
let pixelProbe=null,displayedServerFrame=0;
let lastGood=0,blocks=0,halt=null;
let reads={all:0,coin:0,start:0,p1:0},busWitness=null;
// Exact port values the CPU read this session (replayable offline).
let portChanges=[],checkFrame=null;
const PROGRAM_SHA256=loadFrozen(BUNDLE).manifest.files['program.mjs'];
// One quick-save checkpoint, private (RAM holds copies of ROM code).
const CHECKPOINT=join(ROOT,'out/web-checkpoint/quick.json');
let saveRequest=null,pendingSave=null;
const checkpointInfo=()=>{
  if(!existsSync(CHECKPOINT))return {exists:false};
  try{
    const c=decodeCheckpoint(readFileSync(CHECKPOINT,'utf8'),
      {programSha256:PROGRAM_SHA256});
    return {exists:true,frame:c.frame,savedAt:c.savedAt};
  }catch(e){return {exists:true,invalid:e.code??'CK_FORMAT_INVALID'};}
};
const writeCheckpoint=text=>{
  mkdirSync(join(ROOT,'out/web-checkpoint'),{recursive:true,mode:0o700});
  const temp=CHECKPOINT+'.tmp';
  writeFileSync(temp,text,{mode:0o600});
  renameSync(temp,CHECKPOINT);
};
const liveTape=()=>({schema:LIVE_TAPE_SCHEMA,bundle:BUNDLE,
  generation:B3_SELECTED?.generation??null,program_sha256:PROGRAM_SHA256,
  session:generation,frame:latest,check:checkFrame,halt,changes:portChanges});
const saveLiveTape=()=>{
  const dir=join(ROOT,'out/v3/b3/live-tapes');
  mkdirSync(dir,{recursive:true,mode:0o700});
  const file=join(dir,new Date().toISOString().replace(/[:.]/g,'-')+'-'+
    String(halt?.status??halt?.code??'RUNNING')+'.json');
  writeFileSync(file,JSON.stringify(liveTape())+'\n',{mode:0o600});
  return file;
};
const state=()=>({schema:'gng.v3.live-engine.v1',mode:'REAL_AOT',
  frame:latest,lastRenderedFrame:lastGood,frameKnown:known,
  unknownBytes,cycle,blocks,reads,busWitness,pixelProbe,
  deliveredFrame:displayedServerFrame,source,halt,controls:heldControls(),
  sessionFrames:SESSION_FRAMES,sessionId:generation,
  operatorPause:operatorGate?.snapshot().paused??false,
  audio:{active:audioActive,stop:audioStop,queuedSamples:audioQueued,
    pendingBatches:audioPendingBatches,
    producedSamples:audioNextSample,deliveredSamples:audioDelivered,
    nonzeroSamples:audioNonzero,
    droppedBeforeStart:audioDroppedBeforeStart,producer:audioStats,
    worklet:workletStats}});
const html=`<!doctype html><html lang="es"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Ghosts 'n Goblins — Motor MC6809 AOT real</title>
<style>
:root{background:#0d131e;color:#e8ecf3;font:15px system-ui;
--ok:#3ecf6e;--warn:#e8b339;--bad:#e8544f;--idle:#7d8aa0}
*{box-sizing:border-box}
body{margin:0}
main{max-width:860px;margin:20px auto 40px;padding:0 16px}
h1{font-size:1.15rem;font-weight:600;margin:0 0 12px}
.topbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;
margin-bottom:10px}
.dot{width:10px;height:10px;border-radius:50%;background:var(--idle);
flex:none;box-shadow:0 0 0 3px color-mix(in srgb,var(--idle) 25%,transparent)}
.dot.running{background:var(--ok);
box-shadow:0 0 0 3px color-mix(in srgb,var(--ok) 25%,transparent)}
.dot.paused{background:var(--warn);
box-shadow:0 0 0 3px color-mix(in srgb,var(--warn) 25%,transparent)}
.dot.halted{background:var(--bad);
box-shadow:0 0 0 3px color-mix(in srgb,var(--bad) 25%,transparent)}
#status{margin:0;font-size:.95rem}
.screen-wrap{position:relative;width:min(100%,768px);margin:0 auto}
canvas{display:block;width:100%;aspect-ratio:256/224;image-rendering:pixelated;
background:#050505;border:1px solid #657087;border-radius:4px}
.screen-wrap:fullscreen canvas,.screen-wrap:fullscreen{width:100%;height:100%;
max-width:none;border-radius:0}
.overlay{position:absolute;inset:0;display:none;flex-direction:column;
align-items:center;justify-content:center;gap:12px;text-align:center;
background:rgba(5,8,14,.82);border-radius:4px;padding:16px}
.overlay.show{display:flex}
.overlay.halt{background:rgba(40,8,8,.88)}
.overlay p{margin:0;max-width:420px;font-size:.95rem}
.overlay .row{display:flex;gap:10px;flex-wrap:wrap;justify-content:center}
button{font:inherit;color:inherit;background:#1b2434;border:1px solid #3a4760;
border-radius:5px;padding:7px 14px;cursor:pointer}
button:hover:not(:disabled){background:#243049}
button:disabled{opacity:.45;cursor:default}
button.primary{background:#2c5f3f;border-color:#3f8a5a}
button.primary:hover:not(:disabled){background:#357149}
button.danger{background:#5f2c2c;border-color:#8a3f3f}
button.danger:hover:not(:disabled){background:#712f2f}
button.ghost{background:transparent}
.controls{display:flex;align-items:center;justify-content:space-between;
flex-wrap:wrap;gap:10px;margin-top:12px;padding:10px 12px;background:#141c2b;
border:1px solid #27324a;border-radius:6px}
.group{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.group-label{font-size:.72rem;text-transform:uppercase;letter-spacing:.05em;
color:#7d8aa0;margin-right:2px}
.keys{display:flex;gap:10px;align-items:center;flex-wrap:wrap;
margin-top:8px;padding:8px 12px;background:#141c2b;border:1px solid #27324a;
border-radius:6px;font-size:.85rem;color:#aeb9ca}
kbd{background:#333e51;color:#e8ecf3;padding:2px 7px;border-radius:3px;
font:12px ui-monospace,monospace;border:1px solid #4a5870;transition:.08s}
kbd.held{background:#2d5fb3;border-color:#5b8de0}
kbd.read{background:var(--ok);color:#06220f;border-color:var(--ok)}
.legend{font-size:.72rem;color:#7d8aa0;margin-left:auto}
#audio-health,#ck-info{font-size:.85rem;color:#aeb9ca}
details{margin-top:12px}
summary{cursor:pointer;font-size:.85rem;color:#aeb9ca;padding:4px 0}
.diag{display:grid;gap:4px;margin-top:8px;font-size:.85rem;color:#c3cbda}
pre{font:12px ui-monospace,monospace;overflow-wrap:anywhere;
white-space:pre-wrap;background:#0a0f18;border:1px solid #27324a;
border-radius:5px;padding:8px;margin:8px 0 0}
footer{color:#7d8aa0;font-size:.8rem;margin-top:16px;line-height:1.4}
</style></head><body><main>
<h1>Ghosts 'n Goblins — Motor MC6809 recompilado a JavaScript</h1>
<div class="topbar">
<span class="dot" id="status-dot"></span>
<p id="status" role="status" aria-live="polite">Conectando con el motor real…</p>
</div>
<div class="screen-wrap" id="screen-wrap">
<canvas id="screen" width="256" height="224"></canvas>
<div class="overlay" id="pause-overlay">
<p id="interaction-window">Al aparecer el primer fotograma, el motor espera la moneda (CPU pausada en VBlank real).</p>
<div class="row">
<button id="coin" type="button" class="primary">Insertar moneda <kbd>5</kbd></button>
<button id="continue" type="button">Continuar sin moneda</button>
</div>
</div>
<div class="overlay halt" id="halt-overlay">
<p id="halt-message"></p>
<button id="restart-overlay" type="button" class="danger">Reiniciar motor</button>
</div>
</div>
<div class="controls">
<div class="group">
<span class="group-label">Juego</span>
<button id="coin-bar" type="button">Moneda <kbd>5</kbd></button>
<button id="start" type="button">Start 1P <kbd>1</kbd></button>
</div>
<div class="group">
<span class="group-label">Sistema</span>
<button id="audio-enable" type="button">Activar audio</button>
<button id="fullscreen" type="button" class="ghost" title="Pantalla completa">⛶</button>
<button id="scale" type="button" class="ghost" title="Cambiar escala">×3</button>
</div>
<div class="group">
<button id="ck-save" type="button" title="Guardar checkpoint">Guardar <kbd>G</kbd></button>
<button id="ck-load" type="button" title="Cargar checkpoint" disabled>Cargar <kbd>C</kbd></button>
</div>
<button id="restart" type="button" class="danger ghost">↺ Reiniciar</button>
</div>
<p id="ck-info">Sin checkpoint guardado</p>
<p id="audio-health">Audio en espera de un gesto</p>
<div class="keys">
<span>Controles:</span>
<kbd data-control="p1.left">←</kbd><kbd data-control="p1.up">↑</kbd>
<kbd data-control="p1.down">↓</kbd><kbd data-control="p1.right">→</kbd>
<kbd data-control="p1.button1">Z ataque</kbd>
<kbd data-control="p1.button2">X salto</kbd>
<span class="legend">azul = tecla apretada · verde = leída por la CPU real</span>
</div>
<details id="diagnostics">
<summary>Diagnóstico técnico</summary>
<div class="diag">
<p id="cpu-input">Esperando lecturas de controles por la CPU real…</p>
<p id="video-health">Esperando framebuffer RGBA del motor…</p>
</div>
<pre id="detail"></pre>
</details>
<footer>Los píxeles provienen exclusivamente del compositor aplicado
al estado de vídeo producido por la CPU AOT real.
Si faltan bloques o memoria conocida, el motor se bloquea o retiene
el último frame verificado. No hay imágenes pregrabadas ni MAME en ejecución.</footer>
<script>
const map={Digit5:'coin1',Digit1:'start1',
ArrowLeft:'p1.left',ArrowRight:'p1.right',
ArrowUp:'p1.up',ArrowDown:'p1.down',KeyZ:'p1.button1',KeyX:'p1.button2'};
let last=-1,fetching=false,sessionId=null,paintedCount=0;
let audioContext=null,audioOutput=null,audioPolling=false,audioPollStop=false,
  audioEnabled=false,workletReport=null;
const canvas=document.getElementById('screen'),ctx=canvas.getContext('2d');
const status=document.getElementById('status'),detail=document.getElementById('detail'),
  cpuInput=document.getElementById('cpu-input'),
  videoHealth=document.getElementById('video-health'),
  audioHealth=document.getElementById('audio-health'),
  statusDot=document.getElementById('status-dot'),
  screenWrap=document.getElementById('screen-wrap'),
  pauseOverlay=document.getElementById('pause-overlay'),
  haltOverlay=document.getElementById('halt-overlay'),
  haltMessage=document.getElementById('halt-message');
const keyEls={};
for(const el of document.querySelectorAll('kbd[data-control]'))
  keyEls[el.dataset.control]=el;
// Scale/fullscreen are a per-viewer convenience, never state the server
// relies on; a blocked or empty localStorage must not affect gameplay.
const SCALES=[2,3,4,0]; // 0 means "fit" (CSS default, no fixed width)
let scaleIndex=1;
try{
  const raw=localStorage.getItem('gng.scaleIndex');
  if(raw!==null){
    const saved=Number(raw);
    if(Number.isInteger(saved)&&saved>=0&&saved<SCALES.length)scaleIndex=saved;
  }
}catch{}
function applyScale(){
  const factor=SCALES[scaleIndex];
  screenWrap.style.maxWidth=factor?(factor*256)+'px':'768px';
  document.getElementById('scale').textContent=factor?'×'+factor:'ajustar';
  try{localStorage.setItem('gng.scaleIndex',String(scaleIndex));}catch{}
}
applyScale();
document.getElementById('scale').addEventListener('click',()=>{
  scaleIndex=(scaleIndex+1)%SCALES.length;applyScale();
});
document.getElementById('fullscreen').addEventListener('click',()=>{
  if(document.fullscreenElement)document.exitFullscreen().catch(()=>{});
  else screenWrap.requestFullscreen?.().catch(()=>{});
});
document.getElementById('audio-enable').addEventListener('click',async()=>{
 try{
   if(!audioContext){
     audioContext=new AudioContext();
     await audioContext.resume();
     const {createGngPCMOutput}=await import('/gngb_audio_worklet_sink.mjs');
     audioOutput=await createGngPCMOutput(audioContext,{
       workletUrl:'/gngb_audio_pcm_processor.mjs',onDiagnostic:m=>{
         workletReport=m;
         if(m.kind==='AUDIO_WORKLET_STOP'){
           audioHealth.textContent='Audio detenido: '+m.code;
           audioPollStop=true;
           fetch('/audio/stop',{method:'POST',
             headers:{'Content-Type':'application/json'},
             body:JSON.stringify({sessionId,code:m.code})}).catch(()=>{});
         }
         if(m.kind==='AUDIO_WORKLET_STATS'){
           fetch('/audio/telemetry',{method:'POST',headers:{'Content-Type':'application/json'},
             body:JSON.stringify({sessionId:m.sessionId,state:m.state,
               producedOutputSamples:m.producedOutputSamples,
               missingOutputSamples:m.missingOutputSamples,
               lastInputSample:m.lastInputSample,
               queuedSourceSamples:m.queuedSourceSamples,
               sampleRate:audioContext.sampleRate,
               latencySeconds:(audioContext.baseLatency||0)+(audioContext.outputLatency||0),
               contextTime:m.contextTime})}).catch(()=>{});
         }
       }});
   }
   await audioContext.resume();
   if(audioContext.state!=='running')throw Error('AUDIO_CONTEXT_NOT_RUNNING');
   const r=await fetch('/audio/start',{method:'POST'});
   if(!r.ok)throw Error('AUDIO_START_REJECTED');
   const start=await r.json();
   sessionId=start.sessionId;
   audioOutput.reset(start.sessionId);
   audioEnabled=true;
   audioPollStop=false;
   document.getElementById('audio-enable').disabled=true;
   audioHealth.textContent='AudioContext activo: '+audioContext.sampleRate+' Hz';
   pollAudio();
 }catch(e){audioHealth.textContent='Audio detenido: '+String(e.message??e);}
});
async function pollAudio(){
 if(audioPolling||audioPollStop||!audioOutput)return;audioPolling=true;
 // Obsolete HTTP responses must never reach the new audio session.
 const pollSession=sessionId;
 try{
   const r=await fetch('/audio?session='+pollSession,{cache:'no-store'});
   if(audioPollStop||pollSession!==sessionId)return;
   if(r.status===200){
     const p=await r.json();
     if(audioPollStop||pollSession!==sessionId||p.sessionId!==pollSession)
       return;
     const raw=atob(p.pcm);
     const view=new DataView(new ArrayBuffer(raw.length));
     for(let i=0;i<raw.length;i++)view.setUint8(i,raw.charCodeAt(i));
     const samples=new Int16Array(raw.length/2);
     for(let i=0;i<samples.length;i++)samples[i]=view.getInt16(i*2,true);
     audioOutput.push({sessionId:p.sessionId,sampleRate:p.sampleRate,
       firstSample:p.firstSample,samples});
   }else if(r.status===409){
     const s=await r.json();
     if(audioPollStop||pollSession!==sessionId)return;
     audioOutput.stop();
     audioPollStop=true;
     audioHealth.textContent='Audio detenido: '+s.code;return;
   }
 }catch(e){
   if(audioPollStop||pollSession!==sessionId)return;
   audioPollStop=true;audioOutput.stop();
   audioHealth.textContent='Error de audio: '+String(e.message??e);
   fetch('/audio/stop',{method:'POST',headers:{'Content-Type':'application/json'},
     body:JSON.stringify({sessionId,code:'AUDIO_LIVE_HTTP_CLIENT_STOP'})}).catch(()=>{});
 }
 finally{audioPolling=false;if(!audioPollStop)setTimeout(pollAudio,12);}
}
function send(control,pressed){
 keyEls[control]?.classList.toggle('held',pressed);
 fetch('/input',{method:'POST',
headers:{'Content-Type':'application/json'},body:JSON.stringify({control,pressed})}).catch(()=>{});}
document.addEventListener('keydown',e=>{
 const control=map[e.code];if(!control)return;e.preventDefault();
 if(audioContext)void audioContext.resume();
 if(!e.repeat)send(control,true);
});
document.addEventListener('keyup',e=>{
 const control=map[e.code];if(!control)return;e.preventDefault();send(control,false);
});
// Direct human-initiated button presses, not scripted gameplay.
 // The browser holds the active-low hardware bit briefly, then releases it.
 // Only a real MC6809 bus read can generate a PASS marker.
// The GnG ROM credits a Coin only if the CPU reads it active on at most 12
// frames, like the lab tapes' 12-frame Coin/Start: measured on this engine,
// 13 or more reads are never credited, and a 200 ms hold (11.9 frames) lands
// on 12 or 13 depending on phase. 100 ms lands on 6-7 reads and is always
// credited, also from the paused first VBlank. Clicks queue so each one is a
// separate press with a released gap before the next.
const PULSE_MS=100,PULSE_GAP_MS=200;
const pulses={};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function pulse(control){
  pulses[control]=(pulses[control]??Promise.resolve()).then(async()=>{
    send(control,true);await sleep(PULSE_MS);
    send(control,false);await sleep(PULSE_GAP_MS);
  });
}
function pulseCoin(){if(audioContext)void audioContext.resume();pulse('coin1');}
document.getElementById('coin').addEventListener('click',pulseCoin);
document.getElementById('coin-bar').addEventListener('click',pulseCoin);
document.getElementById('start').addEventListener('click',()=>{
 if(audioContext)void audioContext.resume();pulse('start1');});
document.getElementById('continue').addEventListener('click',async()=>{
  if(audioContext)await audioContext.resume();
  const response=await fetch('/continue',{method:'POST'});
  if(!response.ok)status.textContent='No se pudo continuar la ejecución';
});
window.addEventListener('blur',()=>fetch('/release',{method:'POST'}).catch(()=>{}));
async function restartEngine(path='/reset'){
 // Fence old audio fetches BEFORE the server replaces the session.
 audioPollStop=true;
 try{
   const response=await fetch(path,{method:'POST'});
   if(!response.ok){
     if(audioOutput){audioPollStop=false;pollAudio();}
     throw Error((await response.json().catch(()=>({}))).reason??'RESET_REJECTED');
   }
   const next=await response.json();
   sessionId=next.sessionId;workletReport=null;
   if(audioOutput){
     audioOutput.reset(next.sessionId);
     await fetch('/audio/start',{method:'POST'});
     audioPollStop=false;pollAudio();
   }
   ctx.clearRect(0,0,256,224);
   last=-1;status.textContent=path==='/reset'?'Reiniciando CPU MC6809 desde reset…':
     'Cargando checkpoint del frame '+next.frame+'…';
 }catch(e){status.textContent=path==='/reset'?'No se pudo reiniciar el motor':
   'No se pudo cargar el checkpoint ('+e.message+')';}
}
document.getElementById('restart').addEventListener('click',()=>restartEngine());
document.getElementById('restart-overlay').addEventListener('click',()=>restartEngine());
// Checkpoint: one quick-save slot, saved at a real frame boundary on the
// server (CPU, sound CPU and both YM2203) and loaded as a cold session.
const ckInfo=document.getElementById('ck-info'),
  ckLoad=document.getElementById('ck-load');
const ckReasons={CK_ENGINE_PAUSED:'el motor está en pausa',
  CK_ENGINE_HALTED:'el motor está detenido',CK_AUDIO_STOPPED:'el audio está detenido',
  CK_SAVE_BUSY:'ya se está guardando',CK_SAVE_TIMEOUT:'el motor no respondió'};
async function refreshCheckpoint(){
 try{
   const c=await (await fetch('/checkpoint',{cache:'no-store'})).json();
   ckLoad.disabled=!c.exists||Boolean(c.invalid);
   ckInfo.textContent=!c.exists?'Sin checkpoint guardado':c.invalid?
     'Checkpoint no compatible con este motor ('+c.invalid+')':
     'Checkpoint: frame '+c.frame+' · '+new Date(c.savedAt).toLocaleString();
 }catch{}
}
async function saveCheckpoint(){
 const r=await fetch('/checkpoint/save',{method:'POST'}).catch(()=>null);
 const body=r?await r.json().catch(()=>({})):{};
 if(r?.ok)await refreshCheckpoint();
 else ckInfo.textContent='No se pudo guardar: '+(ckReasons[body.reason]??body.reason??'sin conexión');
}
const loadCheckpoint=()=>{if(!ckLoad.disabled)restartEngine('/checkpoint/load');};
document.getElementById('ck-save').addEventListener('click',saveCheckpoint);
ckLoad.addEventListener('click',loadCheckpoint);
document.addEventListener('keydown',e=>{
 if(e.repeat||e.ctrlKey||e.metaKey||e.altKey)return;
 if(e.code==='KeyG'){e.preventDefault();saveCheckpoint();}
 else if(e.code==='KeyC'){e.preventDefault();loadCheckpoint();}
});
refreshCheckpoint();
async function tick(){
 if(fetching)return;fetching=true;
 try{
   const s=await (await fetch('/state',{cache:'no-store'})).json();
   document.getElementById('coin').disabled=Boolean(s.halt);
   document.getElementById('coin-bar').disabled=Boolean(s.halt);
   document.getElementById('start').disabled=Boolean(s.halt);
   document.getElementById('continue').disabled=Boolean(s.halt)||!s.operatorPause;
   document.getElementById('interaction-window').textContent=s.operatorPause?
     'CPU pausada en VBlank real: inserta moneda o continúa la demostración.':
     'CPU ejecutándose: Coin y Start se transmiten al bus MC6809.';
   pauseOverlay.classList.toggle('show',Boolean(s.operatorPause)&&!s.halt);
   haltOverlay.classList.toggle('show',Boolean(s.halt));
   if(s.halt)haltMessage.textContent='Motor detenido: '+
     (s.halt.status??s.halt.code)+'. El motor espera un reinicio.';
   statusDot.className='dot'+(s.halt?' halted':s.operatorPause?' paused':
     s.frameKnown?' running':'');
   if(sessionId!==s.sessionId){
     sessionId=s.sessionId;last=-1;paintedCount=0;
     ctx.clearRect(0,0,256,224);
     if(audioOutput)audioOutput.reset(sessionId);
   }
   if(audioEnabled&&audioContext&&s.operatorPause&&audioContext.state==='running')
     await audioContext.suspend();
   if(audioEnabled&&audioContext&&!s.operatorPause&&audioContext.state==='suspended'&&
      audioOutput)await audioContext.resume();
   if(audioOutput&&s.audio?.stop)audioHealth.textContent='Audio detenido: '+s.audio.stop;
   else if(audioOutput&&workletReport?.kind==='AUDIO_WORKLET_STATS'){
     const played=workletReport.lastInputSample;
     const latency=(audioContext.baseLatency||0)+(audioContext.outputLatency||0);
     const avMs=played===null?null:
       (s.cycle/1500000-played/62500+latency)*1000;
     audioHealth.textContent='Audio '+workletReport.state+
       ' · cola '+Math.round(s.audio.queuedSamples/62.5)+' ms'+
       ' · underruns '+workletReport.missingOutputSamples+
       (avMs===null?'':' · A/V '+Math.round(avMs)+' ms');
   }
   status.textContent=s.halt?'Motor detenido: '+s.halt.status:
     s.operatorPause?'GnG real — pausado para insertar moneda en frame '+s.frame:
     s.frameKnown?'Ejecutando GnG real — frame '+s.frame:
     'CPU real en ejecución — esperando vídeo completamente conocido';
   const w=s.busWitness;
   const samples=w?.activeSamples??{};
   const list=Object.entries(samples).filter(([,count])=>count>0)
     .map(([name,count])=>name+': '+count).join(' · ');
   cpuInput.textContent=list?
     'Entradas leídas por MC6809: '+list:
     'Ninguna tecla activa leída por CPU (pulsación ≠ lectura)';
   for(const [control,el] of Object.entries(keyEls))
     el.classList.toggle('read',(samples[control]??0)>0);
   const lastRead=w?.lastActive;
   detail.textContent='Última entrada leída: '+(lastRead?
     lastRead.control+' ciclo '+lastRead.cycle+
     ' PC 0x'+lastRead.pc?.toString(16):'NINGUNA')+'\\n'+
     'Sesión: '+s.sessionId+' · Límite: '+s.sessionFrames+' frames\\n'+
     'Frames: '+s.frame+' · Último render válido: '+
     s.lastRenderedFrame+' · Bloques AOT: '+s.blocks+'\\n'+
     'Lecturas Coin: '+s.reads.coin+' · Start: '+s.reads.start+
     ' · P1: '+s.reads.p1+
     (s.halt?'\\nDetención: '+JSON.stringify(s.halt):'');
   const p=s.pixelProbe;
   videoHealth.textContent=p?
     'RGBA real · frame '+s.lastRenderedFrame+
     ' · píxeles no negros '+p.nonBlackPixels+
     ' / 57344 · colores RGB '+p.rgbColors+
     ' · opacidad incorrecta '+p.nonOpaquePixels+
     ' · frames mostrados '+paintedCount:
     'Esperando memoria de vídeo completamente conocida';
   if(s.lastRenderedFrame>0&&s.lastRenderedFrame!==last){
     // Request the most recently PUBLISHED RGBA and its frame identity
     // atomically, not a frame ID observed by a separate /state call.
     const r=await fetch('/pixels',{cache:'no-store'});
     if(r.status===200){
       const renderedFrame=Number(r.headers.get('X-GnG-Frame'));
       const renderSession=Number(r.headers.get('X-GnG-Session'));
       const bytes=new Uint8ClampedArray(await r.arrayBuffer());
       if(bytes.length!==256*224*4)throw Error('RGAB_LENGTH_INVALID_'+bytes.length);
       if(renderSession===sessionId&&Number.isSafeInteger(renderedFrame)&&
          renderedFrame>last){
         ctx.putImageData(new ImageData(bytes,256,224),0,0);
         last=renderedFrame;paintedCount++;
       }
     }else if(r.status!==204){
       throw Error('FRAME_HTTP_'+r.status);
     }
   }
 }catch(e){status.textContent='Error de vídeo/runtime: '+String(e.message??e);}
 finally{fetching=false;}
}
setInterval(tick,40);tick();
</script></main></body></html>`;
function respond(res,status,content,type='application/json'){
  res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff'});
  res.end(content);
}
async function main(){
  if(process.argv.slice(2).join(' ')!=='--serve')
    throw Error('V3_B2C_USAGE_SERVE_ONLY');
  if(!existsSync(BUNDLE)||!existsSync(ZIP))
    throw Error('V3_B2C_PRIVATE_BUNDLE_OR_ROM_MISSING');
  if(!existsSync(B2A_PROOF))throw Error('V3_B2C_B2A_PROOF_MISSING');
  let proof;
  try{proof=JSON.parse(readFileSync(B2A_PROOF,'utf8'))}
  catch{throw Error('V3_B2C_B2A_PROOF_INVALID')}
  if(proof.status!=='INPUT_ROUTE_UNCOMPILED'&&
     proof.status!=='INPUT_STATE_CHANGED')
    throw Error('V3_B2C_B2A_NOT_PROVEN');
  const prepared=await prepareAudioBundle(ROOT,BUNDLE,
    {transform:checkpointRuntime});
  activeBundle=prepared.dir;
  if(!existsSync(join(ROOT,'out/audio/gg2.bin'))||
     !existsSync(join(ROOT,'out/audio/ym2203_lab')))
    throw Error('AUDIO_LIVE_PRIVATE_DEPENDENCY_MISSING');
  console.log('V3_B2C_AUDIO_BUNDLE=PASS_OBSERVER_OVERLAY frames='+
    prepared.verifiedFrames+' runtime_sha256='+prepared.runtimeSha256);
  console.log('V3_B2C_AOT_BUNDLE='+ (BUNDLE===B3?'B3_G'+B3_SELECTED.generation:BUNDLE===B2E?'B2E':BUNDLE===B2D?'B2D':BUNDLE===B2B?'B2B':'B2A'));
  const launch=(checkpoint=null)=>{
    const id=++generation;
    releaseAll();
    earlyCoinPending=false;
    if(pendingSave){pendingSave.reject(Error('CK_SESSION_REPLACED'));pendingSave=null;}
    frame=null;latest=checkpoint?.frame??0;known=false;
    cycle=checkpoint?.cpu.cpu.C??0;unknownBytes=null;
    pixelProbe=null;displayedServerFrame=0;
    source=null;lastGood=0;blocks=0;halt=null;
    reads={all:0,coin:0,start:0,p1:0};busWitness=null;
    portChanges=checkpoint?checkpoint.tape.map(c=>[...c]):[];checkFrame=null;
    audioPackets=[];audioQueued=0;audioActive=false;audioStop=null;
    audioNextSample=checkpoint?ymFirstSample(checkpoint.ym):0;
    audioDelivered=audioNextSample;audioNonzero=0;
    audioPendingBatches=0;
    audioStats=null;workletStats=null;
    audioDroppedBeforeStart=0;
    pacingOrigin=null;
    advance=new Int32Array(new SharedArrayBuffer(4));
    saveRequest=new Int32Array(new SharedArrayBuffer(4));
    const request=saveRequest;
    const ack=advance;
    // A loaded checkpoint resumes mid-game: no first-VBlank coin pause.
    const gate=createVisibleFrameGate({armed:checkpoint===null});
    operatorGate=gate;
    const sound=new Worker(new URL('./gngb_live_audio_worker.mjs',import.meta.url),
      {workerData:{sessionId:id,rom:join(ROOT,'out/audio/gg2.bin'),
        renderer:join(ROOT,'out/audio/ym2203_lab'),
        checkpoint:checkpoint&&{audio:checkpoint.audio,ym:checkpoint.ym}}});
    audioWorker=sound;
    sound.on('message',m=>{
      if(id!==generation)return;
      if(m.type==='stats'){audioStats=m;return;}
      if(m.type==='checkpoint'||m.type==='checkpoint-failed'){
        const save=pendingSave;pendingSave=null;
        if(!save?.cpu)return save?.reject(Error('CK_AUDIO_STATE_MISSING'));
        if(m.type==='checkpoint-failed')return save.reject(Error('CK_AUDIO_STOPPED'));
        try{
          const text=encodeCheckpoint({programSha256:PROGRAM_SHA256,
            frame:save.frame,cpu:save.cpu,audio:m.audio,ym:m.ym,tape:save.tape});
          writeCheckpoint(text);
          console.log('CK_SAVE=PASS frame='+save.frame);
          save.resolve({frame:save.frame,bytes:text.length});
        }catch(e){save.reject(e);}
        return;
      }
      if(m.type==='stop'){
        if(pendingSave){pendingSave.reject(Error('CK_AUDIO_STOPPED'));pendingSave=null;}
        audioStop=m.code;console.error('V3_B2C_AUDIO=STOP_'+m.code);return;
      }
      if(m.type!=='pcm')return;
      if(audioPendingBatches<1){audioStop='AUDIO_LIVE_UNEXPECTED_PCM';return;}
      audioPendingBatches--;
      const bytes=Buffer.from(m.samples);
      const count=bytes.length/2;
      if(m.sessionId!==id||bytes.length%2||m.firstSample!==audioNextSample||
         m.sampleRate!==62500){
        audioStop='AUDIO_LIVE_PCM_GAP';return;
      }
      audioNextSample+=count;
      audioNonzero=m.nonzeroSamples;
      audioPackets.push({sessionId:id,sampleRate:62500,
        firstSample:m.firstSample,bytes});
      audioQueued+=count;
      const limit=audioActive?12500:6250;
      while(audioQueued>limit&&!audioActive&&audioPackets.length){
        const old=audioPackets.shift();
        audioQueued-=old.bytes.length/2;
        audioDroppedBeforeStart+=old.bytes.length/2;
      }
      if(audioQueued>12500)audioStop='AUDIO_LIVE_BACKPRESSURE_STOP';
    });
    sound.on('error',()=>{if(id===generation)audioStop='AUDIO_LIVE_WORKER_STOP';});
    sound.on('exit',code=>{
      if(id===generation&&code!==0&&!audioStop)
        audioStop='AUDIO_LIVE_WORKER_STOP';
    });
    const fresh=new Worker(new URL('./v3_b2c_engine_worker.mjs',import.meta.url),
      {workerData:{bundle:activeBundle,zip:ZIP,inputs:inputs.buffer,
        advance:ack.buffer,sessionFrames:SESSION_FRAMES,sessionId:id,
        saveRequest:request.buffer,checkpoint:checkpoint?.cpu??null}});
    worker=fresh;
    let firstRealFrame=false;
    const firstControlsPrinted=new Set();
    fresh.on('message',m=>{
      if(id!==generation)return; // discard messages from a terminated CPU
      if(m.type==='boot'){
        source=m.source;blocks=m.blocks;
        console.log('V3_B2C_SESSION=STARTED_'+id);
        console.log('V3_B2C_SESSION_FRAMES='+m.sessionFrames);
      }
      if(m.type==='checkpoint'){
        // Board state at the end of frame m.frame; the audio worker answers
        // after the batch of that same frame (messages are ordered).
        for(const c of m.ports)portChanges.push(c);
        if(!pendingSave||audioStop){
          pendingSave?.reject(Error('CK_AUDIO_STOPPED'));pendingSave=null;return;
        }
        pendingSave.frame=m.frame;pendingSave.cpu=m.cpu;
        pendingSave.tape=portChanges.map(c=>[...c]);
        sound.postMessage({type:'save'});
        return;
      }
      if(m.type==='audio-batch'){
        if(!audioStop){
          audioPendingBatches++;
          sound.postMessage({type:'batch',sessionId:id,
            throughCycle:m.throughCycle,events:m.events});
        }
        return;
      }
      if(m.type==='frame'){
        if(pacingOrigin===null)pacingOrigin=performance.now()-m.cycle/1500;
        latest=m.index;cycle=m.cycle;known=m.known;unknownBytes=m.unknownBytes;
        for(const c of m.ports)portChanges.push(c);
        checkFrame={frame:m.index,record_sha256:m.recordSha256};
        lastGood=m.lastGoodFrame;
        reads={all:m.reads,coin:m.coinReads,start:m.startReads,p1:m.p1Reads};
        busWitness=m.witness;
        for(const [control,count] of Object.entries(m.witness?.activeSamples??{})){
          if(count>0&&!firstControlsPrinted.has(control)){
            firstControlsPrinted.add(control);
            const label=control.toUpperCase().replace(/[^A-Z0-9]/g,'_');
            console.log('V3_B2C_BUS_'+label+'=PASS_CPU_ACTIVE_READ frame='+m.index);
          }
        }
        if(m.rgba){
          frame=Buffer.from(m.rgba);
          pixelProbe=m.pixelProbe;
          displayedServerFrame=m.index;
          if(!firstRealFrame){
            firstRealFrame=true;
            console.log('V3_B2C_FIRST_FRAME=PASS_REAL_AOT_RENDER frame='+m.index);
            console.log('V3_B2C_FIRST_RGBA_NONBLACK='+m.pixelProbe.nonBlackPixels);
            console.log('V3_B2C_FIRST_RGBA_COLORS='+m.pixelProbe.rgbColors);
            console.log('V3_B2C_FIRST_RGBA_NONOPAQUE='+m.pixelProbe.nonOpaquePixels);
          }
        }
        if(m.coinReads>0&&firstControlsPrinted.has('coin1')&&
           !firstControlsPrinted.has('legacy_coin_marker')){
          firstControlsPrinted.add('legacy_coin_marker');
          console.log('V3_B2C_COIN=PASS_REAL_CPU_READ frame='+m.index);
        }
        const coinHeld=heldControls().includes('coin1')||earlyCoinPending;
        if(m.known)earlyCoinPending=false; // consumed by this gate decision
        if(gate.shouldAdvance({index:m.index,known:m.known,coinHeld})){
          const target=pacingOrigin+m.cycle/1500;
          const backpressureSince=performance.now();
          const release=()=>{
            if(id!==generation)return;
            if(!audioStop&&(audioPendingBatches>8||
               (audioActive&&audioQueued>10000))){
              if(performance.now()-backpressureSince>500)
                audioStop='AUDIO_LIVE_BACKPRESSURE_STOP';
              else {setTimeout(release,5);return;}
            }
            const wait=Math.max(0,target-performance.now());
            setTimeout(()=>{
              if(id!==generation)return;
              Atomics.add(ack,0,1);Atomics.notify(ack,0);
            },wait);
          };
          release();
        }else{
          // Exactly one authentic VBlank is held, without advancing CPU
          // clocks or replacing video. Coin pressed by operator releases it.
          console.log('V3_B2C_OPERATOR_PAUSE=REAL_VBLANK_FRAME_'+m.index);
        }
      }
      if(m.type==='halt'||m.type==='error'){
        halt=m;
        if(!audioStop)audioStop='AUDIO_LIVE_ENGINE_HALT';
        if(m.type==='halt'&&m.witness)busWitness=m.witness;
        for(const c of m.ports??[])portChanges.push(c);
        console.log('V3_B3_LIVE_TAPE='+saveLiveTape());
        console.error('V3_B2C_ENGINE='+m.type.toUpperCase()+'_'+
          (m.status??m.code));
        if(m.type==='halt'){
          console.log('V3_B2C_HALT_FRAME='+m.frame);
          console.log('V3_B2C_HALT_COIN_READS='+m.coinReads);
          console.log('V3_B2C_HALT_START_READS='+m.startReads);
          if(m.status==='UNCOMPILED'){
            console.log('V3_B2C_MISSING_BANK='+String(m.missing?.bank??'FIXED_OR_RAM'));
            console.log('V3_B2C_MISSING_PC='+String(m.missing?.pc??'UNKNOWN'));
            console.log('V3_B2C_NEXT_ACTION=RUN_B2B_OFFLINE_DISCOVERY');
          }
        }
      }
    });
    fresh.on('error',err=>{
      if(id===generation)halt={status:'WORKER_ERROR',code:err.message};
    });
    fresh.on('exit',code=>{
      if(id===generation&&!halt)halt={status:'WORKER_EXIT',code};
    });
  };
  const coldRestart=(checkpoint=null)=>{
    const previous=worker,oldSound=audioWorker,oldAdvance=advance;
    if(previous){
      // Release the old worker's VBlank wait before termination. Neither
      // worker can mutate the other session's CPU state or output.
      if(oldAdvance){Atomics.add(oldAdvance,0,1);Atomics.notify(oldAdvance,0);}
      void previous.terminate().catch(()=>{});
    }
    if(oldSound)void oldSound.terminate().catch(()=>{});
    launch(checkpoint);
    console.log(checkpoint?'CK_LOAD=PASS frame='+checkpoint.frame+' id='+generation:
      'V3_B2C_RESET=PASS_NEW_COLD_AOT_SESSION id='+generation);
  };
  launch();
  // Raised at the next frame boundary of the running CPU; fails fast when
  // the CPU is paused or halted, since no boundary would come.
  const saveCheckpoint=()=>new Promise((resolve,reject)=>{
    if(halt)return reject(Error('CK_ENGINE_HALTED'));
    if(audioStop)return reject(Error('CK_AUDIO_STOPPED'));
    if(operatorGate?.snapshot().paused||!latest)return reject(Error('CK_ENGINE_PAUSED'));
    if(pendingSave)return reject(Error('CK_SAVE_BUSY'));
    const timer=setTimeout(()=>{
      if(pendingSave?.resolve===done){pendingSave=null;reject(Error('CK_SAVE_TIMEOUT'));}
    },3000);
    const done=v=>{clearTimeout(timer);resolve(v);};
    pendingSave={resolve:done,reject:e=>{clearTimeout(timer);reject(e);}};
    Atomics.store(saveRequest,0,1);
  });
  const resumeOperator=()=>{
    if(!operatorGate?.release())return false;
    // Re-anchor monotonic presentation after a deliberate operator pause.
    pacingOrigin=performance.now()-cycle/1500;
    if(advance){Atomics.add(advance,0,1);Atomics.notify(advance,0);}
    console.log('V3_B2C_OPERATOR_RESUME=REAL_MC6809_CONTINUES');
    return true;
  };
  const server=createServer(async(req,res)=>{
    try{
      const u=new URL(req.url,'http://127.0.0.1:'+PORT);
      if(req.method==='GET'&&u.pathname==='/'){
        respond(res,200,html,'text/html; charset=utf-8');return;
      }
      const modules={
        '/gngb_audio_worklet_sink.mjs':'gngb_audio_worklet_sink.mjs',
        '/gngb_audio_pcm_processor.mjs':'gngb_audio_pcm_processor.mjs',
        '/gngb_audio_resampler.mjs':'gngb_audio_resampler.mjs'};
      if(req.method==='GET'&&modules[u.pathname]){
        respond(res,200,readFileSync(join(ROOT,'src',modules[u.pathname])),
          'text/javascript; charset=utf-8');return;
      }
      if(req.method==='POST'&&u.pathname==='/audio/start'){
        if(audioStop){respond(res,409,JSON.stringify({code:audioStop}));return;}
        audioActive=true;
        audioDelivered=audioPackets[0]?.firstSample??audioNextSample;
        respond(res,200,JSON.stringify({ok:true,sessionId:generation,
          firstSample:audioDelivered}));return;
      }
      if(req.method==='POST'&&u.pathname==='/audio/stop'){
        let value='';
        for await(const chunk of req){
          value+=chunk.toString('utf8');
          if(value.length>256){respond(res,413,'{}');return;}
        }
        let report;try{report=JSON.parse(value)}catch{report=null;}
        if(report?.sessionId!==generation||
           !/^AUDIO_[A-Z0-9_]{3,80}$/.test(report?.code)){
          respond(res,422,'{}');return;
        }
        audioStop=report.code;
        respond(res,200,'{"ok":true}');return;
      }
      if(req.method==='GET'&&u.pathname==='/audio'){
        if(Number(u.searchParams.get('session'))!==generation){
          respond(res,204,'');return;
        }
        if(audioStop){respond(res,409,JSON.stringify({code:audioStop}));return;}
        if(!audioActive||!audioPackets.length){respond(res,204,'');return;}
        const packet=audioPackets.shift();
        audioQueued-=packet.bytes.length/2;
        if(packet.firstSample!==audioDelivered){
          audioStop='AUDIO_LIVE_HTTP_PCM_GAP';
          respond(res,409,JSON.stringify({code:audioStop}));return;
        }
        audioDelivered+=packet.bytes.length/2;
        respond(res,200,JSON.stringify({sessionId:packet.sessionId,
          sampleRate:packet.sampleRate,firstSample:packet.firstSample,
          pcm:packet.bytes.toString('base64')}));return;
      }
      if(req.method==='POST'&&u.pathname==='/audio/telemetry'){
        let value='';
        for await(const chunk of req){
          value+=chunk.toString('utf8');
          if(value.length>1024){respond(res,413,'{}');return;}
        }
        let report;try{report=JSON.parse(value)}catch{report=null;}
        if(!report||report.sessionId!==generation||
           !['WAITING','PLAYING','STOP'].includes(report.state)||
           !Number.isSafeInteger(report.producedOutputSamples)||
           !Number.isSafeInteger(report.missingOutputSamples)||
           !Number.isSafeInteger(report.queuedSourceSamples)||
           !Number.isFinite(report.sampleRate)||
           (report.lastInputSample!==null&&
            !Number.isFinite(report.lastInputSample))){
          respond(res,422,'{}');return;
        }
        const latency=Number.isFinite(report.latencySeconds)?
          Math.max(0,Math.min(1,report.latencySeconds)):0;
        const avMs=report.lastInputSample===null?null:
          (cycle/1500000-report.lastInputSample/62500+latency)*1000;
        workletStats={state:report.state,
          producedOutputSamples:report.producedOutputSamples,
          missingOutputSamples:report.missingOutputSamples,
          queuedSourceSamples:report.queuedSourceSamples,
          lastInputSample:report.lastInputSample,
          sampleRate:report.sampleRate,latencySeconds:latency,avMs};
        if(report.state==='STOP'&&report.missingOutputSamples>0)
          audioStop='AUDIO_WORKLET_UNDERRUN';
        respond(res,200,'{"ok":true}');return;
      }
      if(req.method==='GET'&&u.pathname==='/state'){
        respond(res,200,JSON.stringify(state()));return;
      }
      if(req.method==='GET'&&u.pathname==='/tape'){
        respond(res,200,JSON.stringify(liveTape()));return;
      }
      if(req.method==='GET'&&u.pathname==='/pixels'){
        if(!frame){respond(res,204,'');return;}
        // Single event-loop snapshot: frame bytes and ID refer to SAME RGBA.
        // No 409 race against a separately requested /state frame.
        res.writeHead(200,{
          'Content-Type':'application/octet-stream',
          'Content-Length':frame.length,
          'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
          'X-GnG-Frame':String(displayedServerFrame),
          'X-GnG-Session':String(generation)
        });
        res.end(frame);return;
      }
      if(req.method==='POST'&&u.pathname==='/continue'){
        if(halt||!resumeOperator()){
          respond(res,409,JSON.stringify({ok:false,reason:'NOT_PAUSED'}));
          return;
        }
        respond(res,200,JSON.stringify({ok:true}));return;
      }
      if(req.method==='GET'&&u.pathname==='/checkpoint'){
        respond(res,200,JSON.stringify(checkpointInfo()));return;
      }
      if(req.method==='POST'&&u.pathname==='/checkpoint/save'){
        try{
          const saved=await saveCheckpoint();
          respond(res,200,JSON.stringify({ok:true,...saved}));
        }catch(e){
          if(saveRequest)Atomics.store(saveRequest,0,0);
          respond(res,409,JSON.stringify({ok:false,reason:e.message}));
        }
        return;
      }
      if(req.method==='POST'&&u.pathname==='/checkpoint/load'){
        let checkpoint;
        try{
          if(!existsSync(CHECKPOINT))throw Error('CK_MISSING');
          checkpoint=decodeCheckpoint(readFileSync(CHECKPOINT,'utf8'),
            {programSha256:PROGRAM_SHA256});
        }catch(e){
          respond(res,409,JSON.stringify({ok:false,reason:e.code??e.message}));return;
        }
        coldRestart(checkpoint);
        respond(res,200,JSON.stringify({ok:true,sessionId:generation,
          frame:checkpoint.frame}));return;
      }
      if(req.method==='POST'&&u.pathname==='/reset'){
        coldRestart();
        respond(res,200,JSON.stringify({ok:true,sessionId:generation}));return;
      }
      if(req.method==='POST'&&(u.pathname==='/input'||u.pathname==='/release')){
        if(u.pathname==='/release'){
          releaseAll();
          respond(res,200,JSON.stringify({ok:true}));return;
        }
        let value='';
        for await(const chunk of req){
          value+=chunk.toString('utf8');
          if(value.length>1024){respond(res,413,JSON.stringify({ok:false}));return}
        }
        let data;try{data=JSON.parse(value)}catch{data=null}
        // A stopped CPU can no longer sample SYSTEM/P1. Do not report
        // keyboard presses as accepted after an UNCOMPILED halt.
        if(halt){
          respond(res,409,JSON.stringify({ok:false,reason:'CPU_HALTED_RESTART'}));
          return;
        }
        if(!data||Object.keys(data).length!==2||
           !applyControl(data.control,data.pressed)){
          respond(res,422,JSON.stringify({ok:false}));return;
        }
        // The user pressed an actual hardware input, not a scripted
        // Coin fixture. Release the paused VBlank with its bit held low.
        // A coin that arrives before this session's worker has reached
        // its first known VBlank has nothing to release yet (the gate
        // was just created by /reset); remember it instead of losing
        // a credit the operator genuinely inserted.
        if(data.control==='coin1'&&data.pressed&&!resumeOperator()&&
           operatorGate?.snapshot().armed)
          earlyCoinPending=true;
        respond(res,200,JSON.stringify({ok:true}));return;
      }
      respond(res,404,JSON.stringify({error:'NOT_FOUND'}));
    }catch(e){respond(res,500,JSON.stringify({error:'ENGINE_HTTP_ERROR'}))}
  });
  server.listen(PORT,'127.0.0.1',()=>console.log(
    'V3_B2C_REAL_ENGINE=STARTED http://127.0.0.1:'+PORT));
}
main().catch(e=>{console.error('V3_B2C_REAL_ENGINE=BLOCKED_'+
  String(e.message));process.exitCode=2});
