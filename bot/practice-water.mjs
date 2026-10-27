#!/usr/bin/env node
/** Practice handoff near stage-1 water.
 * Replays a known g4 P1 tape through ORIGINAL live /input endpoints,
 * then releases ALL held controls and gives the browser to the human.
 * No save-state injection, no engine changes, no unsupported teleport.
 * Usage: node bot/practice-water.mjs [handoffFrame=2720] [source]
 * The encounter with the red demon is NOT guaranteed killed by this tape.
 */
import {spawn,spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {CYCLES_PER_FRAME} from '../src/gngb_runtime.mjs';
import {resolveB3LabTape} from '../src/v3_b3_external_tape.mjs';
import {waitForAttractGate} from './live/wait-demo-gate.mjs';
import {buildPracticePlayback,playbackDue}
  from './live/practice-playback.mjs';

const ROOT=resolve(fileURLToPath(import.meta.url),'../..');
const BASE='http://127.0.0.1:18609';
const frameArg=process.argv[2]??'2720';
const source=process.argv[3]??'out/bot/late-sweep/trial-6.json';
const targetFrame=Number(frameArg);
if(process.argv.length>4||!Number.isSafeInteger(targetFrame)||
   targetFrame<2600||targetFrame>2760)
  throw Error('BOT_PRACTICE_USAGE_FRAME_2600_TO_2760');
if(!existsSync(resolve(ROOT,source)))
  throw Error('BOT_PRACTICE_SOURCE_MISSING_'+source);
const tape=resolveB3LabTape(resolve(ROOT,source));
if(tape.frames<=targetFrame)
  throw Error('BOT_PRACTICE_SOURCE_HORIZON_TOO_SHORT');
const plan=buildPracticePlayback(tape.events,CYCLES_PER_FRAME,targetFrame);
const directory=join(ROOT,'out/bot','practice-water-'+
  new Date().toISOString().replace(/[:.]/g,'-'));
mkdirSync(directory,{recursive:true,mode:0o700});
const save=(name,value)=>writeFileSync(join(directory,name),
  JSON.stringify(value,null,2)+'\n',{mode:0o600});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let server=null,recorder=null,serverLog='',recorderLog='',stopRequested=false;
let expectedSession=null,handoff=false,browserOpened=false;
let recordZip=null,recorderFinished=false;
process.on('SIGINT',()=>{stopRequested=true;});
process.on('SIGTERM',()=>{stopRequested=true;});
function captureLog(child,key){
  for(const stream of [child.stdout,child.stderr])stream.on('data',data=>{
    const chunk=data.toString();
    if(key==='server')serverLog=(serverLog+chunk).slice(-10000);
    else {
      recorderLog+=chunk;
      let n;
      while((n=recorderLog.indexOf('\n'))>=0){
        const line=recorderLog.slice(0,n);recorderLog=recorderLog.slice(n+1);
        if(line.startsWith('BOT_RECORD_REVIEW_ZIP=')){
          recordZip=line.slice('BOT_RECORD_REVIEW_ZIP='.length);
          console.log(line);
        }else if(line.startsWith('BOT_RECORD_STATUS=')||
           line.startsWith('BOT_RECORD_FAILED=')||
           line.startsWith('BOT_RECORD_STOP_REASON=')||
           line.startsWith('BOT_RECORD_MISSING_FFMPEG'))
          console.log(line);
      }
    }
  });
}
async function read(path){
  const response=await fetch(BASE+path,{cache:'no-store',
    signal:AbortSignal.timeout(3000)});
  if(!response.ok)throw Error('BOT_PRACTICE_GET_'+path+'_'+response.status);
  return response.json();
}
const state=async()=>{
  const s=await read('/state');
  if(s.schema!=='gng.v3.live-engine.v1'||s.mode!=='REAL_AOT')
    throw Error('BOT_PRACTICE_NOT_GENUINE_ENGINE');
  return s;
};
async function post(path,body){
  const response=await fetch(BASE+path,{method:'POST',
    headers:{'Content-Type':'application/json'},
    body:body?JSON.stringify(body):undefined,
    signal:AbortSignal.timeout(3000)});
  if(!response.ok)throw Error('BOT_PRACTICE_POST_'+path+'_'+response.status);
  return response.json();
}
async function saveCurrentTape(name){
  try{save(name,await read('/tape'));return true}
  catch(error){
    console.log('BOT_PRACTICE_TAPE_WARNING='+String(error.message??error));
    return false;
  }
}
async function boot(){
  try{await state();
    throw Error('BOT_PRACTICE_PORT_OCCUPIED_CLOSE_EXISTING_GAME');
  }catch(error){
    if(String(error.message).includes('PORT_OCCUPIED')||
       String(error.message).includes('NOT_GENUINE_ENGINE'))
      throw error;
  }
  server=spawn(process.execPath,[join(ROOT,'scripts/v3_b2c_live.mjs'),'--serve'],
    {cwd:ROOT,stdio:['ignore','pipe','pipe'],detached:true});
  captureLog(server,'server');
  for(let i=0;i<200&&!stopRequested;i++){
    if(server.exitCode!==null)break;
    await sleep(100);
    try{const s=await state();expectedSession=s.sessionId;break;}catch{}
  }
  if(expectedSession===null)
    throw Error('BOT_PRACTICE_SERVER_NOT_READY_'+serverLog.slice(-700));
  // /state may answer before stdout delivery reaches this parent.
  for(let i=0;i<25&&!/V3_B2C_AOT_BUNDLE=(\S+)/.test(serverLog);i++)
    await sleep(100);
  const bundle=/V3_B2C_AOT_BUNDLE=(\S+)/.exec(serverLog)?.[1];
  console.log('BOT_PRACTICE_BUNDLE='+(bundle??'UNKNOWN'));
  if(bundle!=='B3_G4')
    throw Error('BOT_PRACTICE_REQUIRES_B3_G4');
  const gate=await waitForAttractGate({readState:state,sleep,maxPolls:300,
    pollMs:100,shouldStop:()=>stopRequested});
  if(gate.sessionId!==expectedSession)
    throw Error('BOT_PRACTICE_SESSION_CHANGED');
  console.log('BOT_PRACTICE_GATE=READY frame='+gate.frame);
}
function startBrowserAndRecorder(){
  if(process.platform==='darwin'){
    const opened=spawnSync('open',[BASE],{stdio:'ignore'});
    browserOpened=opened.status===0;
  }
  console.log('BOT_PRACTICE_BROWSER='+BASE);
  // This child attaches to the ALREADY RUNNING server. It records only
  // native RGBA + real original input tape and does not press gameplay keys.
  recorder=spawn(process.execPath,
    [join(ROOT,'bot/record-gameplay.mjs'),'300'],
    {cwd:ROOT,stdio:['ignore','pipe','pipe'],detached:true});
  captureLog(recorder,'recorder');
  recorder.once('close',()=>{recorderFinished=true;});
}
async function completeRecorder(){
  if(!recorder||recorderFinished)return;
  try{recorder.kill('SIGINT')}catch{}
  for(let i=0;i<150&&!recorderFinished;i++)await sleep(100);
  if(!recorderFinished){try{recorder.kill('SIGTERM')}catch{}}
}
async function main(){
  let outcome='NOT_STARTED',lastFrame=null,lateMax=0,eventsSent=0;
  try{
    await boot();
    startBrowserAndRecorder();
    console.log('BOT_PRACTICE_SOURCE='+source);
    console.log('BOT_PRACTICE_TARGET='+targetFrame);
    console.log('BOT_PRACTICE_AUTOPLAY=START');
    await post('/continue');
    let index=0,lastReport=0;
    while(!stopRequested){
      const s=await state();
      if(s.sessionId!==expectedSession)
        throw Error('BOT_PRACTICE_ENGINE_SESSION_RESET');
      if(s.halt)
        throw Error('BOT_PRACTICE_ENGINE_HALT_'+
          String(s.halt.status??s.halt.code??'UNKNOWN'));
      lastFrame=s.frame;
      if(s.frame>targetFrame+8)
        throw Error('BOT_PRACTICE_OVERSHOT_TARGET_'+s.frame);
      const due=playbackDue(plan,index,s.frame,targetFrame);
      if(due.status==='LAG_STOP')throw Error(
        'BOT_PRACTICE_INPUT_LAG_'+due.lag+'_FRAME_'+due.lateEvent.frame);
      for(const e of due.due){
        await post('/input',{control:e.control,pressed:e.pressed});
        lateMax=Math.max(lateMax,Math.max(0,s.frame-(e.frame-1)));
        eventsSent++;
      }
      index=due.index;
      if(s.frame-lastReport>=400){
        lastReport=s.frame;
        console.log('BOT_PRACTICE_PROGRESS='+s.frame+'/'+targetFrame);
      }
      if(s.frame>=targetFrame)break;
      await sleep(4);
    }
    if(stopRequested)throw Error('BOT_PRACTICE_CANCELLED_BEFORE_HANDOFF');
    // Release the machine's scheduled controls atomically. Do NOT stop
    // the original running engine or tamper with its memory.
    await post('/release');
    const s=await state();
    if(s.halt||s.sessionId!==expectedSession)
      throw Error('BOT_PRACTICE_HANDOFF_STATE_NOT_VALID');
    handoff=true;outcome='HANDOFF_TO_HUMAN';
    save('handoff.json',{source,tapeHash:tape.sha256,targetFrame,
      reachedFrame:s.frame,session:s.sessionId,eventsSent,maxInputLag:lateMax,
      bossDefeated:'UNVERIFIED',islandLanding:'UNVERIFIED',
      contract:'ORIGINAL_ENGINE_ORIGINAL_P1_NO_MEMORY_INJECTION'});
    await saveCurrentTape('handoff-input-tape.json');
    console.log('BOT_PRACTICE_HANDOFF='+JSON.stringify({
      status:'AT_WATER_CANDIDATE',frame:s.frame,source,
      bossDefeated:'UNVERIFIED',inputLagFrames:lateMax}));
    console.log('BOT_PRACTICE_PLAY=YA_PUEDES_CONTROLAR_A_ARTHUR');
    console.log('BOT_PRACTICE_KEYS=flechas_mover_Z_ataque_X_salto');
    console.log('BOT_PRACTICE_END=Ctrl+C_guarda_video_y_cierra_motor');
    let lastStatus=Date.now();
    while(!stopRequested){
      await sleep(250);
      if(Date.now()-lastStatus<1000)continue;
      lastStatus=Date.now();
      const current=await state();
      if(current.halt){
        console.log('BOT_PRACTICE_HALT='+JSON.stringify(current.halt));
        outcome='HALT_AFTER_HANDOFF';
        break;
      }
    }
  }catch(error){
    outcome='STOP_'+String(error.message??error);
    console.error('BOT_PRACTICE_ERROR='+String(error.stack??error));
    process.exitCode=2;
  }finally{
    if(server&&handoff)await saveCurrentTape('final-input-tape.json');
    await completeRecorder();
    save('practice.json',{status:outcome,source,targetFrame,lastFrame,
      session:expectedSession,handoff,eventsSent,lateMax,
      recorderZip:recordZip,browserOpened});
    if(server&&!server.killed)server.kill('SIGTERM');
    console.log('BOT_PRACTICE_STATUS='+outcome);
    if(recordZip)console.log('BOT_PRACTICE_REVIEW_ZIP='+recordZip);
    console.log('BOT_PRACTICE_DIR='+directory);
  }
}
await main();
