#!/usr/bin/env node
/** Private Android checkpoint check. Build assets first; Chromium stays
 * headless (no window, no focus, no keyboard). Page = out/android/assets.
 * Coin, Start, Sound ON -> Guardar -> play -> Cargar -> fire -> Guardar.
 * PASS = both checkpoints (the one saved before the load and the one saved
 * after it) are exactly the state their tape reaches from reset: CPU, Z80
 * and YM bytes (WASM) identical; audio keeps PLAYING with no STOP, underrun
 * or missing samples after the load.
 * --android [serial]: same flow in the debug WebView of out/android/gng.apk
 * (installed by adb; run the emulator with -no-window -no-audio).
 * Usage: node scripts/ao_checkpoint_check.mjs [--android [serial]]
 */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {cpSync,mkdirSync,mkdtempSync,readFileSync,rmSync,statSync,writeFileSync} from 'node:fs';
import {homedir,tmpdir} from 'node:os';
import {resolve,join,extname,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {chromium,_android} from 'playwright-core';
import {decodeCheckpoint,CYCLES_PER_FRAME} from '../src/checkpoint_format.mjs';
import {checkpointRuntime} from '../src/checkpoint_runtime.mjs';
import {createAudioCommandSource,applyCommand} from '../src/ao_audio_commands.mjs';
import {loadYm2203} from '../src/ao_ym2203_wasm.mjs';
import {liveTapeReader} from '../src/v3_b3_live_tape.mjs';
import {selectB3Bundle} from '../src/v3_b3_bundle.mjs';
import {prepareAudioBundle} from '../src/gngb_audio_bundle_overlay.mjs';
import {loadFrozen} from '../src/v2_b1_frozen.mjs';

const ROOT=resolve(fileURLToPath(import.meta.url),'../..');
const ASSETS=join(ROOT,'out/android/assets'),CHECK=join(ROOT,'out/android/check');
const android=process.argv.includes('--android');
const serialArg=process.argv[process.argv.indexOf('--android')+1];
const ADB=join(process.env.ANDROID_HOME??join(homedir(),'Library/Android/sdk'),
  'platform-tools/adb');
const PKG=process.env.AO_APP_ID??'org.gng.offline';
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
const report={schema:'gng.ao.checkpoint-check.v1'};
let browser,page,device;
// Touch in headless Chromium; the WebView page takes Playwright clicks.
const press=sel=>android?page.click(sel):page.tap(sel);
const of=(tag,list=logs)=>list.filter(l=>l.tag===tag).map(l=>l.data);
async function until(predicate,what,timeout=30000){
  const end=Date.now()+timeout;
  while(Date.now()<end){
    assert.equal(bad.length,0,bad.join('\n'));
    const hit=logs.find(predicate);if(hit)return hit;
    await page.waitForTimeout(50);
  }
  throw Error('AO_CK_TIMEOUT '+what);
}
const after=(mark,tag)=>l=>l.tag===tag&&logs.indexOf(l)>=mark;
const enabled=id=>page.waitForFunction(id=>!document.getElementById(id).disabled,
  id,{timeout:30000});
const slot=()=>page.evaluate(()=>new Promise((ok,ko)=>{
  const open=indexedDB.open('gng-checkpoint',1);
  open.onerror=()=>ko(open.error);
  open.onsuccess=()=>{
    const req=open.result.transaction('slot').objectStore('slot').get('quick');
    req.onsuccess=()=>{open.result.close();ok(req.result);};
    req.onerror=()=>ko(req.error);
  };
}));
async function save(){
  const mark=logs.length;
  await enabled('ck-save');await press('#ck-save');
  const hit=await until(after(mark,'AO_CK_SAVE'),'save',10000);
  const s=await slot();
  assert.equal(s.frame,hit.data.frame);
  return s;
}
async function fire(times){
  for(let k=0;k<times;k++){await press('#attack');await page.waitForTimeout(250);}
}

// Replays the checkpoint's tape from reset to its frame, as the phone ran it,
// and compares the board, the Z80 source and the YM bytes with the save.
async function verify(text,rt){
  const c=decodeCheckpoint(text,{programSha256:rt.programSha256});
  const source=await createAudioCommandSource(rt.rom);
  const ym=(await loadYm2203(rt.wasm)).create();
  let events=[],frames=0,got=null;
  const cpu=rt.createBoard(rt.code,rt.blocks,{frames:c.frame+1,
    portRead:liveTapeReader(c.tape),
    onAudioEvent:e=>events.push({kind:e.kind,value:e.value,cycle:e.cycle}),
    onAudioComplete:m=>{
      if(m.frames<=frames)return;
      frames=m.frames;
      const {commands}=source.batch(frames*CYCLES_PER_FRAME,events);events=[];
      for(const x of commands)applyCommand(ym,x);
      if(frames===c.frame)got={cpu:structuredClone(cpu.exportState()),
        audio:structuredClone(source.exportState()),ym:ym.save()};
    },
    onFrame:r=>{cpu.state.records[r.index-1]=null;cpu.state.events.length=0;}});
  const status=cpu.run().status;
  ym.destroy();
  assert.equal(status,'FRAMES_DONE');
  assert.ok(got,'replay reached frame '+c.frame);
  assert.deepStrictEqual(got.cpu,c.cpu,'CPU state from reset');
  assert.deepStrictEqual(got.audio,c.audio,'Z80 and audio queue from reset');
  assert.ok(Buffer.from(got.ym).equals(Buffer.from(c.ym)),'YM bytes from reset');
  return {frame:c.frame,tapeChanges:c.tape.length,bytes:text.length};
}
// The replay uses the reference dual-YM WASM (scripts/ao_build_audio_wasm.sh),
// not the base bank in the assets: the save must hold the reference bytes.
function referenceWasm(){
  const dir=join(ROOT,'out/android/audio'),wasm=readFileSync(join(dir,'ym2203.wasm'));
  const build=JSON.parse(readFileSync(join(dir,'build.json'),'utf8'));
  if(createHash('sha256').update(wasm).digest('hex')!==build.sha256)
    throw Error('AO_CK_REFERENCE_WASM_MISMATCH');
  return wasm;
}
async function replayRuntime(){
  const bundle=selectB3Bundle(ROOT);
  if(!bundle)throw Error('AO_CK_B3_BUNDLE_MISSING');
  const {dir}=await prepareAudioBundle(ROOT,bundle.dir);
  const {code,manifest}=loadFrozen(dir);
  const temp=mkdtempSync(join(tmpdir(),'gng-aock-'));
  cpSync(dir,temp,{recursive:true});
  writeFileSync(join(temp,'gngb_runtime.mjs'),
    checkpointRuntime(readFileSync(join(dir,'gngb_runtime.mjs'),'utf8')),{mode:0o600});
  const {blocks}=await import(pathToFileURL(join(temp,'program.mjs')).href);
  const {createBoard}=await import(pathToFileURL(join(temp,'gngb_runtime.mjs')).href);
  rmSync(temp,{recursive:true,force:true});
  return {code,blocks,createBoard,programSha256:manifest.files['program.mjs'],
    rom:Uint8Array.from(readFileSync(join(ROOT,'out/audio/gg2.bin'))),
    wasm:referenceWasm()};
}

try{
  mkdirSync(CHECK,{recursive:true,mode:0o700});
  let url;
  if(android){
    const adb=(...a)=>execFileSync(ADB,['-s',serial,...a],{encoding:'utf8',timeout:120000});
    const list=execFileSync(ADB,['devices'],{encoding:'utf8'}).split('\n').slice(1)
      .map(l=>/^([^\s]+)\s+device$/.exec(l)?.[1]).filter(Boolean);
    const serial=serialArg&&!serialArg.startsWith('-')?serialArg:
      list.length===1?list[0]:null;
    if(!serial||!list.includes(serial))throw Error('AO_CK_DEVICE_SELECT '+list.join(','));
    report.serial=serial;
    adb('install','-r',join(ROOT,'out/android/gng.apk'));
    adb('shell','pm','clear',PKG); // no checkpoint from an earlier run
    adb('shell','am','start','-W','-n',PKG+'/org.gng.offline.MainActivity');
    device=(await _android.devices()).find(d=>d.serial()===serial);
    if(!device)throw Error('AO_CK_PLAYWRIGHT_DEVICE_MISSING');
    page=await (await device.webView({pkg:PKG},{timeout:30000})).page();
    url='https://appassets.androidplatform.net/assets/index.html?ck='+Date.now();
  }else{
    await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
    browser=await chromium.launch({channel:'chromium',headless:true});
    const context=await browser.newContext({viewport:{width:900,height:400},hasTouch:true});
    page=await context.newPage();
    url='http://127.0.0.1:'+server.address().port+'/index.html';
  }
  page.on('console',msg=>{
    const m=/^(AO_\w+) (.*)$/s.exec(msg.text());if(!m)return;
    logs.push({tag:m[1],data:JSON.parse(m[2]),at:Date.now()});
    if(['AO_ERROR','AO_HALT','AO_AUDIO_STOP','AO_AUDIO_RECOVER',
      'AO_CK_SAVE_FAILED','AO_CK_LOAD_FAILED'].includes(m[1]))bad.push(msg.text());
  });
  page.on('pageerror',e=>bad.push(String(e)));
  await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
  await until(l=>l.tag==='AO_AUDIO_READY','audio ready');
  assert.ok(await page.$eval('#ck-load',b=>b.disabled),'no checkpoint yet');
  await enabled('sound');await press('#sound');
  await until(l=>l.tag==='AO_AUDIO_SESSION','session');
  await enabled('coin');await press('#coin');
  await enabled('start');await press('#start');
  await page.waitForFunction(()=>document.getElementById('system-controls').hidden,
    null,{timeout:30000});
  await page.waitForTimeout(6000);
  await fire(3);

  const first=await save();
  report.save1={frame:first.frame};
  await page.waitForTimeout(4000); // keep playing past the save
  const before=of('AO_STATS').at(-1).frames;
  assert.ok(before>first.frame+120,'game went on after the save');

  let mark=logs.length;
  await enabled('ck-load');await press('#ck-load');
  await until(after(mark,'AO_CK_LOAD'),'load');
  await until(after(mark,'AO_AUDIO_READY'),'audio ready after load');
  await until(after(mark,'AO_AUDIO_SESSION'),'session after load');
  // The loaded engine starts at the saved frame, not at reset or later.
  const stats=await until(after(mark,'AO_STATS'),'stats after load');
  assert.ok(stats.data.frames>first.frame&&stats.data.frames<first.frame+120,
    'resumed at the saved frame '+JSON.stringify(stats.data));
  await fire(4);
  await page.waitForTimeout(6000);
  const window=logs.slice(mark);
  const audio=of('AO_AUDIO_STATS',window).filter(a=>a.worklet);
  const w=audio.slice(-5).map(a=>a.worklet);
  assert.ok(w.length&&w.every(x=>x.state==='PLAYING'),'worklet PLAYING after load');
  assert.equal(Math.max(...w.map(x=>x.missing)),0,'no missing samples');
  assert.ok(w.at(-1).outputNonzero>0,'audible after load');
  report.afterLoad={worklet:w.at(-1),producer:audio.at(-1).producer,
    cpuFrames:of('AO_STATS',window).at(-1).frames};

  const second=await save();
  report.save2={frame:second.frame};
  await page.screenshot({path:join(CHECK,android?'ao-checkpoint-android.png':'ao-checkpoint.png')});
  await browser?.close();browser=null;await device?.close();device=null;

  const rt=await replayRuntime();
  report.verify1=await verify(first.text,rt);
  report.verify2=await verify(second.text,rt);
  // The second tape starts with the first one: the load kept the history.
  const t1=JSON.parse(first.text).tape,t2=JSON.parse(second.text).tape;
  assert.deepStrictEqual(t2.slice(0,t1.length),t1,'loaded tape continues the saved one');
  report.status='GO';
}catch(e){
  report.status='STOP';report.error=String(e?.stack??e).slice(0,1500);
  await page?.screenshot({path:join(CHECK,'ao-checkpoint-failed.png')}).catch(()=>{});
}finally{
  writeFileSync(join(CHECK,android?'ao-checkpoint-android-report.json':'ao-checkpoint-report.json'),JSON.stringify(report,null,1),{mode:0o600});
  await browser?.close();await device?.close();server.close();
}
console.log('AO_CHECKPOINT_CHECK='+report.status+' '+JSON.stringify(
  {save1:report.save1,save2:report.save2,verify1:report.verify1,verify2:report.verify2})+
  (report.error?' '+report.error.split('\n')[0]:''));
process.exitCode=report.status==='GO'?0:1;
