import test from 'node:test';
import assert from 'node:assert/strict';
import {createZ80SoundBus,SoundBusStop,Z80_SOUND_HARDWARE} from '../src/gngb_z80_sound_bus.mjs';

test('main and sound clocks have exact integer 12MHz mapping',()=>{
  assert.equal(Z80_SOUND_HARDWARE.masterTicksPerMain,8);
  assert.equal(Z80_SOUND_HARDWARE.masterTicksPerZ80,4);
  assert.equal(Z80_SOUND_HARDWARE.z80IrqPeriodTStates,12500);
  const recorded=[];
  const b=createZ80SoundBus(new Uint8Array(0x8000),
    {mainCycleAnchor:311,masterTickAnchor:2000,onYmWrite:e=>recorded.push(e)});
  assert.deepEqual(b.applyMainEvent({kind:'AUDIO_RESET_LINE',value:1,cycle:311}),
    {kind:'AUDIO_RESET_LINE',tick12m:2000});
  b.applyMainEvent({kind:'SOUNDLATCH_WRITE',value:0x42,cycle:315});
  assert.equal(b.read8(0xc800,0),0x42);
  b.write8(0xe001,0x55,10);
  assert.deepEqual(recorded.map(x=>[x.addr,x.value,x.tick12m]),[[0xe001,0x55,2040]]);
});
test('latest latch semantics, not fake FIFO, and active-low reset',()=>{
  const b=createZ80SoundBus(new Uint8Array(0x8000));
  assert.throws(()=>b.read8(0,0),SoundBusStop);
  b.applyMainEvent({kind:'SOUNDLATCH_WRITE',value:1,cycle:0});
  b.applyMainEvent({kind:'SOUNDLATCH_WRITE',value:2,cycle:0});
  b.applyMainEvent({kind:'AUDIO_RESET_LINE',value:1,cycle:1});
  assert.equal(b.read8(0xc800,0),2);
  b.applyMainEvent({kind:'AUDIO_RESET_LINE',value:0,cycle:2});
  assert.throws(()=>b.write8(0xe000,1,5),/AUDIO_Z80_IN_RESET/);
});
test('unmapped activity, stale events and invalid shapes fail closed',()=>{
  assert.throws(()=>createZ80SoundBus(new Uint8Array(2)),SoundBusStop);
  const b=createZ80SoundBus(new Uint8Array(0x8000));
  b.applyMainEvent({kind:'AUDIO_RESET_LINE',value:1,cycle:4});
  assert.throws(()=>b.read8(0xb000,0),/AUDIO_Z80_UNMAPPED_READ/);
  assert.throws(()=>b.write8(0xb000,1,0),/AUDIO_Z80_UNMAPPED_WRITE/);
  assert.throws(()=>b.applyMainEvent({kind:'SOUNDLATCH_WRITE',value:1,cycle:3}),
                /AUDIO_Z80_BAD_MAIN_EVENT/);
});
