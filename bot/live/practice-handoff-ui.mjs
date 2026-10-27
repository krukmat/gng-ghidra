/** Loopback-only practice overlay. Engine and game HTTP are untouched.
 * The game iframe stays loaded while its own process is OS-paused.
 */
import {createServer} from 'node:http';
const html = [
'<!doctype html><html lang="es"><meta charset="utf-8">',
'<title>GnG — Entrenamiento del islote</title>',
'<style>body{background:#101522;color:white;font:16px system-ui;',
'text-align:center;margin:16px} iframe{width:870px;height:650px;',
'border:1px solid #54627e;background:#161b28}',
'#bar{margin:8px auto;padding:10px;border-radius:8px;',
'background:#263148;max-width:830px}',
'button{padding:14px 25px;font-size:19px;cursor:pointer}',
'#resume{display:none}small{display:block;margin:10px}</style>',
'<h2>Entrenamiento: salto al islote</h2>',
'<div id="bar">Reproduciendo recorrido automático…</div>',
'<button id="resume">Reanudar y jugar</button>',
'<small>Flechas: mover · Z: ataque · X: salto. ',
'Ctrl+C en la terminal para terminar.</small>',
'<iframe id="game" src="http://127.0.0.1:18609/" title="GnG real"></iframe>',
'<script>',
'const bar=document.getElementById("bar"),',
' button=document.getElementById("resume"),',
' game=document.getElementById("game");',
'let done=false;',
'async function tick(){if(done)return;try{',
'const r=await fetch("/status",{cache:"no-store"});const s=await r.json();',
'if(s.phase==="FROZEN"){',
'bar.textContent="Checkpoint identificado. Motor PAUSADO: pulsa para jugar.";',
'button.style.display="inline-block";',
'}else if(s.phase==="STOP"){',
'bar.textContent="Checkpoint rechazado: "+s.reason;',
'button.style.display="none";',
'}else bar.textContent="Estado: "+s.phase;',
'}catch{bar.textContent="Sin conexión con el controlador"}}',
'button.addEventListener("click",async()=>{',
'button.disabled=true;try{game.focus();game.contentWindow?.focus();',
'const r=await fetch("/resume",{method:"POST",',
'headers:{"Content-Type":"application/json"},body:"{}"});',
'if(!r.ok)throw Error("RESUME_"+r.status);',
'done=true;button.style.display="none";',
'bar.textContent="JUGANDO — controla a Arthur";',
'game.focus();game.contentWindow?.focus();',
'}catch(e){button.disabled=false;bar.textContent=String(e)}});',
'setInterval(tick,500);tick();</script></html>'
].join('');
export function createPracticeHandoffUI({port=18610,onResume,readStatus}={}){
  if(typeof onResume!=='function'||typeof readStatus!=='function'||
     !Number.isSafeInteger(port)||port<0||port>65535)
    throw Error('BOT_PRACTICE_UI_OPTIONS');
  const server=createServer(async(req,res)=>{
    const path=new URL(req.url,'http://127.0.0.1').pathname;
    const reply=(code,body,type='application/json')=>{
      res.writeHead(code,{'Content-Type':type,'Cache-Control':'no-store',
        'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY'});
      res.end(body);
    };
    if(req.method==='GET'&&path==='/')
      return reply(200,html,'text/html; charset=utf-8');
    if(req.method==='GET'&&path==='/status')
      return reply(200,JSON.stringify(readStatus()));
    if(req.method==='POST'&&path==='/resume'){
      if(req.headers.origin&&req.headers.origin!==
        'http://127.0.0.1:'+server.address().port)
        return reply(403,JSON.stringify({error:'ORIGIN_REJECTED'}));
      if(readStatus().phase!=='FROZEN')
        return reply(409,JSON.stringify({error:'NOT_FROZEN'}));
      try{await onResume();
        return reply(200,JSON.stringify({status:'RESUMED'}));}
      catch(error){return reply(500,JSON.stringify({error:String(error.message??error)}))}
    }
    return reply(404,JSON.stringify({error:'NOT_FOUND'}));
  });
  return {
    async start(){
      await new Promise((resolve,reject)=>{
        server.once('error',reject);
        server.listen(port,'127.0.0.1',resolve);
      });
      return 'http://127.0.0.1:'+server.address().port;
    },
    close:()=>new Promise(resolve=>{
      if(!server.listening)return resolve();
      server.close(resolve);
    })
  };
}
