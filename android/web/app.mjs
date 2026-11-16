/** Offline display, multitouch controls and, on desktop, the keyboard
 * (ao_keyboard.mjs) through the same controls. */
import {createTouchControls} from './lib/ao_touch_controls.mjs';
import {followBase,knobOffset,stickSector} from './lib/ao_stick.mjs';
import {keyAction} from './lib/ao_keyboard.mjs';
import {checkedCheckpointTape} from './lib/v3_b3_live_tape.mjs';
import {DEFAULT_OPTIONS,gameOptions} from './games/gngb/options.mjs';
import {createMatchTracker} from './lib/ao_match.mjs';
import {bluetoothBridge,bluetoothStatus,pairedDevices,createBluetoothClient}
  from './lib/net_bluetooth_client.mjs';
import {NET_PROTOCOL} from './lib/netplay_turns.mjs';

const canvas=document.getElementById('screen');
const ctx2d=canvas.getContext('2d',{alpha:false});
const status=document.getElementById('status');
const hint=document.getElementById('hint');
const halt=document.getElementById('halt');
const systemControls=document.getElementById('system-controls');
const startButton=document.getElementById('start');
const buttons=[...document.querySelectorAll('[data-hold],[data-pulse]')];
const soundButton=document.getElementById('sound');
const ckSave=document.getElementById('ck-save'),ckLoad=document.getElementById('ck-load');
const log=(tag,data)=>console.log(tag+' '+JSON.stringify(data));
let worker=null,pending=null,drawn=0,playable=false;
// AO-6 sound: the producer runs from boot; output sessions come and go.
let audioWorker=null,audioReady=false,audioDead=null,producerStats=null;
let ctx=null,node=null,gain=null,soundOn=false,session=null,sessionSeq=0;
let worklet=null,audioNote='',av=[],latencyMs=0,recoveries=[];
// Operator (28/10): after an underrun, reopen a session instead of turning
// sound off, at most RECOVER_MAX times per minute.
const RECOVER_MAX=5;
const AUDIO_SAMPLES_PER_FRAME=1048;
let game={credits:0,readyToStart:false,inGame:false};
// Game options (games/gngb/options.mjs) for the next Reiniciar, kept in this
// browser; `current` is what the running session plays with (a loaded
// checkpoint keeps the options it was saved with).
const OPTIONS_KEY='gng-options';
// Controls preferences: applied at once, never part of a game's options.
const AUTOFIRE_KEY='gng-autofire';
let autofire=false;
try{autofire=localStorage.getItem(AUTOFIRE_KEY)==='1';}catch{}
const optionsDialog=document.getElementById('options');
const optionsForm=document.getElementById('options-form');
const optionsButton=document.getElementById('options-open');
const DIFFICULTY_NAMES={easy:'Fácil',normal:'Normal',hard:'Difícil',hardest:'Muy difícil'};
const describeOptions=o=>DIFFICULTY_NAMES[o.difficulty]+' · '+o.lives+' vidas · enemigos '+
  o.enemyPace+' %';
const defaultOptions=o=>Object.keys(DEFAULT_OPTIONS).every(k=>o[k]===DEFAULT_OPTIONS[k]);
let chosen=storedOptions(),current=null;
// Two players alternate on the same controls (games/gngb/state.mjs).
const twoButton=document.getElementById('two-players');
const turnBanner=document.getElementById('turn'),resultBox=document.getElementById('result');
const match=createMatchTracker();
let twoPending=null,turnTimer=null; // since when 2 Jugadores waits for credits
// Two phones over Bluetooth (net_bluetooth_client.mjs: the Android shell's
// link to a phone paired in Settings) play by turns (netplay_turns.mjs, in
// the engine worker). The host is Jugador 1 and its options rule; both check
// they run the same program. `online`: {client, role,
// phase:'connecting'|'playing', owner, inbox (peer messages until the engine
// is ready), ready, started}.
const onlineDialog=document.getElementById('online');
const onlineButton=document.getElementById('online-open');
const onlineStatus=document.getElementById('online-status');
const againButton=document.getElementById('result-again');
let online=null,programSha=null;
const netPlaying=()=>online?.phase==='playing';
const myPlayer=()=>online?.role==='guest'?2:1;
const CLOSED={lost:'Se perdió la conexión.',
  'bt-unreachable':'No se pudo conectar. ¿El otro teléfono está en Esperar por Bluetooth?',
  'bluetooth-off':'Activá el Bluetooth en Ajustes.',
  permission:'Falta el permiso de Bluetooth (Dispositivos cercanos).',
  unavailable:'Este teléfono no tiene Bluetooth.',protocol:'El otro teléfono envió datos inválidos.',
  cancelled:''};
const ENDED={desync:'Las dos partidas dejaron de coincidir.',
  protocol:'El otro teléfono envió datos inválidos.','peer-left':'El otro teléfono se desconectó.'};
const REFUSED={protocol:'Los dos teléfonos tienen versiones distintas de la app.',
  program:'Los dos teléfonos tienen versiones distintas del juego.',
  options:'Las opciones de juego del Jugador 1 no son válidas.'};
function storedOptions(){
  try{return gameOptions(JSON.parse(localStorage.getItem(OPTIONS_KEY)));}
  catch{return gameOptions();}
}
// One quick-save checkpoint (gng.checkpoint.v1) in IndexedDB; the engine
// worker builds and checks it. Saving waits for the next frame boundary.
const CK_DB='gng-checkpoint',CK_STORE='slot',CK_KEY='quick',CK_SAVE_MS=3000;
let ckSaved=null,ckSaving=null; // {frame,savedAt}; save timeout
let ckTape=false; // this save exports the tape instead of filling the slot
let ckNote='',ckNoteUntil=0; // shown with the fps for a few seconds
const ckRequest=(mode,run)=>new Promise((resolve,reject)=>{
  const open=indexedDB.open(CK_DB,1);
  open.onupgradeneeded=()=>open.result.createObjectStore(CK_STORE);
  open.onerror=()=>reject(open.error);
  open.onsuccess=()=>{
    const db=open.result,tx=db.transaction(CK_STORE,mode);
    const req=run(tx.objectStore(CK_STORE));
    tx.oncomplete=()=>{db.close();resolve(req.result);};
    tx.onerror=tx.onabort=()=>{db.close();reject(tx.error);};
  };
});
function updateCheckpoint(note=null){
  ckSave.disabled=!playable||ckSaving!==null||online!==null;
  ckLoad.disabled=ckSaved===null||ckSaving!==null||online!==null;
  ckLoad.title=ckSaved?'Cargar el checkpoint del frame '+ckSaved.frame:
    'Sin checkpoint guardado';
  if(note){ckNote=note;ckNoteUntil=performance.now()+4000;status.textContent=note;}
}
function saveCheckpoint(tape=false){
  if(ckSave.disabled)return;
  ckTape=tape;
  ckSaving=setTimeout(()=>savedCheckpoint(null,'CK_SAVE_TIMEOUT'),CK_SAVE_MS);
  updateCheckpoint(tape?'exportando cinta…':'guardando…');
  worker.postMessage({type:'save'});
}
async function savedCheckpoint(data,code=null){
  if(ckSaving===null)return; // a late answer after a timeout or a restart
  clearTimeout(ckSaving);ckSaving=null;
  try{
    if(code)throw Error(code);
    if(ckTape)return await downloadTape(data.text);
    const meta={frame:data.frame,savedAt:new Date().toISOString()};
    await ckRequest('readwrite',store=>store.put({...meta,text:data.text},CK_KEY));
    ckSaved=meta;log('AO_CK_SAVE',{...meta,bytes:data.text.length});
    updateCheckpoint('guardado · frame '+meta.frame);
  }catch(e){
    log(ckTape?'AO_TAPE_FAILED':'AO_CK_SAVE_FAILED',{code:String(e?.message??e)});
    updateCheckpoint(ckTape?'no se pudo exportar':'no se pudo guardar');
  }
}
// The session's port changes from reset, as rp3_compare replays them, with
// the record hash of the frame so a lab replay can check it.
async function downloadTape(text){
  const tape=await checkedCheckpointTape(text);
  const url=URL.createObjectURL(new Blob([JSON.stringify(tape)],
    {type:'application/json'}));
  const a=document.createElement('a');a.href=url;
  a.download='gng-tape-'+new Date().toISOString().replace(/[:.]/g,'-')+
    '-frame'+tape.frame+'.json';
  a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  log('AO_TAPE_EXPORT',{frame:tape.frame,changes:tape.changes.length});
  updateCheckpoint('cinta · frame '+tape.frame);
}
async function loadCheckpoint(){
  if(ckLoad.disabled)return;
  try{
    const slot=await ckRequest('readonly',store=>store.get(CK_KEY));
    if(!slot?.text)throw Error('CK_EMPTY');
    log('AO_CK_LOAD',{frame:slot.frame});
    start(slot.text);
  }catch(e){
    log('AO_CK_LOAD_FAILED',{code:String(e?.message??e)});
    updateCheckpoint('no se pudo cargar');
  }
}
const controls=createTouchControls((ports,held,pulse)=>{
  // The fingers alone, change by change, for the engine's per-frame shaping
  // (src/ao_input_shaper.mjs); the taps stay in `ports`.
  worker?.postMessage({type:'engine',message:{type:'p1',value:ports[1]|pulse[1]}});
  worker?.postMessage({type:'ports',ports,pulse});
  for(const button of buttons){
    const active=held.includes(button.dataset.hold??button.dataset.pulse);
    button.classList.toggle('held',active);
    button.setAttribute('aria-pressed',String(active));
  }
});
const zone=document.getElementById('stick-zone');
const stickBase=document.getElementById('stick-base');
const stickKnob=document.getElementById('stick-knob');
let stick=null; // {id, base:{x,y}, sector}, zone coordinates
const STICK_JUMP='stick:jump'; // the upper diagonals hold Jump as a second source
const stickRadius=()=>stickBase.offsetWidth/2;
function drawStick(base,knob={x:0,y:0}){
  const r=stickRadius(),k=stickKnob.offsetWidth/2;
  stickBase.style.transform=`translate(${base.x-r}px,${base.y-r}px)`;
  stickKnob.style.transform=`translate(${base.x+knob.x-k}px,${base.y+knob.y-k}px)`;
}
// At rest the stick waits at the bottom right corner of the zone.
function restStick(){
  if(stick){controls.release(stick.id);controls.release(STICK_JUMP);}
  stick=null;zone.classList.remove('active');delete zone.dataset.dir;
  const r=stickRadius();
  drawStick({x:zone.clientWidth-r-16,y:zone.clientHeight-r-16});
}
function moveStick(e){
  const z=zone.getBoundingClientRect(),r=stickRadius();
  const point={x:e.clientX-z.left,y:e.clientY-z.top};
  stick.base=followBase(stick.base,point,r);
  const sector=stickSector(point.x-stick.base.x,point.y-stick.base.y,r,
    stick.sector?.name);
  if(sector!==stick.sector){
    stick.sector=sector;
    if(sector)controls.hold(stick.id,sector.dir);else controls.release(stick.id);
    if(sector?.jump)controls.hold(STICK_JUMP,'p1.button2');
    else controls.release(STICK_JUMP);
    if(sector)zone.dataset.dir=sector.name;else delete zone.dataset.dir;
  }
  drawStick(stick.base,knobOffset(stick.base,point,r));
}
zone.addEventListener('pointerdown',e=>{
  if(!playable||stick||e.button!==0)return;
  e.preventDefault();
  zone.setPointerCapture(e.pointerId);
  const z=zone.getBoundingClientRect(),r=stickRadius();
  const clamp=(v,lo,hi)=>Math.min(Math.max(v,lo),hi);
  // The base starts under the thumb, kept whole inside the zone.
  stick={id:e.pointerId,sector:null,base:{
    x:clamp(e.clientX-z.left,r,z.width-r),y:clamp(e.clientY-z.top,r,z.height-r)}};
  zone.classList.add('active');
  moveStick(e);
});
zone.addEventListener('pointermove',e=>{if(e.pointerId===stick?.id)moveStick(e);});
for(const event of ['pointerup','pointercancel','lostpointercapture'])
  zone.addEventListener(event,e=>{if(e.pointerId===stick?.id)restStick();});
window.addEventListener('resize',()=>{if(!stick)restStick();});
function enable(value){
  playable=value;
  // Online, the controls only count in this phone's turns.
  const active=value&&(!netPlaying()||online.owner===online.role);
  controls.setEnabled(active);
  zone.classList.toggle('disabled',!active);
  if(!active)restStick();
  for(const button of buttons)button.disabled=!active||
    (button.dataset.pulse&&(game.inGame||netPlaying()))||
    (button.dataset.pulse==='start1'&&!game.readyToStart);
  twoButton.disabled=!value||online!==null||game.mode!==1||twoPending!==null;
  againButton.disabled=!active||game.mode!==1||twoPending!==null;
  updateCheckpoint();
}
// 2 Jugadores: the coins still missing for two credits, then Start 2 once the
// title counts them. Online the host does it by itself at the title.
function startTwoPlayers(){if(!twoButton.disabled)beginTwoPlayers();}
function beginTwoPlayers(){
  resultBox.hidden=true;
  for(let i=game.credits;i<2;i++)controls.pulse('coin1');
  twoPending=performance.now();enable(playable);checkTwoPlayers();
  setTimeout(()=>{checkTwoPlayers();enable(playable);},5100);
}
function checkTwoPlayers(){
  if(twoPending===null)return;
  if(game.mode===1&&game.credits>=2){twoPending=null;controls.pulse('start2');}
  else if(performance.now()-twoPending>=5000){
    twoPending=null;log('AO_TWO_PLAYERS_TIMEOUT',game);
  }
}
function showTurn(player,first){
  clearTimeout(turnTimer);
  turnBanner.textContent=!netPlaying()?(first?'Empieza el Jugador ':'Turno del Jugador ')+player:
    player===myPlayer()?(first?'Empezás vos':'Tu turno'):
    (first?'Empieza el rival':'Turno del rival');
  turnBanner.hidden=false;
  turnTimer=setTimeout(()=>{turnBanner.hidden=true;},2500);
}
function matchEvents(state){
  for(const e of match.update(state)){
    log('AO_MATCH',e);
    if(e.type==='start'){resultBox.hidden=true;showTurn(e.player,true);}
    else if(e.type==='turn')showTurn(e.player,false);
    else if(e.type==='result'){
      const points=n=>n.toLocaleString('es');
      document.getElementById('result-p1').textContent=points(e.scores[0]);
      document.getElementById('result-p2').textContent=points(e.scores[1]);
      document.getElementById('result-winner').textContent=!e.winner?'Empate':
        !netPlaying()?'Gana el Jugador '+e.winner:
        e.winner===myPlayer()?'Ganaste':'Ganó el rival';
      againButton.hidden=online?.role==='guest';
      turnBanner.hidden=true;resultBox.hidden=false;
    }
  }
}
function updateHint(){
  systemControls.hidden=game.inGame||netPlaying();
  hint.hidden=game.inGame;
  startButton.textContent=game.canContinue?'Continuar':'Start';
  hint.textContent=!playable?'Cargando el juego…':netPlaying()?
    'Bluetooth · Jugador '+myPlayer()+'\n'+(online.role==='host'?
      'La partida empieza sola':'El Jugador 1 empieza la partida'):game.inGame?
    'Tocá y mantené los controles':game.readyToStart?
    (game.canContinue?'2 · Continuar':'2 · Start'):
    game.credits>0?'Moneda lista · un momento…':'1 · Moneda     2 · Start';
  if(playable&&current&&!defaultOptions(current))
    hint.textContent+='\n'+describeOptions(current);
  optionsButton.classList.toggle('custom',current!==null&&!defaultOptions(current));
  optionsButton.title=current?describeOptions(current):'Opciones de juego';
}
function stop(message){
  enable(false);halt.textContent=message;halt.hidden=false;
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
        }else if(data?.kind==='STOP'){
          if(data.sessionId!==session)return; // an older session ended
          const now=performance.now();
          recoveries=recoveries.filter(t=>now-t<60000);
          if(data.code==='AUDIO_WORKLET_UNDERRUN'&&soundOn&&
             recoveries.length<RECOVER_MAX){
            recoveries.push(now);
            log('AO_AUDIO_RECOVER',{count:recoveries.length,...data});
            closeSession();openSession();
          }else audioStop(data.code,data);
        }
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
    producer:producerStats,avMs,latencyMs:Math.round(latencyMs),
    recoveries:recoveries.length,dead:audioDead});
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
const toEngine=message=>worker?.postMessage({type:'engine',message});
const program=()=>programSha??=fetch('bundle/manifest.json').then(r=>r.json())
  .then(m=>m.files['program.mjs']);
function updateOnline(note=null){
  if(note!==null)onlineStatus.textContent=note;
  document.getElementById('online-setup').hidden=online!==null;
  document.getElementById('online-leave').hidden=online===null;
  onlineButton.classList.toggle('on',online!==null);
  onlineButton.textContent=!online?'Bluetooth':
    netPlaying()?'Bluetooth · Jugador '+myPlayer():'Bluetooth…';
  for(const id of ['restart','options-open'])document.getElementById(id).disabled=online!==null;
  enable(playable);
}
function connect(action){
  const o={client:null,role:null,phase:'connecting',owner:'host',
    inbox:[],ready:false,started:false};
  online=o;updateOnline('Conectando…');
  try{o.client=createBluetoothClient({onEvent:e=>{if(online===o)linkEvent(o,e);}});}
  catch{return endOnline(CLOSED.unavailable);}
  if(online===o)action(o.client);
}
// The Android shell's Bluetooth: the button shows only where there is one;
// the dialog asks for the permission, then lists the phones paired in Settings.
const bluetoothUsable=()=>{try{return !!bluetoothBridge()?.available();}catch{return false;}};
function refreshBluetooth(){
  const bridge=bluetoothBridge();
  const needs=bluetoothStatus(bridge)?.state==='permission-required';
  const devices=needs?[]:pairedDevices(bridge),select=document.getElementById('bt-device');
  document.getElementById('bt-permission').hidden=!needs;
  document.getElementById('bt-host').hidden=needs;
  select.replaceChildren(...(devices.length?devices.map(d=>new Option(d.name,d.address)):
    [new Option(needs?'Falta el permiso':'Sin teléfonos vinculados','')]));
  select.disabled=!devices.length;
  document.getElementById('bt-join').disabled=!devices.length;
}
// The shell's events while no Bluetooth client is open: a permission answer.
window.__shellBluetooth=e=>{if(e?.type==='status'&&!onlineDialog.hidden&&!online)refreshBluetooth();};
function linkEvent(o,e){
  if(e.type!=='message')log('AO_ONLINE',e);
  switch(e.type){
    case 'waiting':o.role='host';updateOnline('Esperando al otro teléfono por Bluetooth…');break;
    case 'connecting':updateOnline('Conectando por Bluetooth…');break;
    case 'paired':
      o.role=e.role;
      if(o.role==='host'){updateOnline('Rival conectado · preparando…');sendHello(o);}
      else updateOnline('Conectado · esperando al Jugador 1…');
      break;
    case 'message':peerMessage(o,e.message);break;
    case 'peer-left':endOnline(ENDED['peer-left']);break;
    case 'closed':endOnline(CLOSED[e.reason]??CLOSED.lost);break;
  }
}
async function sendHello(o){
  const sha=await program();
  if(online===o)o.client.send({type:'hello',protocol:NET_PROTOCOL,program:sha,options:chosen});
}
async function peerMessage(o,m){
  if(m?.type==='net'){
    if(o.ready)toEngine({type:'net',m:m.m});else o.inbox.push(m.m);
  }else if(m?.type==='hello'&&o.role==='guest'&&o.phase==='connecting'){
    const sha=await program();
    if(online!==o)return;
    let options=null;try{options=gameOptions(m.options);}catch{}
    const refused=m.protocol!==NET_PROTOCOL?'protocol':m.program!==sha?'program':
      options?null:'options';
    if(refused){
      o.client.send({type:'hello-refused',reason:refused});
      return endOnline(REFUSED[refused]);
    }
    o.client.send({type:'hello-ok'});play(o,options);
  }else if(m?.type==='hello-ok'&&o.role==='host'&&o.phase==='connecting')play(o,chosen);
  else if(m?.type==='hello-refused')
    endOnline(REFUSED[m.reason]??'El otro teléfono no aceptó la partida.');
}
// Both phones restart from reset with the host's options.
function play(o,options){
  o.phase='playing';log('AO_ONLINE_PLAY',{role:o.role,options});
  onlineDialog.hidden=true;updateOnline('');
  start(null,{role:o.role,options});
}
function engineMessage(m){
  if(m?.type==='net')online?.client.send({type:'net',m:m.m});
  else if(m?.type==='net-event'&&netPlaying()){
    const e=m.event;
    if(e.type==='owner'){online.owner=e.owner;enable(playable);}
    else if(e.type==='end'){log('AO_NET_END',e);endOnline(ENDED[e.reason]??'');}
  }
}
// The link is closed; a session in play stays on screen, halted, until Reiniciar.
function endOnline(message,restart=false){
  const o=online;if(!o)return;
  online=null;o.client?.leave();
  log('AO_ONLINE_END',{phase:o.phase,message});
  updateOnline(message);
  if(o.phase!=='playing')return;
  clearTimeout(turnTimer);turnBanner.hidden=true;
  if(restart)start();
  else{closeSession();worker?.terminate();stop(message||'La partida por Bluetooth terminó.');}
}
function openOnline(){
  releaseAll();
  if(!online)refreshBluetooth();
  updateOnline();onlineDialog.hidden=false;
  (online?document.getElementById('online-close'):
    document.querySelector('#online-setup button:not([hidden])'))?.focus();
}
function closeOnline(){onlineDialog.hidden=true;onlineButton.focus();}
// Reiniciar and Cargar: a cold engine and audio producer; checkpoint is the
// saved text or null for the reset vector; net {role, options} plays online.
function start(checkpoint=null,net=null){
  if(ckSaving!==null){clearTimeout(ckSaving);ckSaving=null;}
  enable(false);closeSession();worker?.terminate();
  game={credits:0,readyToStart:false,inGame:false};current=null;
  match.reset();twoPending=null;clearTimeout(turnTimer);
  turnBanner.hidden=true;resultBox.hidden=true;
  pending=null;drawn=0;ctx2d.clearRect(0,0,256,224);halt.hidden=true;
  updateHint();status.textContent='cargando…';
  worker=new Worker(new URL('engine.worker.mjs'+location.search,import.meta.url),
    {type:'module'});
  // Reiniciar rebuilds the Z80 session and the chips with the engine.
  startAudio();
  // After the audio port: a loaded state restores the producer first.
  worker.postMessage({type:'boot',checkpoint,options:net?.options??chosen,
    net:net&&{role:net.role}});
  if(online){online.ready=false;online.owner='host';}
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
          (audioNote?' · '+audioNote:'')+
          (performance.now()<ckNoteUntil?' · '+ckNote:'')+
          (netPlaying()?' · Bluetooth':'');
        drawn=0;audioStats();break;
      case 'audio-stop':audioDead=data.code;audioStop(data.code);break;
      case 'audio-clock-lost':log('AO_AUDIO_CLOCK_LOST',data);break;
      case 'ready':
        log('AO_READY',data);current=data.options??null;
        toEngine({type:'p1-repeat',fire:autofire});
        if(online&&data.net){
          online.ready=true;
          for(const m of online.inbox.splice(0))toEngine({type:'net',m});
        }
        updateHint();break;
      case 'engine':engineMessage(data.message);break;
      case 'game-state':
        game=data;matchEvents(data);checkTwoPlayers();
        // Online the host puts the two credits in and starts, once.
        if(netPlaying()&&online.role==='host'&&!online.started&&game.mode===1){
          online.started=true;beginTwoPlayers();
        }
        enable(playable);updateHint();break;
      case 'check':log('AO_CHECK',data);status.textContent='check '+data.frames;break;
      case 'input-probe':log('AO_INPUT',data);break;
      case 'halt':log('AO_HALT',data);stop('Motor detenido: '+data.status);break;
      case 'error':log('AO_ERROR',data);stop('Error: '+data.message);break;
      case 'checkpoint':savedCheckpoint(data);break;
      case 'checkpoint-failed':savedCheckpoint(null,data.code);break;
    }
  };
  worker.onerror=e=>{
    log('AO_ERROR',{message:e.message,filename:e.filename,lineno:e.lineno});
    stop('Error: '+e.message);
  };
}

// Fire and Jump answer in the whole zone around them: the nearer button
// takes the finger, and a finger that slides to the other one changes button.
const actionZone=document.getElementById('button-stack');
const actionButtons=[...actionZone.querySelectorAll('[data-hold]')];
const ACTION_KEEP=14; // px the held button keeps past the middle
const actionFingers=new Map(); // pointerId -> button
function actionAt(e,current){
  let best=null,nearest=Infinity;
  for(const button of actionButtons){
    const r=button.getBoundingClientRect();
    const d=Math.hypot(Math.max(r.left-e.clientX,0,e.clientX-r.right),
      Math.max(r.top-e.clientY,0,e.clientY-r.bottom))-(button===current?ACTION_KEEP:0);
    if(d<nearest){nearest=d;best=button;}
  }
  return best;
}
function actionMove(e,current){
  const button=actionAt(e,current);
  if(button===current||button.disabled)return;
  actionFingers.set(e.pointerId,button);
  controls.hold(e.pointerId,button.dataset.hold);
}
actionZone.addEventListener('pointerdown',e=>{
  if(e.button!==0||actionFingers.has(e.pointerId))return;
  e.preventDefault();
  actionZone.setPointerCapture(e.pointerId);
  actionMove(e,null);
});
actionZone.addEventListener('pointermove',e=>{
  if(actionFingers.has(e.pointerId))actionMove(e,actionFingers.get(e.pointerId));
});
for(const event of ['pointerup','pointercancel','lostpointercapture'])
  actionZone.addEventListener(event,e=>actionFingers.delete(e.pointerId));
document.getElementById('layout').addEventListener('pointerdown',e=>{
  const button=e.target.closest('[data-hold],[data-pulse]');
  if(!button||button.disabled||e.button!==0)return;
  e.preventDefault();
  if(button.dataset.pulse)return pulse(button.dataset.pulse);
  button.setPointerCapture(e.pointerId);
  controls.hold(e.pointerId,button.dataset.hold);
});
const pulse=key=>controls.pulse(key==='start1'&&game.canContinue?'continue1':key);
const release=e=>{if(e.pointerId!==stick?.id)controls.release(e.pointerId);};
// A held key is one more finger; Coin and Start obey their buttons' state.
document.addEventListener('keydown',e=>{
  // A dialog keeps the keyboard; Escape closes it.
  if(!optionsDialog.hidden||!onlineDialog.hidden){
    if(e.key==='Escape'){e.preventDefault();optionsDialog.hidden?closeOnline():closeOptions();}
    return;
  }
  const action=keyAction(e);if(!action)return;
  e.preventDefault();if(e.repeat)return;
  if(action.hold)controls.hold('key:'+e.code,action.hold);
  else if(online)return; // online: only the game controls
  else if(action.pulse){
    const button=buttons.find(b=>b.dataset.pulse===action.pulse);
    if(!button.disabled)pulse(action.pulse);
  }else if(action.command==='twoPlayers')startTwoPlayers();
  else if(action.command==='save')saveCheckpoint();
  else if(action.command==='load')loadCheckpoint();
  else saveCheckpoint(true);
});
// Any key up: a modifier pressed meanwhile must not leave a hold stuck.
document.addEventListener('keyup',e=>controls.release('key:'+e.code));
for(const event of ['pointerup','pointercancel','lostpointercapture'])
  document.addEventListener(event,release);
const releaseAll=()=>{restStick();controls.releaseAll();};
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
document.getElementById('restart').addEventListener('click',()=>start());
twoButton.addEventListener('click',startTwoPlayers);
document.getElementById('result-ok').addEventListener('click',()=>{resultBox.hidden=true;});
againButton.addEventListener('click',()=>{
  if(againButton.disabled)return;
  if(netPlaying())beginTwoPlayers();else startTwoPlayers();
});
onlineButton.addEventListener('click',openOnline);
document.getElementById('online-close').addEventListener('click',closeOnline);
onlineDialog.addEventListener('click',e=>{if(e.target===onlineDialog)closeOnline();});
document.getElementById('bt-host').addEventListener('click',()=>connect(c=>c.host()));
document.getElementById('bt-join').addEventListener('click',()=>{
  const address=document.getElementById('bt-device').value;
  if(address)connect(c=>c.join(address));
});
document.getElementById('bt-permission').addEventListener('click',()=>{
  try{if(!bluetoothBridge()?.requestPermission())refreshBluetooth();}catch{refreshBluetooth();}
});
document.getElementById('online-leave').addEventListener('click',()=>{
  const playing=netPlaying();
  endOnline('Desconectado.',true);
  if(playing)closeOnline();
});
onlineButton.hidden=!bluetoothUsable();
function openOptions(){
  releaseAll();
  for(const [name,value] of Object.entries(chosen))
    optionsForm.elements[name].value=String(value);
  optionsForm.elements.autofire.value=autofire?'1':'0';
  document.getElementById('options-current').textContent=
    current?'Partida actual: '+describeOptions(current):'';
  optionsDialog.hidden=false;
  optionsForm.querySelector('input:checked')?.focus();
}
function closeOptions(){optionsDialog.hidden=true;optionsButton.focus();}
optionsButton.addEventListener('click',openOptions);
document.getElementById('options-cancel').addEventListener('click',closeOptions);
optionsDialog.addEventListener('click',e=>{if(e.target===optionsDialog)closeOptions();});
optionsForm.addEventListener('change',e=>{
  if(e.target.name!=='autofire')return;
  autofire=e.target.value==='1';
  try{localStorage.setItem(AUTOFIRE_KEY,autofire?'1':'0');}
  catch(err){log('AO_OPTIONS_NOT_STORED',{message:String(err?.message??err)});}
  log('AO_AUTOFIRE',{autofire});
  toEngine({type:'p1-repeat',fire:autofire});
});
optionsForm.addEventListener('submit',e=>{
  e.preventDefault();
  const f=optionsForm.elements;
  chosen=gameOptions({difficulty:f.difficulty.value,lives:Number(f.lives.value),
    enemyPace:Number(f.enemyPace.value)});
  try{localStorage.setItem(OPTIONS_KEY,JSON.stringify(chosen));}
  catch(err){log('AO_OPTIONS_NOT_STORED',{message:String(err?.message??err)});}
  log('AO_OPTIONS',chosen);
  optionsDialog.hidden=true;
  start();
});
ckSave.addEventListener('click',()=>saveCheckpoint());
ckLoad.addEventListener('click',loadCheckpoint);
ckRequest('readonly',store=>store.get(CK_KEY)).then(slot=>{
  if(slot?.text){ckSaved={frame:slot.frame,savedAt:slot.savedAt};updateCheckpoint();}
},e=>log('AO_CK_DB_UNAVAILABLE',{message:String(e?.message??e)}));
soundButton.addEventListener('click',toggleSound);
if(new URLSearchParams(location.search).has('audioTest'))
  window.aoTestStall=ms=>worker.postMessage({type:'test-stall',ms});
function draw(){
  if(pending){
    ctx2d.putImageData(new ImageData(new Uint8ClampedArray(pending.rgba),256,224),0,0);
    if(session!==null)measureAv(pending.index);
    pending=null;drawn++;
  }
  requestAnimationFrame(draw);
}
start();requestAnimationFrame(draw);
