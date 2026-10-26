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

const ROOT=resolve(fileURLToPath(import.meta.url),'../..');
// Use the offline-discovered gameplay bundle when available. Otherwise
// run the verified B2A Coin1 build; missing AOT blocks stop the CPU.
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
      r.frozen_determinism==='PASS_TWO_FROZEN_1000_FRAME_RUNS';
  }catch{return false;}
}
const BUNDLE=b2bReady()?B2B:B2A;
const ZIP=join(ROOT,'roms/gng.zip');
const PORT=18609;
const live=createLiveControls();
const {inputs,apply:applyControl,release:releaseAll,snapshot:heldControls}=live;
// 600 frames is the B2A *certification* horizon, not a live session.
// A bounded 6000-frame (~100 s at 60 fps) session avoids unbounded
// storage in the frozen board's per-frame record history. Reset is a
// genuine cold restart of that engine, never a playback or state injection.
const SESSION_FRAMES=6000;
let advance=null,worker=null,generation=0;
let frame=null,latest=0,known=false,cycle=0,unknownBytes=null,source=null;
let lastGood=0,blocks=0,halt=null;
let reads={all:0,coin:0,start:0,p1:0};
const state=()=>({schema:'gng.v3.live-engine.v1',mode:'REAL_AOT',
  frame:latest,lastRenderedFrame:lastGood,frameKnown:known,
  unknownBytes,cycle,blocks,reads,source,halt,controls:heldControls(),
  sessionFrames:SESSION_FRAMES,sessionId:generation});
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
<canvas id="screen" width="256" height="224"></canvas>
<p><kbd>5</kbd> Coin · <kbd>1</kbd> Start ·
<kbd>←↑↓→</kbd> Dirección · <kbd>Z</kbd> Ataque ·
<kbd>X</kbd> Salto</p>
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
let last=-1,fetching=false,sessionId=null;
const canvas=document.getElementById('screen'),ctx=canvas.getContext('2d');
const status=document.getElementById('status'),detail=document.getElementById('detail');
function send(control,pressed){fetch('/input',{method:'POST',
headers:{'Content-Type':'application/json'},body:JSON.stringify({control,pressed})}).catch(()=>{});}
document.addEventListener('keydown',e=>{
 const control=map[e.code];if(!control)return;e.preventDefault();
 if(!e.repeat)send(control,true);
});
document.addEventListener('keyup',e=>{
 const control=map[e.code];if(!control)return;e.preventDefault();send(control,false);
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
   if(sessionId!==s.sessionId){
     sessionId=s.sessionId;last=-1;ctx.clearRect(0,0,256,224);
   }
   status.textContent=s.halt?'Motor detenido: '+s.halt.status:
     s.frameKnown?'Ejecutando GnG real — frame '+s.frame:
     'CPU real en ejecución — esperando vídeo completamente conocido';
   detail.textContent='Sesión: '+s.sessionId+' · Límite: '+s.sessionFrames+' frames\\n'+
     'Frames: '+s.frame+' · Último render válido: '+
     s.lastRenderedFrame+' · Bloques AOT: '+s.blocks+'\n'+
     'Lecturas Coin: '+s.reads.coin+' · Start: '+s.reads.start+
     ' · P1: '+s.reads.p1+
     (s.halt?'\nDetención: '+JSON.stringify(s.halt):'');
   if(s.lastRenderedFrame>0&&s.lastRenderedFrame!==last){
     const r=await fetch('/pixels?frame='+s.lastRenderedFrame,{cache:'no-store'});
     if(r.ok){
       const bytes=new Uint8ClampedArray(await r.arrayBuffer());
       if(bytes.length===256*224*4){
         ctx.putImageData(new ImageData(bytes,256,224),0,0);
         last=s.lastRenderedFrame;
       }
     }
   }
 }catch(e){status.textContent='No hay conexión con el runtime real';}
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
  console.log('V3_B2C_AOT_BUNDLE='+ (BUNDLE===B2B?'B2B':'B2A'));
  const launch=()=>{
    const id=++generation;
    releaseAll();
    frame=null;latest=0;known=false;cycle=0;unknownBytes=null;
    source=null;lastGood=0;blocks=0;halt=null;
    reads={all:0,coin:0,start:0,p1:0};
    advance=new Int32Array(new SharedArrayBuffer(4));
    const ack=advance;
    const fresh=new Worker(new URL('./v3_b2c_engine_worker.mjs',import.meta.url),
      {workerData:{bundle:BUNDLE,zip:ZIP,inputs:inputs.buffer,
        advance:ack.buffer,sessionFrames:SESSION_FRAMES}});
    worker=fresh;
    let lastTickTime=Date.now();
    let firstRealFrame=false,firstCoinRead=false;
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
        if(m.rgba){
          frame=Buffer.from(m.rgba);
          if(!firstRealFrame){
            firstRealFrame=true;
            console.log('V3_B2C_FIRST_FRAME=PASS_REAL_AOT_RENDER frame='+m.index);
          }
        }
        if(m.coinReads>0&&!firstCoinRead){
          firstCoinRead=true;
          console.log('V3_B2C_COIN=PASS_REAL_CPU_READ frame='+m.index);
        }
        const wait=Math.max(0,17-(Date.now()-lastTickTime));
        setTimeout(()=>{
          if(id!==generation)return;
          lastTickTime=Date.now();
          Atomics.add(ack,0,1);Atomics.notify(ack,0);
        },wait);
      }
      if(m.type==='halt'||m.type==='error'){
        halt=m;
        console.error('V3_B2C_ENGINE='+m.type.toUpperCase()+'_'+
          (m.status??m.code));
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
        if(!frame){respond(res,204,'');return}
        if(String(lastGood)!==u.searchParams.get('frame')){
          respond(res,409,JSON.stringify({status:'FRAME_ADVANCED'}));return;
        }
        respond(res,200,frame,'application/octet-stream');return;
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
        if(!data||Object.keys(data).length!==2||
           !applyControl(data.control,data.pressed)){
          respond(res,422,JSON.stringify({ok:false}));return;
        }
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
