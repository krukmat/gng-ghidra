#!/usr/bin/env node
/** Private AO-6 check. Build assets first; Chromium stays headless.
 * Boot -> Coin -> Start -> Sound ON mid-game -> ON/OFF x3 -> background and
 * back -> Reiniciar -> Coin -> Start, then a steady window. Every phase is
 * judged on AO_AUDIO_STATS / AO_STATS logs: PCM produced and played, no
 * underrun, bounded queue, CPU at real speed, render >= 30 fps, A/V offset.
 * Usage: node scripts/ao_audio_check.mjs [steadySeconds=60]
 */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync,statSync} from 'node:fs';
import {resolve,join,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-core';

const ROOT=resolve(fileURLToPath(import.meta.url),'../..');
const ASSETS=join(ROOT,'out/android/assets'),CHECK=join(ROOT,'out/android/check');
const STEADY=Number(process.argv[2]??60);
const MIME={'.html':'text/html','.mjs':'text/javascript','.json':'application/json',
  '.bin':'application/octet-stream','.wasm':'application/wasm'};
const server=createServer((req,res)=>{
  try{
    const path=resolve(ASSETS,'.'+new URL(req.url,'http://local').pathname);
    if(!path.startsWith(ASSETS+sep)||!MIME[extname(path)]||!statSync(path).isFile())
      throw Error('NOT_FOUND');
    res.writeHead(200,{'Content-Type':MIME[extname(path)],'Cache-Control':'no-store'});
    res.end(readFileSync(path));
  }catch{res.writeHead(404);res.end();}
});
const logs=[],bad=[];
const report={schema:'gng.ao6.audio-check.v1',phases:{}};
let browser,page;
const since=i=>logs.slice(i);
const of=(tag,list=logs)=>list.filter(l=>l.tag===tag).map(l=>l.data);
async function until(predicate,what,timeout=30000){
  const end=Date.now()+timeout;
  while(Date.now()<end){
    assert.equal(bad.length,0,bad.join('\n'));
    const hit=logs.find(predicate);if(hit)return hit;
    await page.waitForTimeout(50);
  }
  throw Error('AO6_TIMEOUT '+what);
}
const enabled=id=>page.waitForFunction(id=>!document.getElementById(id).disabled,
  id,{timeout:30000});
const tapSound=async()=>{await page.tap('#sound');await page.waitForTimeout(300);};
const soundLabel=()=>page.textContent('#sound');
async function coinStart(){
  await enabled('coin');await page.tap('#coin');
  await enabled('start');await page.tap('#start');
  await page.waitForFunction(()=>document.getElementById('system-controls').hidden,
    null,{timeout:30000});
}
// Summary of a log window: audio and video health.
function judge(list,{playing=true}={}){
  const audio=of('AO_AUDIO_STATS',list),video=of('AO_STATS',list);
  const w=audio.map(a=>a.worklet).filter(Boolean);
  const av=audio.map(a=>a.avMs).filter(Boolean);
  const cpuHz=video.map(v=>v.windowFrames*1000/v.windowMs);
  const fps=video.map(v=>v.drawn*1000/v.windowMs);
  const out={seconds:video.length,
    cpuHz:{min:+Math.min(...cpuHz).toFixed(2),max:+Math.max(...cpuHz).toFixed(2)},
    renderFps:{mean:+(fps.reduce((a,b)=>a+b,0)/fps.length).toFixed(2),
      min:+Math.min(...fps).toFixed(2)},
    slips:video.at(-1)?.slips??null,
    audioPacedFrames:video.reduce((a,v)=>a+(v.audioPaced??0),0),
    maxQueue:Math.max(0,...w.map(x=>x.queued)),
    minQueue:w.length?Math.min(...w.map(x=>x.queued)):null,
    missing:Math.max(0,...w.map(x=>x.missing)),
    outputNonzero:w.at(-1)?.outputNonzero??0,
    producer:audio.at(-1)?.producer??null,
    av:av.length?{mean:+(av.reduce((a,b)=>a+b.mean,0)/av.length).toFixed(1),
      maxAbs:Math.max(...av.map(a=>a.maxAbs))}:null,
    stops:of('AO_AUDIO_STOP',list),recoveries:of('AO_AUDIO_RECOVER',list),
  };
  if(av.length>=10){
    // Drift: least-squares slope of the per-second mean, in ms per minute.
    const t=audio.filter(a=>a.avMs).map(a=>a.t/60000),y=av.map(a=>a.mean);
    const mt=t.reduce((a,b)=>a+b)/t.length,my=y.reduce((a,b)=>a+b)/y.length;
    out.av.driftMsPerMin=+(t.reduce((a,x,i)=>a+(x-mt)*(y[i]-my),0)/
      t.reduce((a,x)=>a+(x-mt)**2,0)).toFixed(2);
  }
  assert.equal(out.stops.length,0,'audio STOP '+JSON.stringify(out.stops));
  assert.equal(out.recoveries.length,0,'underrun '+JSON.stringify(out.recoveries));
  assert.ok(out.cpuHz.min>=58.5&&out.cpuHz.max<=61,'CPU pace '+JSON.stringify(out.cpuHz));
  assert.ok(out.renderFps.min>=30,'render '+JSON.stringify(out.renderFps));
  if(playing){
    assert.ok(w.length&&w.every(x=>x.state==='PLAYING'),'worklet not playing');
    assert.equal(out.missing,0);
    assert.ok(out.maxQueue<=12500,'queue');
    assert.ok(out.av&&Math.abs(out.av.mean)<=100&&out.av.maxAbs<=150,'A/V '+JSON.stringify(out.av));
  }
  return out;
}
const phase=async(name,seconds,opts)=>{
  const i=logs.length;await page.waitForTimeout(seconds*1000);
  report.phases[name]=judge(since(i),opts);
  console.log(name,JSON.stringify(report.phases[name]));
};
try{
  mkdirSync(CHECK,{recursive:true,mode:0o700});
  await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
  browser=await chromium.launch({channel:'chromium',headless:true});
  const context=await browser.newContext({viewport:{width:900,height:400},hasTouch:true});
  page=await context.newPage();
  page.on('console',msg=>{
    const m=/^(AO_\w+) (.*)$/s.exec(msg.text());if(!m)return;
    const entry={tag:m[1],data:JSON.parse(m[2]),at:Date.now()};
    logs.push(entry);
    if(['AO_ERROR','AO_HALT'].includes(m[1]))bad.push(msg.text());
  });
  page.on('pageerror',e=>bad.push(String(e)));
  const t0=Date.now();
  await page.goto('http://127.0.0.1:'+server.address().port+'/index.html?audioTest');
  const ready=await until(l=>l.tag==='AO_AUDIO_READY','audio ready');
  report.audioReadyMs=ready.at-t0;report.audioLoadMs=ready.data.loadMs;
  assert.equal(await soundLabel(),'Sonido OFF');
  await enabled('sound');

  // Producer runs with Sound OFF; nothing reaches the worklet yet.
  await coinStart();
  await phase('offInGame',10,{playing:false});
  const p=report.phases.offInGame.producer;
  assert.ok(p.nonzeroSamples>0&&p.sentSamples===0,'producer while OFF');

  // Sound ON in the middle of a game: one session, prebuffer, then audio pace.
  let mark=logs.length;
  await tapSound();
  assert.equal(await soundLabel(),'Sonido ON');
  const first=await until(l=>l.tag==='AO_AUDIO_SESSION','session');
  await page.waitForTimeout(2000);
  await phase('onMidGame',20);
  assert.ok(report.phases.onMidGame.outputNonzero>0,'audible output');
  assert.ok(report.phases.onMidGame.audioPacedFrames>1000,'audio clock not used');

  // OFF/ON x3: gain only, same session, no STOP.
  for(let k=0;k<3;k++){
    await tapSound();assert.equal(await soundLabel(),'Sonido OFF');
    assert.equal(await page.evaluate(()=>document.getElementById('sound')
      .getAttribute('aria-pressed')),'false');
    await page.waitForTimeout(1500);
    await tapSound();assert.equal(await soundLabel(),'Sonido ON');
    await page.waitForTimeout(1500);
  }
  assert.equal(of('AO_AUDIO_SESSION',since(mark)).length,1,'OFF/ON must keep the session');
  const gains=of('AO_AUDIO_STATS',since(mark)).map(a=>a.gain);
  assert.ok(gains.includes(0)&&gains.at(-1)===1,'gain toggled');
  await phase('afterToggles',5);

  // Background and back: suspended, queue dropped, then a fresh session.
  // Headless tabs never become hidden, so the page's own visibility API is
  // overridden; the real Android lifecycle is checked on the phone.
  const visibility=hidden=>page.evaluate(hidden=>{
    Object.defineProperty(document,'hidden',{configurable:true,get:()=>hidden});
    document.dispatchEvent(new Event('visibilitychange'));
  },hidden);
  mark=logs.length;
  await visibility(true);
  await page.waitForTimeout(3000);
  const hidden=of('AO_AUDIO_STATS',since(mark)).at(-1);
  assert.equal(hidden.context,'suspended');assert.equal(hidden.sessionId,null);
  await visibility(false);
  const back=await until(l=>l.tag==='AO_AUDIO_SESSION'&&l.data.sessionId>first.data.sessionId,
    'session after background');
  report.background={hiddenStats:hidden,newSession:back.data.sessionId};
  await page.waitForTimeout(2000);
  await phase('afterBackground',10);

  // A 400 ms engine stall (test hook) empties the queue: the page must
  // reopen a session by itself, never turn sound off.
  mark=logs.length;
  await page.evaluate(()=>window.aoTestStall(400));
  const recovered=await until(l=>l.tag==='AO_AUDIO_RECOVER'&&logs.indexOf(l)>=mark,
    'recovery after stall',15000);
  assert.equal(of('AO_AUDIO_STOP',since(mark)).length,0,'stall turned sound off');
  await page.waitForTimeout(4000);
  assert.equal(await soundLabel(),'Sonido ON');
  const afterStall=of('AO_AUDIO_STATS',since(mark)).at(-1);
  assert.equal(afterStall.worklet?.state,'PLAYING');
  report.stall={recover:recovered.data,after:afterStall};

  // Reiniciar: new engine, Z80 session and chips; Sound stays ON.
  mark=logs.length;
  await page.tap('#restart');
  await until((l,i)=>l.tag==='AO_AUDIO_READY'&&logs.indexOf(l)>=mark,'ready after restart');
  const restarted=of('AO_AUDIO_SESSION',since(mark));
  assert.equal(restarted.length,1);
  await coinStart();
  await page.waitForTimeout(2000);
  await phase('steady',STEADY);
  report.restartSession=restarted[0].sessionId;
  await page.screenshot({path:join(CHECK,'ao6-audio.png')});
  report.status='GO';
}catch(e){
  report.status='STOP';report.error=String(e?.stack??e).slice(0,1500);
  await page?.screenshot({path:join(CHECK,'ao6-failed.png')}).catch(()=>{});
}finally{
  report.lastAudio=of('AO_AUDIO_STATS').at(-1)??null;
  writeFileSync(join(CHECK,'ao6-report.json'),JSON.stringify(report,null,1),{mode:0o600});
  await browser?.close();server.close();
}
console.log('AO6_AUDIO_CHECK='+report.status+(report.error?' '+report.error.split('\n')[0]:''));
process.exitCode=report.status==='GO'?0:1;
