/** Offline display and multitouch controls. No keyboard listeners. */
import {createTouchControls,isDirection} from './lib/ao_touch_controls.mjs';

const canvas=document.getElementById('screen');
const ctx=canvas.getContext('2d',{alpha:false});
const status=document.getElementById('status');
const hint=document.getElementById('hint');
const halt=document.getElementById('halt');
const systemControls=document.getElementById('system-controls');
const startButton=document.getElementById('start');
const buttons=[...document.querySelectorAll('[data-hold],[data-pulse]')];
const log=(tag,data)=>console.log(tag+' '+JSON.stringify(data));
let worker=null,pending=null,drawn=0,playable=false;
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
function start(){
  enable(false);fingers.clear();worker?.terminate();
  game={credits:0,readyToStart:false,inGame:false};
  pending=null;drawn=0;ctx.clearRect(0,0,256,224);halt.hidden=true;
  updateHint();status.textContent='cargando…';
  worker=new Worker(new URL('engine.worker.mjs'+location.search,import.meta.url),
    {type:'module'});
  worker.onmessage=({data})=>{
    switch(data?.type){
      case 'frame':
        pending=data;
        if(!playable){enable(true);updateHint();}
        break;
      case 'stats':
        log('AO_STATS',{...data,drawn});
        status.textContent=Math.round(drawn*1000/data.windowMs)+' fps';
        drawn=0;break;
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
document.addEventListener('visibilitychange',()=>{if(document.hidden)releaseAll();});
document.addEventListener('contextmenu',e=>e.preventDefault());
document.getElementById('restart').addEventListener('click',start);
function draw(){
  if(pending){
    ctx.putImageData(new ImageData(new Uint8ClampedArray(pending.rgba),256,224),0,0);
    pending=null;drawn++;
  }
  requestAnimationFrame(draw);
}
start();requestAnimationFrame(draw);
