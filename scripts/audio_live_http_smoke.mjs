#!/usr/bin/env node
/** Loopback diagnostic only: exercises real controls and counts PCM packets.
 * It is not an AudioWorklet or human-audition acceptance test.
 */
const seconds=Number(process.argv[2]??20);
if(!Number.isInteger(seconds)||seconds<5||seconds>150)
  throw Error('AUDIO_SMOKE_DURATION_INVALID');
const base='http://127.0.0.1:18609';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const state=async()=>await (await fetch(base+'/state')).json();
async function control(name,pressed){
  const r=await fetch(base+'/input',{method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({control:name,pressed})});
  if(r.status!==200)throw Error('AUDIO_SMOKE_CONTROL_STOP');
}
async function pulse(name){await control(name,true);await sleep(400);
  await control(name,false);}
let s;
for(let i=0;i<150;i++){
  s=await state();if(s.operatorPause)break;
  if(s.halt)throw Error('AUDIO_SMOKE_ENGINE_HALT');
  await sleep(100);
}
if(!s.operatorPause)throw Error('AUDIO_SMOKE_NO_OPERATOR_PAUSE');
const coin=pulse('coin1');await coin;
await sleep(1200);await pulse('start1');
const start=await fetch(base+'/audio/start',{method:'POST'});
if(start.status!==200)throw Error('AUDIO_SMOKE_START_STOP');
const sessionId=(await start.json()).sessionId;
const since=performance.now();let next=null,packets=0,missing=0;
let nonzero=0,maxQueued=0,stop=null;
let action=false;
while(performance.now()-since<seconds*1000){
  const r=await fetch(base+'/audio?session='+sessionId);
  if(r.status===200){
    const p=await r.json();
    if(p.sessionId!==sessionId||p.sampleRate!==62500)
      throw Error('AUDIO_SMOKE_SESSION_STOP');
    const bytes=Buffer.from(p.pcm,'base64');
    if(bytes.length%2)throw Error('AUDIO_SMOKE_PCM_SHAPE_STOP');
    if(next===null)next=p.firstSample;
    if(p.firstSample!==next){missing++;break;}
    next+=bytes.length/2;packets++;
    for(let i=0;i<bytes.length;i+=2)
      if(bytes.readInt16LE(i)!==0)nonzero++;
  }else if(r.status===409){stop=(await r.json()).code;break;}
  if(!action&&performance.now()-since>3000){
    action=true;await control('p1.button1',true);
    setTimeout(()=>{void control('p1.button1',false);},400);
  }
  if(packets%30===0){
    s=await state();maxQueued=Math.max(maxQueued,s.audio.queuedSamples);
    if(s.audio.stop||s.halt){stop=s.audio.stop??s.halt.code??s.halt.status;break;}
  }
  if(r.status===204)await sleep(10);
}
s=await state();
console.log(JSON.stringify({status:stop?'STOP':'HTTP_PCM_ONLY',
  stop,seconds:Math.round((performance.now()-since)/1000),
  sessionId,frame:s.frame,coinReads:s.reads.coin,
  startReads:s.reads.start,p1Reads:s.reads.p1,
  commands:s.audio.producer?.commands??null,
  latchReads:s.audio.producer?.latchReads??null,
  ymWrites:s.audio.producer?.ymWrites??null,
  producedSamples:s.audio.producedSamples,
  deliveredSampleEnd:next,nonzeroSamples:nonzero,
  packets,gaps:missing,maxQueuedSamples:maxQueued,
  browserWorkletConnected:false,humanAudition:false}));
if(stop||missing)process.exitCode=2;
