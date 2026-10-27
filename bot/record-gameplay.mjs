#!/usr/bin/env node
/** Native gngb gameplay recorder: launches/attaches to existing live engine,
 * opens the browser for HUMAN gameplay, records ONLY GET /pixels and /state,
 * writes silent MP4 and private input tape. No engine changes or bot actions.
 *
 * Usage: node bot/record-gameplay.mjs [maxSeconds=240]
 * Requires ffmpeg on PATH. Ctrl+C finishes and packages the recording.
 */
import {spawn,spawnSync} from 'node:child_process';
import {createWriteStream,mkdirSync,writeFileSync,existsSync}
  from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {once} from 'node:events';
import {createFrameLedger} from './live/recording-ledger.mjs';

const ROOT=resolve(fileURLToPath(import.meta.url),'../..');
const BASE='http://127.0.0.1:18609';
const SECONDS=Number(process.argv[2]??240),FPS=20;
if(!Number.isSafeInteger(SECONDS)||SECONDS<20||SECONDS>900)
  throw Error('BOT_RECORD_USAGE_SECONDS_20_TO_900');
if(spawnSync('ffmpeg',['-version'],{stdio:'ignore'}).status!==0){
  console.error('BOT_RECORD_MISSING_FFMPEG');
  console.error('Instala ffmpeg una vez: brew install ffmpeg');
  process.exit(2);
}

let stopRequested=false,server=null,encoder=null,serverLog='';
const stop=()=>{if(!stopRequested)console.log('BOT_RECORD_STOP_REQUESTED');stopRequested=true;};
process.on('SIGINT',stop);
process.on('SIGTERM',stop);
const sleep=ms=>new Promise(done=>setTimeout(done,ms));
const safeFetch=async(path,timeoutMs=2000)=>{
  const res=await fetch(BASE+path,{cache:'no-store',
    signal:AbortSignal.timeout(timeoutMs)});
  return res;
};
const state=async()=>{
  const res=await safeFetch('/state');
  if(!res.ok)throw Error('STATE_HTTP_'+res.status);
  const s=await res.json();
  if(s.schema!=='gng.v3.live-engine.v1'||s.mode!=='REAL_AOT')
    throw Error('BOT_RECORD_NOT_GNGB_REAL_AOT');
  return s;
};
async function ensureServer(){
  try{
    await state();
    console.log('BOT_RECORD_SERVER=ATTACHED_EXISTING');
    return;
  }catch(error){
    if(String(error.message).includes('NOT_GNGB_REAL_AOT'))
      throw error;
  }
  server=spawn(process.execPath,
    [join(ROOT,'scripts/v3_b2c_live.mjs'),'--serve'],
    {cwd:ROOT,stdio:['ignore','pipe','pipe']});
  for(const stream of [server.stdout,server.stderr])
    stream.on('data',bytes=>{
      serverLog=(serverLog+bytes.toString('utf8')).slice(-10000);
    });
  for(let i=0;i<200&&!stopRequested;i++){
    if(server.exitCode!==null)break;
    await sleep(100);
    try{
      await state();
      console.log('BOT_RECORD_SERVER=LAUNCHED');
      const bundle=/V3_B2C_AOT_BUNDLE=(\S+)/.exec(serverLog)?.[1];
      console.log('BOT_RECORD_BUNDLE='+(bundle??'UNKNOWN'));
      return;
    }catch(error){
      if(String(error.message).includes('NOT_GNGB_REAL_AOT'))
        throw error;
    }
  }
  throw Error('BOT_RECORD_ENGINE_START_FAILED_'+serverLog.slice(-1200));
}
function closeServer(){
  if(server&&!server.killed)server.kill('SIGTERM');
}
async function saveInputTape(out){
  try{
    const res=await safeFetch('/tape',6000);
    if(!res.ok)throw Error('TAPE_HTTP_'+res.status);
    const body=await res.text();
    JSON.parse(body);
    writeFileSync(join(out,'input-tape.json'),body+'\n',{mode:0o600});
    console.log('BOT_RECORD_TAPE=PRIVATE_SAVED');
    return true;
  }catch(error){
    console.error('BOT_RECORD_TAPE_UNAVAILABLE='+String(error.message??error));
    return false;
  }
}
async function run(){
  const stamp=new Date().toISOString().replace(/[:.]/g,'-');
  const output=join(ROOT,'out/bot','gameplay-'+stamp);
  mkdirSync(output,{recursive:true,mode:0o700});
  const video=join(output,'gameplay.mp4');
  const ledger=createFrameLedger();
  const notes={startedUtc:new Date().toISOString(),fps:FPS,
    source:'LIVE_REAL_AOT_GET_PIXELS',audio:false,
    noInputInjected:true,maxSeconds:SECONDS,
    stoppedBy:'UNKNOWN',halt:null,videoStatus:'UNKNOWN'};
  let tapeSaved=false,codecExit=null,encoderError='',recorded=0;
  try{
    await ensureServer();
    // The browser uses original P1 keyboard controls. The recorder sends
    // zero POSTs to the engine and never injects Coin, Start or input.
    if(process.platform==='darwin'){
      const opener=spawnSync('open',[BASE],{stdio:'ignore'});
      if(opener.status!==0)console.log('BOT_RECORD_OPEN_BROWSER='+BASE);
    }else console.log('BOT_RECORD_OPEN_BROWSER='+BASE);
    console.log('BOT_RECORD_READY: juega en la ventana del navegador.');
    console.log('BOT_RECORD_KEYS: 5=Coin, 1=Start, flechas=mover, Z=ataque, X=salto.');
    console.log('BOT_RECORD_END: Ctrl+C en esta terminal o cierre automatico en '+SECONDS+'s.');
    console.log('BOT_RECORD_OUTPUT='+output);
    encoder=spawn('ffmpeg',[
      '-hide_banner','-loglevel','error','-y',
      '-f','rawvideo','-pixel_format','rgba',
      '-video_size','256x224','-framerate',String(FPS),
      '-i','pipe:0','-an',
      '-vf','scale=768:672:flags=neighbor',
      '-c:v','mpeg4','-q:v','3','-pix_fmt','yuv420p',
      '-movflags','+faststart',video],
      {cwd:ROOT,stdio:['pipe','ignore','pipe']});
    encoder.stderr.on('data',b=>{
      encoderError=(encoderError+b.toString('utf8')).slice(-1500);
    });
    let encoderClosed=false;
    encoder.once('error',e=>{encoderClosed=true;encoderError=String(e);});
    encoder.once('close',()=>{encoderClosed=true;});
    const begun=Date.now();
    let nextTime=begun;
    while(!stopRequested&&Date.now()-begun<SECONDS*1000){
      const now=Date.now();
      if(now<nextTime){await sleep(Math.min(25,nextTime-now));continue;}
      nextTime=Math.max(nextTime+1000/FPS,Date.now());
      if(encoderClosed||!encoder.stdin.writable){
        notes.stoppedBy='ENCODER_EXIT';break;
      }
      try{
        const s=await state();
        if(s.halt){
          notes.halt=s.halt;notes.stoppedBy='ENGINE_HALT';break;
        }
        const res=await safeFetch('/pixels');
        if(res.status===204)continue;
        if(!res.ok)throw Error('PIXELS_HTTP_'+res.status);
        const gameFrame=Number(res.headers.get('X-GnG-Frame'));
        const session=Number(res.headers.get('X-GnG-Session'));
        // The pixel headers are atomic with their RGBA, unlike /state.
        if(!Number.isSafeInteger(session)||session!==s.sessionId)
          continue;
        const rgba=Buffer.from(await res.arrayBuffer());
        ledger.accept({session,engineFrame:gameFrame,
          wallMs:Date.now()-begun,bytes:rgba});
        recorded++;
        // Respect backpressure without losing the raw-video packet order.
        if(!encoder.stdin.write(rgba))await once(encoder.stdin,'drain');
        if(recorded%100===0)
          console.log('BOT_RECORD_PROGRESS='+JSON.stringify({
            samples:recorded,lastGameFrame:gameFrame,
            seconds:Math.round((Date.now()-begun)/1000)}));
      }catch(error){
        console.error('BOT_RECORD_FRAME_WARNING='+String(error.message??error));
        notes.stoppedBy='FRAME_ERROR';break;
      }
    }
    if(notes.stoppedBy==='UNKNOWN')
      notes.stoppedBy=stopRequested?'OPERATOR_STOP':'TIME_LIMIT';
    // Always request the tape while its ORIGINAL session is still running.
    tapeSaved=await saveInputTape(output);
    encoder.stdin.end();
    codecExit=await new Promise(resolve=>{
      if(encoder.exitCode!==null)return resolve(encoder.exitCode);
      encoder.once('close',code=>resolve(code));
    });
    notes.videoStatus=codecExit===0&&recorded>0?'MP4_SAVED':'ENCODING_FAILED';
    if(codecExit!==0)console.error('BOT_RECORD_ENCODER_ERROR='+encoderError);
  }finally{
    notes.endedUtc=new Date().toISOString();
    notes.samples=recorded;
    notes.tapeSaved=tapeSaved;
    notes.frameLedger=ledger.report();
    writeFileSync(join(output,'recording.json'),
      JSON.stringify(notes,null,2)+'\n',{mode:0o600});
    if(encoder&&encoder.exitCode===null){
      try{encoder.stdin.end();}catch{}
    }
    closeServer();
    if(notes.videoStatus==='MP4_SAVED'){
      const files=['gameplay.mp4','recording.json',
        ...(tapeSaved?['input-tape.json']:[])];
      const zipped=spawnSync('zip',['-j','-q','review.zip',...files],
        {cwd:output,stdio:'pipe'});
      if(zipped.status===0)
        console.log('BOT_RECORD_REVIEW_ZIP='+join(output,'review.zip'));
      else console.log('BOT_RECORD_REVIEW_FILES='+output);
    }
    console.log('BOT_RECORD_VIDEO='+video);
    console.log('BOT_RECORD_STATUS='+notes.videoStatus);
    console.log('BOT_RECORD_STOP_REASON='+notes.stoppedBy);
  }
  if(codecExit!==0||recorded===0)process.exitCode=2;
}
run().catch(error=>{
  console.error('BOT_RECORD_FAILED='+String(error.stack??error));
  closeServer();process.exitCode=2;
});
