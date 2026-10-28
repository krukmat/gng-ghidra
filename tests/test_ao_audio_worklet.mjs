import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cpSync,mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

// ROM-free: the AO-6 worklet in Node with a fake AudioWorklet global scope.
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const port=()=>{
  const p={sent:[],onmessage:null,postMessage:m=>p.sent.push(m),close(){p.closed=true;}};
  return p;
};
let Processor;
globalThis.sampleRate=48000;globalThis.currentTime=0;
globalThis.AudioWorkletProcessor=class{constructor(){this.port=port();}};
globalThis.registerProcessor=(name,cls)=>{assert.equal(name,'ao-pcm-sink');Processor=cls;};
const temp=mkdtempSync(join(tmpdir(),'gng-ao6-'));
mkdirSync(join(temp,'lib'));
cpSync(join(ROOT,'android/web/audio.worklet.mjs'),join(temp,'audio.worklet.mjs'));
cpSync(join(ROOT,'src/gngb_audio_resampler.mjs'),join(temp,'lib/gngb_audio_resampler.mjs'));
await import(pathToFileURL(join(temp,'audio.worklet.mjs')).href);
rmSync(temp,{recursive:true,force:true});

const pcm=(sessionId,firstSample,n,v=1000)=>({kind:'PCM',sessionId,firstSample,
  sampleRate:62500,samples:new Int16Array(n).fill(v)});
const quantum=p=>{const out=new Float32Array(128);p.process([],[[out]]);return out;};
function open(sessionId){
  const p=new Processor(),pcmPort=port(),clockPort=port();
  p.port.onmessage({data:{kind:'RESET',sessionId,pcm:pcmPort,clock:clockPort}});
  return {p,pcmPort,clockPort,send:m=>pcmPort.onmessage({data:m})};
}

test('plays after the 50 ms prebuffer and reports the consumed sample',()=>{
  const {p,clockPort,send}=open(1);
  send(pcm(1,1048,3000));
  assert.ok(quantum(p).every(x=>x===0),'still prebuffering');
  send(pcm(1,4048,1048));
  for(let k=0;k<4;k++)quantum(p);
  const clock=clockPort.sent.filter(m=>m.state==='PLAYING');
  assert.ok(clock.length>=1);
  assert.equal(clock[0].sessionId,1);
  assert.ok(clock[0].sample>1048&&clock[0].sample<1048+700);
  assert.ok(p.outputNonzero>0);
});
test('packets of an older session are dropped, never played or STOP',()=>{
  const {p,pcmPort,send}=open(1);
  const fresh=port();
  p.port.onmessage({data:{kind:'RESET',sessionId:2,pcm:fresh,clock:port()}});
  assert.equal(pcmPort.closed,true);
  fresh.onmessage({data:pcm(1,0,4000)});
  send(pcm(1,4000,4000)); // late message on the closed port
  assert.equal(p.stale,2);
  assert.ok(quantum(p).every(x=>x===0));
  assert.equal(p.stream.state,'WAITING');
  assert.equal(p.port.sent.filter(m=>m.kind==='STOP').length,0);
  p.port.onmessage({data:{kind:'RESET',sessionId:null}});
  fresh.onmessage({data:pcm(2,0,4000)});
  assert.equal(p.stale,3,'a closed output accepts nothing');
});
test('an underrun is a single STOP with no automatic recovery',()=>{
  const {p,clockPort,send}=open(5);
  send(pcm(5,0,3200));
  for(let k=0;k<30;k++)quantum(p);
  const stops=p.port.sent.filter(m=>m.kind==='STOP');
  assert.equal(stops.length,1);
  assert.equal(stops[0].code,'AUDIO_WORKLET_UNDERRUN');
  assert.equal(clockPort.sent.at(-1).state,'STOP');
  send(pcm(5,3200,4000));
  assert.ok(quantum(p).every(x=>x===0),'stays silent after STOP');
});
test('a gap or overflow in the current session is a STOP',()=>{
  const a=open(1);
  a.send(pcm(1,0,1000));a.send(pcm(1,1001,10));
  assert.equal(a.p.port.sent.at(-1).code,'AUDIO_PCM_GAP_OR_DUPLICATE');
  const b=open(1);
  for(let k=0;k<13;k++)b.send(pcm(1,k*1000,1000));
  assert.equal(b.p.port.sent.at(-1).code,'AUDIO_PCM_QUEUE_OVERFLOW');
});
