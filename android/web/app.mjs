/** AO-2 page: draws the frames the engine worker transfers and logs AO_*
 * JSON lines to the console, which Playwright (Mac) and logcat (Android) read.
 */
const canvas=document.getElementById('screen');
const ctx=canvas.getContext('2d',{alpha:false});
const status=document.getElementById('status');
const log=(tag,data)=>console.log(tag+' '+JSON.stringify(data));
const worker=new Worker(new URL('engine.worker.mjs'+location.search,import.meta.url),
  {type:'module'});
let pending=null,drawn=0;

worker.onmessage=({data})=>{
  switch(data?.type){
    case 'frame':pending=data;break; // older undrawn frames are dropped
    case 'stats':
      log('AO_STATS',{...data,drawn});
      status.textContent=drawn+' fps · cpu '+
        (data.cpuMs/Math.max(1,data.windowFrames)).toFixed(2)+' ms · render '+
        (data.renderMs/Math.max(1,data.rendered)).toFixed(2)+' ms';
      drawn=0;break;
    case 'ready':log('AO_READY',data);status.textContent='';break;
    case 'check':log('AO_CHECK',data);status.textContent='check '+data.frames;break;
    case 'halt':log('AO_HALT',data);status.textContent='detenido: '+data.status;break;
    case 'error':log('AO_ERROR',data);status.textContent='error: '+data.message;break;
  }
};
worker.onerror=e=>{
  log('AO_ERROR',{message:e.message,filename:e.filename,lineno:e.lineno});
  status.textContent='error: '+e.message;
};
function draw(){
  if(pending){
    ctx.putImageData(new ImageData(new Uint8ClampedArray(pending.rgba),256,224),0,0);
    pending=null;drawn++;
  }
  requestAnimationFrame(draw);
}
requestAnimationFrame(draw);
