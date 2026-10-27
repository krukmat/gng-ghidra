#!/usr/bin/env node
/** V3.B3 G2.3: play a B3 tape through the LIVE browser engine, using the
 * same loopback HTTP controls as a human (/continue, /input). Inputs land
 * whenever the paced engine reaches the tape frame, so timing jitters by
 * about a frame, as a human's would. Reports halts and server memory.
 * Usage: node scripts/v3_b3_live_bot.mjs <profile> [lastFrame]
 */
import {spawn,execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {CYCLES_PER_FRAME} from '../src/gngb_runtime.mjs';
import {B3_HORIZONS,b3Tape} from '../src/v3_b3_tapes.mjs';

const ROOT=resolve(fileURLToPath(import.meta.url),'../..');
const BASE='http://127.0.0.1:18609';
const [profile,lastArg]=process.argv.slice(2);
const last=Number(lastArg??B3_HORIZONS[profile]);
if(!profile||!Number.isInteger(last)||last<400||last>B3_HORIZONS[profile])
  throw Error('V3_B3_LIVE_BOT_USAGE');
const events=b3Tape(profile).events.map(e=>({frame:e.cycle/CYCLES_PER_FRAME,
  control:e.control,pressed:e.pressed})).filter(e=>e.frame<last);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const state=async()=>(await fetch(BASE+'/state',{cache:'no-store'})).json();
const post=(path,body)=>fetch(BASE+path,{method:'POST',
  body:body?JSON.stringify(body):undefined});
const rssMiB=pid=>Math.round(Number(execFileSync('ps',['-o','rss=','-p',String(pid)],
  {encoding:'utf8'}).trim())/1024);

const server=spawn(process.execPath,[join(ROOT,'scripts/v3_b2c_live.mjs'),'--serve'],
  {cwd:ROOT,stdio:['ignore','pipe','pipe']});
let log='';
server.stdout.on('data',d=>{log+=d;});
server.stderr.on('data',d=>{log+=d;});
const memory=[];
try{
  let s=null;
  for(let i=0;i<300;i++){
    await sleep(100);
    try{s=await state();}catch{continue;}
    if(s.operatorPause||s.halt)break;
  }
  if(!s?.operatorPause)throw Error('V3_B3_LIVE_BOT_NO_OPERATOR_PAUSE');
  const bundle=/V3_B2C_AOT_BUNDLE=(\S+)/.exec(log)?.[1];
  console.log('V3_B3_LIVE_BOT_BUNDLE='+bundle);
  await post('/continue');
  let next=0,lag=0,lastSample=0;
  for(;;){
    s=await state();
    if(s.halt)break;
    // Apply each event as the engine reaches the frame before it.
    while(next<events.length&&s.frame>=events[next].frame-1){
      const e=events[next++];
      lag=Math.max(lag,s.frame-(e.frame-1));
      const r=await post('/input',{control:e.control,pressed:e.pressed});
      if(r.status!==200)throw Error('V3_B3_LIVE_BOT_INPUT_REJECTED_'+r.status);
    }
    if(s.frame-lastSample>=3000){
      lastSample=s.frame;memory.push([s.frame,rssMiB(server.pid)]);
      console.log('V3_B3_LIVE_BOT_PROGRESS frame='+s.frame+' rss_mib='+memory.at(-1)[1]);
    }
    if(s.frame>=last)break;
    await sleep(4);
  }
  memory.push([s.frame,rssMiB(server.pid)]);
  console.log('V3_B3_LIVE_BOT_FRAME='+s.frame);
  console.log('V3_B3_LIVE_BOT_EVENTS='+next+'/'+events.length+' max_lag_frames='+lag);
  console.log('V3_B3_LIVE_BOT_READS='+JSON.stringify(s.reads));
  console.log('V3_B3_LIVE_BOT_RSS_MIB='+memory.map(m=>m.join(':')).join(','));
  console.log('V3_B3_LIVE_BOT_HALT='+JSON.stringify(s.halt));
  // Exact replayable record of what the CPU read (private, out/).
  const tape=await (await fetch(BASE+'/tape',{cache:'no-store'})).text();
  const dir=join(ROOT,'out/v3/b3/live-tapes');
  mkdirSync(dir,{recursive:true,mode:0o700});
  const file=join(dir,'bot-'+profile+'-'+last+'.json');
  writeFileSync(file,tape,{mode:0o600});
  console.log('V3_B3_LIVE_BOT_TAPE='+file);
  console.log('V3_B3_LIVE_BOT='+(s.halt?'BLOCKED_HALT':'PASS_'+s.frame+'_LIVE_FRAMES'));
  if(s.halt)process.exitCode=2;
}finally{server.kill();}
