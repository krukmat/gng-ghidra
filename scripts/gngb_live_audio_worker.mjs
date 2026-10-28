#!/usr/bin/env node
/** Private local producer: current MC6809 events -> Z80 -> dual YM -> PCM. */
import {parentPort,workerData} from 'node:worker_threads';
import {spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createZ80LiveSession} from '../src/gngb_z80_live_session.mjs';

const send=m=>parentPort.postMessage(m);
const safeCode=e=>/^AUDIO_[A-Z0-9_]{3,80}$/.test(e?.code??e?.message)?
  (e.code??e.message):'AUDIO_LIVE_UNEXPECTED_STOP';
let stopped=false;
const stop=e=>{
  if(stopped)return;
  stopped=true;send({type:'stop',code:safeCode(e)});
  native?.kill();
};
let native=null,session=null;
let inputEvents=[],ymEvents=[],seq=0,frontier=0;
let stdout=Buffer.alloc(0),nextSample=0,pcmSamples=0,nonzero=0;
const parseOutput=chunk=>{
  stdout=Buffer.concat([stdout,chunk]);
  if(stdout.length>1024*1024)throw Error('AUDIO_LIVE_OUTPUT_OVERFLOW');
  while(stdout.length>=13){
    if(stdout[0]!==80)throw Error('AUDIO_LIVE_OUTPUT_INVALID');
    const first=Number(stdout.readBigUInt64LE(1)),n=stdout.readUInt32LE(9);
    if(n>12500||!Number.isSafeInteger(first))
      throw Error('AUDIO_LIVE_OUTPUT_INVALID');
    const length=13+n*2;
    if(stdout.length<length)break;
    if(first!==nextSample)throw Error('AUDIO_LIVE_PCM_GAP');
    const bytes=Uint8Array.from(stdout.subarray(13,length));
    for(let i=0;i<n;i++)if(bytes[i*2]||bytes[i*2+1])nonzero++;
    nextSample+=n;pcmSamples+=n;
    send({type:'pcm',sessionId:workerData.sessionId,
      sampleRate:62500,firstSample:first,samples:bytes.buffer,
      producedSamples:pcmSamples,nonzeroSamples:nonzero});
    stdout=stdout.subarray(length);
  }
};
const writeNative=line=>new Promise((resolve,reject)=>{
  if(!native||native.exitCode!==null)return reject(Error('AUDIO_LIVE_NATIVE_STOP'));
  if(native.stdin.write(line))resolve();
  else native.stdin.once('drain',resolve);
});
async function consumeBatch(m) {
  if(stopped||!session)return;
  if(m.sessionId!==workerData.sessionId||
     !Number.isSafeInteger(m.throughCycle)||m.throughCycle<frontier||
     !Array.isArray(m.events)||m.events.length>5000)
    throw Error('AUDIO_LIVE_BATCH_INVALID');
  for(const e of m.events){
    if(!e||!['SOUNDLATCH_WRITE','AUDIO_RESET_LINE'].includes(e.kind)||
       !Number.isSafeInteger(e.cycle)||e.cycle<frontier||
       !Number.isInteger(e.value)||e.value<0||e.value>255)
      throw Error('AUDIO_LIVE_BATCH_INVALID');
    inputEvents.push(e);
  }
  if(inputEvents.length>10000)
    throw Error('AUDIO_LIVE_INPUT_QUEUE_OVERFLOW');
  inputEvents.sort((a,b)=>a.cycle-b.cycle);
  let consumed=0;
  while(consumed<inputEvents.length&&inputEvents[consumed].cycle<m.throughCycle){
    session.apply(inputEvents[consumed]);consumed++;
  }
  inputEvents.splice(0,consumed);
  const stats=session.completeThrough(m.throughCycle);
  if(ymEvents.length>10000)
    throw Error('AUDIO_LIVE_YM_QUEUE_OVERFLOW');
  frontier=m.throughCycle;
  const tick=frontier*8;
  ymEvents.sort((a,b)=>a.tick-b.tick||a.seq-b.seq);
  let flushed=0,commands='';
  while(flushed<ymEvents.length&&ymEvents[flushed].tick<tick){
    const e=ymEvents[flushed++];
    commands+=e.kind==='W'?`W ${e.tick} ${e.addr} ${e.value}\n`:
      `R ${e.tick}\n`;
  }
  ymEvents.splice(0,flushed);
  commands+=`U ${tick}\n`;
  await writeNative(commands);
  send({type:'stats',sessionId:workerData.sessionId,
    throughCycle:frontier,commands:stats.mainCommands,
    resetTransitions:stats.resetTransitions,latchReads:stats.latchReads,
    ymWrites:stats.ymWrites,irqRequests:stats.irqRequests,
    irqAcknowledged:stats.irqAcknowledged,
    maxOvershootTStates:stats.maxOvershootTStates,
    dynamicResolutions:stats.dynamicResolutions});
}
async function main(){
  const rom=Uint8Array.from(readFileSync(workerData.rom));
  if(rom.length!==0x8000||createHash('sha1').update(rom).digest('hex')!==
     '7ef9ec5c2072e21c787a6bbf700033f50c759c1d')
    throw Error('AUDIO_LIVE_ROM_INVALID');
  native=spawn(workerData.renderer,['--stream'],{
    stdio:['pipe','pipe','pipe']});
  native.stdout.on('data',chunk=>{try{parseOutput(chunk)}catch(e){stop(e)}});
  // stderr may contain private diagnostics; only a fixed code escapes.
  native.stderr.resume();
  native.on('error',()=>stop(Error('AUDIO_LIVE_NATIVE_STOP')));
  native.on('exit',code=>{
    if(!stopped&&code!==0)stop(Error('AUDIO_LIVE_NATIVE_STOP'));
  });
  session=await createZ80LiveSession(rom,{onYmEvent:e=>
    ymEvents.push({...e,seq:seq++})});
  send({type:'ready',sessionId:workerData.sessionId});
}
const initialized=main();
let chain=initialized;
parentPort.on('message',m=>{
  if(m?.type!=='batch')return;
  chain=chain.then(()=>consumeBatch(m)).catch(stop);
});
initialized.catch(stop);
