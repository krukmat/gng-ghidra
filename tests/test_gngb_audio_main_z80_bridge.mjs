import test from 'node:test';
import assert from 'node:assert/strict';
import {createGngbMainZ80Bridge,GngbAudioBridgeStop}
  from '../src/gngb_audio_main_z80_bridge.mjs';

test('B4 main board observer routes latch and reset into isolated Z80 bus with exact clocks',()=>{
  const reset=[],ym=[];
  const bridge=createGngbMainZ80Bridge(new Uint8Array(0x8000),{
    mainCycleAnchor:10,masterTickAnchor:500,
    onReset:e=>reset.push(e),onYmWrite:e=>ym.push(e)
  });
  const obs=bridge.onAudioEvent;
  assert.deepEqual(obs({kind:'SOUNDLATCH_WRITE',cycle:10,frame:0,pc:0x6060,value:7}),
    {kind:'SOUNDLATCH_WRITE',tick12m:500});
  assert.deepEqual(obs({kind:'SOUNDLATCH_WRITE',cycle:11,frame:0,pc:0x6062,value:55}),
    {kind:'SOUNDLATCH_WRITE',tick12m:508});
  assert.equal(bridge.bus.soundLatch,55);
  assert.throws(()=>bridge.bus.read8(0xc800,0),/AUDIO_Z80_IN_RESET/);
  assert.deepEqual(obs({kind:'AUDIO_RESET_LINE',cycle:12,frame:0,pc:0x6064,value:1}),
    {kind:'AUDIO_RESET_LINE',tick12m:516});
  assert.equal(bridge.bus.read8(0xc800,0),55);
  assert.equal(bridge.snapshot().status,'MAIN_BUS_EVENTS_ONLY_Z80_NOT_EXECUTING');
  assert.equal(bridge.snapshot().mainSoundCommandsObserved,2);
  assert.equal(bridge.snapshot().mainResetTransitionsObserved,1);
  assert.equal(bridge.snapshot().schedulerRunning,false);
  assert.equal(bridge.snapshot().pcmGenerated,false);
  assert.equal(reset.length,1);
  assert.equal(reset[0].tick12m,516);
  assert.deepEqual(ym,[]);
});

test('B4 YM events still require a separately executed Z80 instruction; bridge does not invent them',()=>{
  const writes=[];
  const bridge=createGngbMainZ80Bridge(new Uint8Array(0x8000),{
    onYmWrite:e=>writes.push(e)
  });
  bridge.onAudioEvent({kind:'AUDIO_RESET_LINE',cycle:0,value:1});
  bridge.onAudioEvent({kind:'SOUNDLATCH_WRITE',cycle:10,value:42});
  assert.equal(writes.length,0);
  // This explicit bus operation demonstrates the still-missing scheduler.
  bridge.bus.write8(0xe000,0x28,300);
  assert.equal(writes.length,1);
  assert.deepEqual([writes[0].addr,writes[0].value,writes[0].tick12m],
    [0xe000,0x28,1200]);
  assert.equal(bridge.snapshot().ymSynthesizerConnected,false);
  assert.equal(bridge.snapshot().browserAudioWorking,false);
});

test('B4 reset assert prevents Z80 MMIO despite sound latch updates',()=>{
  const bridge=createGngbMainZ80Bridge(new Uint8Array(0x8000));
  bridge.onAudioEvent({kind:'AUDIO_RESET_LINE',cycle:1,value:1});
  bridge.bus.write8(0xe000,0x30,5);
  bridge.onAudioEvent({kind:'AUDIO_RESET_LINE',cycle:2,value:0});
  bridge.onAudioEvent({kind:'SOUNDLATCH_WRITE',cycle:3,value:7});
  assert.equal(bridge.bus.soundLatch,7);
  assert.equal(bridge.bus.resetAsserted,true);
  assert.throws(()=>bridge.bus.write8(0xe001,0xaa,8),/AUDIO_Z80_IN_RESET/);
});

test('B4 rejects invalid, stale or fabricated main sound events without advancing adapter',()=>{
  const bridge=createGngbMainZ80Bridge(new Uint8Array(0x8000));
  for(const event of [
    null,{}, {kind:'YM2203_WRITE',cycle:1,value:0},
    {kind:'SOUNDLATCH_WRITE',cycle:-1,value:0},
    {kind:'SOUNDLATCH_WRITE',cycle:0,value:256},
    {kind:'AUDIO_RESET_LINE',cycle:1,value:2},
    {kind:'SOUNDLATCH_WRITE',cycle:0,value:4,frame:-1},
    {kind:'SOUNDLATCH_WRITE',cycle:0,value:4,pc:65536}
  ]) assert.throws(()=>bridge.onAudioEvent(event),GngbAudioBridgeStop);
  assert.equal(bridge.snapshot().mainSoundCommandsObserved,0);
  bridge.onAudioEvent({kind:'SOUNDLATCH_WRITE',cycle:5,value:2});
  assert.throws(()=>bridge.onAudioEvent({kind:'SOUNDLATCH_WRITE',cycle:4,value:3}),
    GngbAudioBridgeStop);
  assert.equal(bridge.bus.soundLatch,2);
  assert.equal(bridge.snapshot().mainSoundCommandsObserved,1);
});

test('B4 sound ROM shape is checked by bus; ROM identity is still operator-side gate',()=>{
  assert.throws(()=>createGngbMainZ80Bridge(new Uint8Array(5)),/AUDIO_Z80_BAD_ROM_SHAPE/);
  const bridge=createGngbMainZ80Bridge(new Uint8Array(0x8000));
  assert.equal(bridge.snapshot().nativeTimingParityVerified,false);
});
