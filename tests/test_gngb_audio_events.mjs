import test from 'node:test';
import assert from 'node:assert/strict';
import {createBoard} from '../src/gngb_runtime.mjs';
import {AUDIO_HARDWARE,validateAudioTimeline} from '../src/gngb_audio_contract.mjs';

function setup() {
  const events=[];
  const code={fixed:new Uint8Array(0x10000),banks:new Uint8Array(5*0x2000)};
  const board=createBoard(code,new Map(),{frames:1,onAudioEvent:e=>events.push(e)});
  board.state.C=100;
  board.state.ipc=0x6123;
  return {events,board};
}

test('original gngb audio map is explicit and ROM-free',()=>{
  assert.equal(AUDIO_HARDWARE.rom,'gg2.bin');
  assert.equal(AUDIO_HARDWARE.z80SoundLatch,0xc800);
  assert.deepEqual(AUDIO_HARDWARE.z80Ym2,[0xe002,0xe003]);
  assert.equal(AUDIO_HARDWARE.soundIrqHz,240);
});

test('soundlatch preserves latest value, publishes every write in order and cycle',()=>{
  const {events,board}=setup();
  board.state.w(0x3a00,0x12,2);
  board.state.w(0x3a00,0x34,3);
  assert.equal(board.state.soundlatch,0x34);
  assert.deepEqual(events.map(e=>[e.kind,e.value,e.cycle,e.frame,e.pc]),[
    ['SOUNDLATCH_WRITE',0x12,102,0,0x6123],
    ['SOUNDLATCH_WRITE',0x34,103,0,0x6123],
  ]);
  assert.equal(validateAudioTimeline(events).commands,2);
});

test('0x3d01 affects audio reset line only on transitions; no other latch bit does',()=>{
  const {events,board}=setup();
  board.state.w(0x3d00,0,1);
  board.state.w(0x3d01,0,2); // active low: Z80 reset asserted, YM reset
  board.state.w(0x3d01,0,3); // no output transition
  board.state.w(0x3d01,1,4); // released
  assert.deepEqual(events.map(e=>[e.kind,e.value,e.cycle]),[
    ['AUDIO_RESET_LINE',0,102],
    ['AUDIO_RESET_LINE',1,104],
  ]);
  assert.equal(board.state.latch[1],1);
  assert.equal(validateAudioTimeline(events).resets,2);
});

test('audio callback is opt-in and requires known write timing',()=>{
  const code={fixed:new Uint8Array(0x10000),banks:new Uint8Array(5*0x2000)};
  assert.throws(()=>createBoard(code,new Map(),{frames:1,onAudioEvent:3}),/AUDIO_EVENT_HANDLER_INVALID/);
  const s=createBoard(code,new Map(),{frames:1}).state;
  s.w(0x3a00,0x7f); // legacy callers remain supported
  assert.equal(s.soundlatch,0x7f);
  const {board}=setup();
  assert.throws(()=>board.state.w(0x3a00,0x01),/AUDIO_EVENT_CYCLE_INVALID/);
});

test('timeline validation rejects reordered or fabricated frame values',()=>{
  assert.throws(()=>validateAudioTimeline([
    {kind:'SOUNDLATCH_WRITE',value:42,cycle:20,frame:0},
    {kind:'SOUNDLATCH_WRITE',value:41,cycle:19,frame:0},
  ]),/AUDIO_TIMELINE_INVALID/);
  assert.throws(()=>validateAudioTimeline([
    {kind:'SOUNDLATCH_WRITE',value:41,cycle:25152,frame:0},
  ]),/AUDIO_TIMELINE_INVALID/);
});
