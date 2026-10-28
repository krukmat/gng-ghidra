import test from 'node:test';
import assert from 'node:assert/strict';

test('worklet keeps source phase, waits for prebuffer and reports underrun STOP',async()=>{
  let Processor=null;
  globalThis.sampleRate=48000;
  globalThis.currentTime=0;
  globalThis.AudioWorkletProcessor=class {
    constructor(){this.port={onmessage:null,messages:[],
      postMessage:m=>this.port.messages.push(m)};}
  };
  globalThis.registerProcessor=(name,ctor)=>{
    assert.equal(name,'gng-pcm-sink');Processor=ctor;};
  await import('../src/gngb_audio_pcm_processor.mjs?test');
  const p=new Processor();
  const output=()=>[[new Float32Array(128)]];
  const early=output();p.process([],early);
  assert.ok(early[0][0].every(x=>x===0));
  assert.equal(p.stream.snapshot().state,'WAITING');
  const samples=Int16Array.from({length:5000},(_,i)=>i%2?12000:-12000);
  p.port.onmessage({data:{kind:'PCM',sessionId:1,firstSample:0,
    sampleRate:62500,samples}});
  const first=output();p.process([],first);
  assert.ok(first[0][0].some(x=>x!==0));
  assert.equal(p.stream.snapshot().missingOutputSamples,0);
  for(let i=0;i<40;i++){
    globalThis.currentTime+=128/48000;
    p.process([],output());
  }
  assert.equal(p.stream.snapshot().state,'STOP');
  assert.ok(p.port.messages.some(m=>m.kind==='AUDIO_WORKLET_STOP'&&
    m.code==='AUDIO_WORKLET_UNDERRUN'));
  p.port.onmessage({data:{kind:'RESET',sessionId:2}});
  assert.equal(p.stream.snapshot().state,'WAITING');
  assert.equal(p.stream.snapshot().sessionId,2);
  p.port.onmessage({data:{kind:'PCM',sessionId:1,firstSample:0,
    sampleRate:62500,samples:new Int16Array(10)}});
  assert.ok(p.port.messages.some(m=>m.code==='AUDIO_PCM_STALE_SESSION'));
});
