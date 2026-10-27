import test from 'node:test';
import assert from 'node:assert/strict';
import {probeZ80SoundExecution,AudioZ80ProbeStop}
  from '../src/gngb_z80_sound_probe.mjs';

test('B4.T3-B executable synthetic Z80 sound ROM sends a live YM MMIO port write',async()=>{
  const rom=new Uint8Array(0x8000);
  rom.set([0x3a,0x00,0xc8,0x32,0x01,0xe0,0x76,0xcb,0x40]);
  const result=await probeZ80SoundExecution(rom,[0],{
    targetTStates:30,maxSteps:20,latchValue:0x28
  });
  assert.equal(result.status,'LAB_ADVANCE_OK');
  assert.equal(result.compiled_static_rom_pcs,3);
  assert.equal(result.ym_port_writes_from_running_z80,1);
  assert.equal(result.ym1_writes,1);
  assert.equal(result.ym2_writes,0);
  assert.equal(result.reached_tstates,30);
  assert.equal(result.irq_requests,0);
  assert.equal(result.sound_pcm_working,false);
  assert.equal(result.native_instruction_parity_verified,false);
  assert.equal(result.rom_bytes_exported,false);
  assert.doesNotMatch(JSON.stringify(result),/z80AotBlocks|private-rom|\b40\b/);
});

test('B4.T3-B target 240Hz interrupt with unverified IM0 returns explicit STOP',async()=>{
  const rom=new Uint8Array(0x8000);
  rom.set([0xfb,0x76,0xcb,0x40]);
  const result=await probeZ80SoundExecution(rom,[0],{
    targetTStates:12504,maxSteps:10000
  });
  assert.equal(result.status,'STOP_BEFORE_TARGET');
  assert.equal(result.reason,'AUDIO_Z80_LAB_IRQ_MODE_NOT_SUPPORTED');
  assert.equal(result.irq_requests,1);
  assert.equal(result.irq_acknowledged_lab,0);
  assert.equal(result.native_instruction_parity_verified,false);
});

test('B4.T3-B bounded synthetic loop halts with sanitized step-budget reason',async()=>{
  const rom=new Uint8Array(0x8000);
  rom.set([0x18,0xfe,0xcb,0x40]);
  const result=await probeZ80SoundExecution(rom,[0],{
    targetTStates:400,maxSteps:5
  });
  assert.equal(result.status,'STOP_BEFORE_TARGET');
  assert.equal(result.reason,'AUDIO_Z80_LAB_STEP_BUDGET_STOP');
  assert.equal(result.executed_steps,5);
  assert.equal(result.ym_port_writes_from_running_z80,0);
});

test('B4.T3-B unsafe input, forged roots and impossible bounds fail closed',async()=>{
  const rom=new Uint8Array(0x8000);
  for(const roots of [[],[32768],[-1],['0'],Array(65).fill(0)]){
    await assert.rejects(()=>probeZ80SoundExecution(rom,roots),AudioZ80ProbeStop);
  }
  await assert.rejects(()=>probeZ80SoundExecution(new Uint8Array(6),[0]),
    AudioZ80ProbeStop);
  await assert.rejects(()=>probeZ80SoundExecution(rom,[0],{
    targetTStates:-1}),AudioZ80ProbeStop);
  await assert.rejects(()=>probeZ80SoundExecution(rom,[0],{
    latchValue:256}),AudioZ80ProbeStop);
});

test('G5 final gate forwards only generated Z80 YM events to private PCM producer',async()=>{
  const rom=new Uint8Array(0x8000);
  rom.set([0x3e,0x28,0x32,0x01,0xe0,0x76,0xcb,0x40]);
  const writes=[];
  const result=await probeZ80SoundExecution(rom,[0],{
    targetTStates:40,maxSteps:30,
    onYmWrite:event=>writes.push({...event})
  });
  assert.equal(result.status,'LAB_ADVANCE_OK');
  assert.equal(result.ym_port_writes_from_running_z80,1);
  assert.equal(writes.length,1);
  assert.equal(writes[0].kind,'YM2203_WRITE');
  assert.equal(writes[0].addr,0xe001);
  assert.equal(writes[0].value,0x28);
  assert.equal(writes[0].tick12m,4*writes[0].z80TState);
  assert.equal(result.native_ym_events_replayed,false);
  assert.equal(result.sound_pcm_working,false);
});

test('G5 final gate rejects nonfunction live YM observer before decoding ROM',async()=>{
  const rom=new Uint8Array(0x8000);
  await assert.rejects(()=>probeZ80SoundExecution(rom,[0],{
    onYmWrite:{kind:'YM2203_WRITE'}
  }),e=>e instanceof AudioZ80ProbeStop&&
       e.code==='AUDIO_T3_PROBE_INVALID_CONFIGURATION');
});
