#!/usr/bin/env node
/** GnG's *real* live AOT engine, served only on loopback.
 * Not a capture player, fake scene or MAME emulator.
 * HTTP and keyboard events run on main Node thread, CPU on worker thread.
 */
import {createServer} from 'node:http';
import {Worker} from 'node:worker_threads';
import {resolve,join} from 'node:path';
import {existsSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createLiveControls} from '../src/v3_b2c_live_controls.mjs';
import {LIVE_FRAMES} from '../src/v3_b2c_session_policy.mjs';
import {loadFrozen} from '../src/v2_b1_frozen.mjs';
import {b2dCertified} from '../src/v3_b2d_selection.mjs';
import {b2eCertified} from '../src/v3_b2e_selection.mjs';
import {selectB3Bundle} from '../src/v3_b3_bundle.mjs';
import {createVisibleFrameGate} from '../src/v3_b2c_visible_gate.mjs';

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
let frame=null,latest=0,known=false,cycle=0,unknownBytes=null,source=null;
let pixelProbe=null,displayedServerFrame=0;
let lastGood=0,blocks=0,halt=null;
let reads={all:0,coin:0,start:0,p1:0},busWitness=null;
const state=()=>({schema:'gng.v3.live-engine.v1',mode:'REAL_AOT',
  frame:latest,lastRenderedFrame:lastGood,frameKnown:known,
  unknownBytes,cycle,blocks,reads,busWitness,pixelProbe,
  deliveredFrame:displayedServerFrame,source,halt,controls:heldControls(),
  sessionFrames:SESSION_FRAMES,sessionId:generation,
  operatorPause:operatorGate?.snapshot().paused??false});
const html=`<!doctype html><html lang="es"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Ghosts 'n Goblins — Motor MC6809 AOT real</title>
<style>
:root{background:#0d131e;color:#e8ecf3;font:15px system-ui}
main{max-width:830px;margin:25px auto;padding:0 16px}h1{font-size:1.3rem}
canvas{width:min(100%,768px);aspect-ratio:256/224;image-rendering:pixelated;
background:#050505;border:1px solid #657087}
small,footer{color:#aeb9ca}pre{font:12px ui-monospace,monospace;
overflow-wrap:anywhere;white-space:pre-wrap}
kbd{background:#333e51;padding:2px 5px;border-radius:3px}
</style></head><body><main>
<h1>Ghosts 'n Goblins — Motor MC6809 recompilado a JavaScript</h1>
<p id="status">Conectando con el motor real…</p>
<p id="cpu-input">Esperando lecturas de controles por la CPU real…</p>
<p id="video-health">Esperando framebuffer RGBA del motor…</p>
<canvas id="screen" width="256" height="224"></canvas>
<p><kbd>5</kbd> Coin · <kbd>1</kbd> Start ·
<kbd>←↑↓→</kbd> Dirección · <kbd>Z</kbd> Ataque ·
<kbd>X</kbd> Salto</p>
<p><button id="coin" type="button">Insertar moneda (puerto SYSTEM)</button>
<button id="start" type="button">Start 1P (puerto SYSTEM)</button>
<button id="continue" type="button">Continuar demostración sin moneda</button></p>
<p id="interaction-window">Al aparecer el primer fotograma, el motor espera la moneda (CPU pausada en VBlank real).</p>
<p><button id="restart" type="button">Reiniciar GnG desde reset</button></p>
<pre id="detail"></pre>
<footer>Los píxeles provienen exclusivamente del compositor aplicado
al estado de vídeo producido por la CPU AOT real.
Si faltan bloques o memoria conocida, el motor se bloquea o retiene
el último frame verificado. No hay imágenes pregrabadas ni MAME en ejecución.</footer>
<script>
const map={Digit5:'coin1',Digit1:'start1',
ArrowLeft:'p1.left',ArrowRight:'p1.right',
ArrowUp:'p1.up',ArrowDown:'p1.down',KeyZ:'p1.button1',KeyX:'p1.button2'};
let last=-1,fetching=false,sessionId=null,paintedCount=0;
const canvas=document.getElementById('screen'),ctx=canvas.getContext('2d');
const status=document.getElementById('status'),detail=document.getElementById('detail'),
  cpuInput=document.getElementById('cpu-input'),
  videoHealth=document.getElementById('video-health');
function send(control,pressed){fetch('/input',{method:'POST',
headers:{'Content-Type':'application/json'},body:JSON.stringify({control,pressed})}).catch(()=>{});}
document.addEventListener('keydown',e=>{
 const control=map[e.code];if(!control)return;e.preventDefault();
 if(!e.repeat)send(control,true);
});
document.addEventListener('keyup',e=>{
 const control=map[e.code];if(!control)return;e.preventDefault();send(control,false);
});
// Direct human-initiated button presses, not scripted gameplay.
 // The browser holds the active-low hardware bit briefly, then releases it.
 // Only a real MC6809 bus read can generate a PASS marker.
function pulse(control){
  send(control,true);
  setTimeout(()=>send(control,false),400);
}
document.getElementById('coin').addEventListener('click',()=>pulse('coin1'));
document.getElementById('start').addEventListener('click',()=>pulse('start1'));
document.getElementById('continue').addEventListener('click',async()=>{
  const response=await fetch('/continue',{method:'POST'});
  if(!response.ok)status.textContent='No se pudo continuar la ejecución';
});
window.addEventListener('blur',()=>fetch('/release',{method:'POST'}).catch(()=>{}));
document.getElementById('restart').addEventListener('click',async()=>{
 try{
   const response=await fetch('/reset',{method:'POST'});
   if(!response.ok)throw Error('RESET_REJECTED');
   ctx.clearRect(0,0,256,224);
   last=-1;status.textContent='Reiniciando CPU MC6809 desde reset…';
 }catch{status.textContent='No se pudo reiniciar el motor';}
});
async function tick(){
 if(fetching)return;fetching=true;
 try{
   const s=await (await fetch('/state',{cache:'no-store'})).json();
   document.getElementById('coin').disabled=Boolean(s.halt);
   document.getElementById('start').disabled=Boolean(s.halt);
   document.getElementById('continue').disabled=Boolean(s.halt)||!s.operatorPause;
   document.getElementById('interaction-window').textContent=s.operatorPause?
     'CPU pausada en VBlank real: inserta moneda o continúa la demostración.':
     'CPU ejecutándose: Coin y Start se transmiten al bus MC6809.';
   if(sessionId!==s.sessionId){
     sessionId=s.sessionId;last=-1;paintedCount=0;
     ctx.clearRect(0,0,256,224);
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
  console.log('V3_B2C_AOT_BUNDLE='+ (BUNDLE===B3?'B3_G'+B3_SELECTED.generation:BUNDLE===B2E?'B2E':BUNDLE===B2D?'B2D':BUNDLE===B2B?'B2B':'B2A'));
  const launch=()=>{
    const id=++generation;
    releaseAll();
    frame=null;latest=0;known=false;cycle=0;unknownBytes=null;
    pixelProbe=null;displayedServerFrame=0;
    source=null;lastGood=0;blocks=0;halt=null;
    reads={all:0,coin:0,start:0,p1:0};busWitness=null;
    advance=new Int32Array(new SharedArrayBuffer(4));
    const ack=advance;
    const gate=createVisibleFrameGate();
    operatorGate=gate;
    const fresh=new Worker(new URL('./v3_b2c_engine_worker.mjs',import.meta.url),
      {workerData:{bundle:BUNDLE,zip:ZIP,inputs:inputs.buffer,
        advance:ack.buffer,sessionFrames:SESSION_FRAMES}});
    worker=fresh;
    let lastTickTime=Date.now();
    let firstRealFrame=false;
    const firstControlsPrinted=new Set();
    fresh.on('message',m=>{
      if(id!==generation)return; // discard messages from a terminated CPU
      if(m.type==='boot'){
        source=m.source;blocks=m.blocks;
        console.log('V3_B2C_SESSION=STARTED_'+id);
        console.log('V3_B2C_SESSION_FRAMES='+m.sessionFrames);
      }
      if(m.type==='frame'){
        latest=m.index;cycle=m.cycle;known=m.known;unknownBytes=m.unknownBytes;
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
        if(gate.shouldAdvance({index:m.index,known:m.known,
          coinHeld:heldControls().includes('coin1')})){
          const wait=Math.max(0,17-(Date.now()-lastTickTime));
          setTimeout(()=>{
            if(id!==generation)return;
            lastTickTime=Date.now();
            Atomics.add(ack,0,1);Atomics.notify(ack,0);
          },wait);
        }else{
          // Exactly one authentic VBlank is held, without advancing CPU
          // clocks or replacing video. Coin pressed by operator releases it.
          console.log('V3_B2C_OPERATOR_PAUSE=REAL_VBLANK_FRAME_'+m.index);
        }
      }
      if(m.type==='halt'||m.type==='error'){
        halt=m;
        if(m.type==='halt'&&m.witness)busWitness=m.witness;
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
  const coldRestart=()=>{
    const previous=worker,oldAdvance=advance;
    if(previous){
      // Release the old worker's VBlank wait before termination. Neither
      // worker can mutate the other session's CPU state or output.
      if(oldAdvance){Atomics.add(oldAdvance,0,1);Atomics.notify(oldAdvance,0);}
      void previous.terminate().catch(()=>{});
    }
    launch();
    console.log('V3_B2C_RESET=PASS_NEW_COLD_AOT_SESSION id='+generation);
  };
  launch();
  const resumeOperator=()=>{
    if(!operatorGate?.release())return false;
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
      if(req.method==='GET'&&u.pathname==='/state'){
        respond(res,200,JSON.stringify(state()));return;
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
        if(data.control==='coin1'&&data.pressed)resumeOperator();
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
