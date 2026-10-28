import test from 'node:test';
import assert from 'node:assert/strict';
import {createBoard} from '../src/gngb_runtime.mjs';
import {PCMStreamResampler} from '../src/gngb_audio_resampler.mjs';
import {createZ80LiveSession} from '../src/gngb_z80_live_session.mjs';

test('frame audio completion follows a straddling MC6809 write without changing video',()=>{
  const code={fixed:new Uint8Array(0x10000),banks:new Uint8Array(0xa000)};
  code.fixed[0xfffe]=0x60;
  const blocks=new Map([[0x6000,$=>{
    $.C=25150;
    $.rd(0x3000,1);
    $.w(0x3a00,0x28,2);
    $.C=25154;$.PC=0x6001;
  }]]);
  const events=[],marks=[],frames=[],observedReads=[],plainReads=[];
  const observed=createBoard(code,blocks,{frames:1,
    portRead:(a,c)=>{observedReads.push([a,c]);return 255;},
    onAudioEvent:e=>events.push(e),
    onFrame:r=>{frames.push(r.record.slice());assert.equal(events.length,0);},
    onAudioComplete:m=>marks.push({m,eventCount:events.length})});
  assert.equal(observed.run().status,'FRAMES_DONE');
  assert.equal(events.length,1);
  assert.equal(events[0].cycle,25152);
  assert.equal(marks[0].eventCount,1);
  assert.equal(marks[0].m.frames,1);
  const plain=createBoard(code,blocks,{frames:1,
    portRead:(a,c)=>{plainReads.push([a,c]);return 255;}});
  assert.equal(plain.run().status,'FRAMES_DONE');
  assert.deepEqual(frames[0],plain.state.records[0].record);
  assert.deepEqual(observedReads,plainReads);
  assert.equal(observed.state.C,plain.state.C);
});

test('persistent Z80 consumes a late latch command and keeps reset epoch',async()=>{
  const rom=new Uint8Array(0x8000);
  rom.set([0x3a,0x00,0xc8,0xfe,0x28,0x20,0xf9,
    0x3e,0x08,0x32,0x00,0xe0,0x3e,0x0f,0x32,0x01,0xe0,0x76]);
  rom[0x38]=0x76;
  const ym=[];
  const s=await createZ80LiveSession(rom,{onYmEvent:e=>ym.push(e)});
  s.completeThrough(100);
  s.apply({kind:'AUDIO_RESET_LINE',value:1,cycle:110});
  s.completeThrough(200);
  s.apply({kind:'SOUNDLATCH_WRITE',value:0x28,cycle:210});
  s.completeThrough(300);
  assert.equal(s.snapshot().mainCommands,1);
  assert.ok(s.snapshot().latchReads>0);
  assert.deepEqual(ym.filter(e=>e.kind==='W').map(e=>[e.addr,e.value]),
    [[0xe000,0x08],[0xe001,0x0f]]);
  s.apply({kind:'AUDIO_RESET_LINE',value:0,cycle:310});
  const before=s.snapshot().tStates;
  s.completeThrough(400);
  assert.equal(s.snapshot().tStates,800);
  assert.ok(s.snapshot().tStates>before);
  assert.equal(ym.at(-1).kind,'R');
  assert.equal(ym.at(-1).tick,2480);
});

test('live Z80 sessions isolate dynamic blocks and fail closed on unknown target',async()=>{
  for(const value of [3,11,3]){
    const rom=new Uint8Array(0x8000);
    rom.fill(0xed);
    rom.set([0x21,0x00,0x02,0xe9]);
    rom.set([0x3e,value,0x32,0x01,0xe0,0x76],0x200);
    rom[0x38]=0x76;
    const ym=[];
    const s=await createZ80LiveSession(rom,{onYmEvent:e=>ym.push(e)});
    s.apply({kind:'AUDIO_RESET_LINE',value:1,cycle:0});
    s.completeThrough(100);
    assert.deepEqual(ym.filter(e=>e.kind==='W').map(e=>e.value),[value]);
    assert.ok(s.snapshot().dynamicResolutions>=1);
  }
  const bad=new Uint8Array(0x8000);
  bad.fill(0xed);
  bad.set([0x21,0x00,0xc0,0xe9]);bad[0x38]=0x76;
  const s=await createZ80LiveSession(bad);
  s.apply({kind:'AUDIO_RESET_LINE',value:1,cycle:0});
  assert.throws(()=>s.completeThrough(100),
    e=>e.code==='AUDIO_LIVE_PC_OUTSIDE_ROM');
});

test('62.5 kHz resampling preserves phase and duration at 44.1 and 48 kHz',()=>{
  const source=Int16Array.from({length:12500},(_,i)=>
    Math.round(12000*Math.sin(i*0.037)));
  for(const rate of [44100,48000]){
    const a=new PCMStreamResampler(rate,{prebuffer:2});
    a.push({sessionId:1,sampleRate:62500,firstSample:0,samples:source});
    const b=new PCMStreamResampler(rate,{prebuffer:2});
    b.push({sessionId:1,sampleRate:62500,firstSample:0,
      samples:source.subarray(0,6250)});
    const left=new Float32Array(Math.floor(rate*0.08));
    const right=new Float32Array(Math.floor(rate*0.08));
    a.pull(left);b.pull(right);assert.deepEqual(left,right);
    b.push({sessionId:1,sampleRate:62500,firstSample:6250,
      samples:source.subarray(6250)});
    const tailA=new Float32Array(Math.floor(rate*0.11));
    const tailB=new Float32Array(tailA.length);
    a.pull(tailA);b.pull(tailB);
    assert.deepEqual(tailA,tailB);
    assert.equal(b.snapshot().missingOutputSamples,0);
    assert.ok(Math.abs(b.snapshot().lastInputSample/62500-
      (left.length+tailB.length-1)/rate)<2/rate);
  }
});

test('PCM ingress rejects duplicate, gap, old session and queue overflow',()=>{
  const s=new PCMStreamResampler(48000,{capacity:256,prebuffer:2});
  s.push({sessionId:2,sampleRate:62500,firstSample:10,
    samples:new Int16Array(100)});
  for(const first of [10,111])
    assert.throws(()=>s.push({sessionId:2,sampleRate:62500,
      firstSample:first,samples:new Int16Array(1)}),
      e=>e.code==='AUDIO_PCM_GAP_OR_DUPLICATE');
  assert.throws(()=>s.push({sessionId:1,sampleRate:62500,
    firstSample:110,samples:new Int16Array(1)}),
    e=>e.code==='AUDIO_PCM_STALE_SESSION');
  assert.throws(()=>s.push({sessionId:2,sampleRate:62500,
    firstSample:110,samples:new Int16Array(200)}),
    e=>e.code==='AUDIO_PCM_QUEUE_OVERFLOW');
  s.reset(3);
  s.push({sessionId:3,sampleRate:62500,firstSample:0,
    samples:new Int16Array(3)});
  assert.equal(s.snapshot().sessionId,3);
});
