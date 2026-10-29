#!/usr/bin/env node
/** Web checkpoint end-to-end check: starts the live server, drives the page
 * in Playwright's headless Chromium (no window, focus or operator keyboard),
 * plays Coin/Start, saves with G, keeps playing, loads with C and plays on.
 * PASS = the loaded session's tape (checkpoint prefix + new inputs) replays
 * from reset to the same frame hash, and audio keeps producing without STOP.
 * The operator's quick.json is restored afterwards.
 * Usage: node scripts/checkpoint_web_check.mjs [out dir]
 */
import {execFileSync,spawn} from 'node:child_process';
import {copyFileSync,existsSync,mkdirSync,renameSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-core';

const ROOT=resolve(fileURLToPath(import.meta.url),'../..');
const OUT=resolve(process.argv[2]??join(ROOT,'out/web-checkpoint/check'));
const BASE='http://127.0.0.1:18609';
const QUICK=join(ROOT,'out/web-checkpoint/quick.json'),BACKUP=QUICK+'.check-backup';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const fail=s=>{throw Error('CK_CHECK_'+s);};
const get=async p=>(await fetch(BASE+p,{cache:'no-store'})).json();
const until=async(what,test,ms)=>{
  const end=Date.now()+ms;
  for(;;){
    const s=await get('/state');
    if(s.halt)fail('ENGINE_HALT_'+(s.halt.status??s.halt.code));
    if(test(s))return s;
    if(Date.now()>end)fail('TIMEOUT_'+what);
    await sleep(100);
  }
};

if(await fetch(BASE+'/state').then(()=>true,()=>false))fail('PORT_BUSY');
mkdirSync(OUT,{recursive:true,mode:0o700});
if(existsSync(QUICK))renameSync(QUICK,BACKUP);
const server=spawn(process.execPath,[join(ROOT,'scripts/v3_b2c_live.mjs'),'--serve'],
  {cwd:ROOT,stdio:['ignore','pipe','pipe']});
const log=[];
for(const s of [server.stdout,server.stderr])
  s.on('data',d=>log.push(...String(d).split('\n').filter(Boolean)));
let browser=null;
const report={status:'RUNNING'};
try{
  for(let i=0;!log.some(l=>l.startsWith('V3_B2C_REAL_ENGINE=STARTED'));i++){
    if(server.exitCode!==null||i>1800)fail('SERVER_START '+log.slice(-3).join(' | '));
    await sleep(100);
  }
  browser=await chromium.launch({channel:'chromium',headless:true,
    args:['--autoplay-policy=no-user-gesture-required']});
  const page=await browser.newPage({viewport:{width:900,height:900}});
  await page.goto(BASE+'/');
  await until('PAUSE',s=>s.operatorPause,60000);
  await page.click('#audio-enable');
  await page.click('#coin');
  // Start is credited only once the game shows PRESS START after the coin.
  await sleep(3000);
  await page.click('#start');
  await sleep(2000);
  await page.click('#start');
  const playing=await until('GAME',s=>s.frame>0,10000);
  await until('PLAY',s=>s.frame>=playing.frame+600,60000);

  await page.keyboard.press('KeyG');
  let saved=null;
  for(let i=0;i<50&&!saved?.exists;i++){await sleep(100);saved=await get('/checkpoint');}
  if(!saved?.exists||saved.invalid)fail('SAVE '+JSON.stringify(saved));
  report.savedFrame=saved.frame;
  await page.locator('#screen').screenshot({path:join(OUT,'1-saved.png')});
  const before=await get('/state');
  await until('AFTER_SAVE',s=>s.frame>=saved.frame+180,30000);

  await page.keyboard.press('KeyC');
  const loaded=await until('LOAD',s=>s.sessionId===before.sessionId+1&&
    s.deliveredFrame>saved.frame,30000);
  report.firstLoadedFrame=loaded.deliveredFrame;
  await page.locator('#screen').screenshot({path:join(OUT,'2-loaded.png')});
  // New inputs after the load must also replay from reset.
  await page.keyboard.down('ArrowRight');await sleep(1500);
  await page.keyboard.up('ArrowRight');
  await page.keyboard.down('KeyZ');await sleep(150);await page.keyboard.up('KeyZ');
  const startAudio=(await get('/state')).audio;
  await sleep(4000);
  const end=await get('/state');
  await page.locator('#screen').screenshot({path:join(OUT,'3-played.png')});
  report.endFrame=end.frame;
  report.audio={stop:end.audio.stop,producedDelta:end.audio.producedSamples-
    startAudio.producedSamples,nonzero:end.audio.nonzeroSamples,
    worklet:end.audio.worklet?.state??null,
    missingOutputSamples:end.audio.worklet?.missingOutputSamples??null};
  if(end.audio.stop)fail('AUDIO_STOP_'+end.audio.stop);
  if(report.audio.producedDelta<3*62500)fail('AUDIO_NOT_PRODUCING');

  const tape=await get('/tape');
  const file=join(OUT,'loaded-session-tape.json');
  writeFileSync(file,JSON.stringify(tape),{mode:0o600});
  report.tapeChanges=tape.changes.length;
  const replay=execFileSync(process.execPath,[join(ROOT,'scripts/v3_b3_live_replay.mjs'),file],
    {cwd:ROOT,encoding:'utf8'});
  report.replay=replay.trim().split('\n').filter(l=>/PASS|FAIL|MISMATCH/.test(l));
  if(!/PASS/.test(replay))fail('REPLAY '+replay.trim().slice(-200));
  report.status='PASS';
}catch(e){report.status='FAIL';report.error=e.message;report.serverLog=log.slice(-15);}
finally{
  await browser?.close();
  server.kill();
  if(existsSync(QUICK))copyFileSync(QUICK,join(OUT,'quick.json'));
  rmSync(QUICK,{force:true});
  if(existsSync(BACKUP))renameSync(BACKUP,QUICK);
  writeFileSync(join(OUT,'report.json'),JSON.stringify(report,null,2)+'\n');
  console.log('CK_WEB_CHECK='+report.status+' '+JSON.stringify(report));
  process.exitCode=report.status==='PASS'?0:1;
}
