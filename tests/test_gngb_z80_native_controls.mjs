import test from 'node:test';
import assert from 'node:assert/strict';
import {probeZ80SoundExecution,AudioZ80ProbeStop}
  from '../src/gngb_z80_sound_probe.mjs';

const controls=(events,pre_release_latch=null)=>({
  kind:'GNG_AUDIO_B4_T3_PRIVATE_NATIVE_CONTROLS_V1',
  clock:'RESET_RELEASE_RELATIVE_MASTER_12MHZ',
  irq_phase_native_verified:false,main_sound_controls_only:true,
  pre_release_latch,events
});
const event=(tick12m,value)=>({kind:'SOUNDLATCH_WRITE',tick12m,value});

test('B4.T3-B3 reset-relative native sound control produces actual Z80 YM writes, no tape replay',async()=>{
  const rom=new Uint8Array(0x8000);
  rom.set([0x3a,0x00,0xc8,0x32,0x01,0xe0,0x76,0xcb,0x40]);
  const result=await probeZ80SoundExecution(rom,[0],{
    targetTStates:30,maxSteps:30,
    nativeControls:controls([event(0,0x28)],0x71)
  });
  assert.equal(result.status,'LAB_ADVANCE_OK');
  assert.equal(result.native_sound_controls_supplied,true);
  assert.equal(result.native_sound_controls_total,1);
  assert.equal(result.native_sound_controls_applied,1);
  assert.equal(result.first_sound_command_tstates_after_release,0);
  assert.equal(result.max_sound_command_lateness_tstates,0);
  assert.equal(result.ym_port_writes_from_running_z80,1);
  assert.equal(result.native_ym_events_replayed,false);
  assert.equal(result.sound_control_phase_native_verified,false);
  assert.equal(result.rom_bytes_exported,false);
});

test('B4.T3-B3 late native command applies after whole Z80 instruction with audited skew',async()=>{
  const rom=new Uint8Array(0x8000);
  // LD A,(C800); LD (E001),A; JR -8 loops back for next latch value.
  rom.set([0x3a,0x00,0xc8,0x32,0x01,0xe0,0x18,0xf8,0xcb,0x40]);
  const result=await probeZ80SoundExecution(rom,[0],{
    targetTStates:90,maxSteps:30,
    nativeControls:controls([event(64,0x42)],0x10) // due t=16, applied after t=26
  });
  assert.equal(result.status,'LAB_ADVANCE_OK');
  assert.equal(result.native_sound_controls_applied,1);
  assert.equal(result.first_sound_command_tstates_after_release,16);
  assert.equal(result.max_sound_command_lateness_tstates,10);
  assert.ok(result.ym_port_writes_from_running_z80>=2);
  assert.equal(result.native_ym_events_replayed,false);
  assert.equal(result.native_instruction_parity_verified,false);
});

test('B4.T3-B3 future commands are not injected before their timestamp',async()=>{
  const rom=new Uint8Array(0x8000);
  rom.set([0xfb,0x76,0xcb,0x40]);
  const result=await probeZ80SoundExecution(rom,[0],{
    targetTStates:100,maxSteps:100,
    nativeControls:controls([event(4000,0x31)])
  });
  assert.equal(result.status,'LAB_ADVANCE_OK');
  assert.equal(result.native_sound_controls_total,1);
  assert.equal(result.native_sound_controls_applied,0);
  assert.equal(result.first_sound_command_tstates_after_release,1000);
  assert.equal(result.irq_acknowledged_lab,0);
});

test('B4.T3-B3 malformed or out-of-order native controls fail closed before ROM execution',async()=>{
  const rom=new Uint8Array(0x8000);
  const invalid=[
    controls([event(7,0x20)]),
    controls([event(32,0x20),event(16,0x10)]),
    controls([event(0,256)]),
    controls([{kind:'YM2203_WRITE',tick12m:0,value:0x77}]),
    controls([event(0,0x21)],256),
    {...controls([]),irq_phase_native_verified:true},
    {...controls([]),clock:'FAKE_CLOCK'},
    {...controls([]),pre_release_latch:undefined}
  ];
  for(const specimen of invalid)
    await assert.rejects(()=>probeZ80SoundExecution(rom,[0],{
      nativeControls:specimen
    }),e=>e instanceof AudioZ80ProbeStop&&
           e.code==='AUDIO_T3_PROBE_CONTROLS_INVALID');
  await assert.rejects(()=>probeZ80SoundExecution(rom,[0],{
    nativeControls:controls([]),latchValue:0x28
  }),AudioZ80ProbeStop);
});

test('B4.T3-B3 native command windows share one global Z80 step budget',async()=>{
  const rom=new Uint8Array(0x8000);
  rom.set([0x18,0xfe,0xcb,0x40]);
  const result=await probeZ80SoundExecution(rom,[0],{
    targetTStates:200,maxSteps:5,
    nativeControls:controls([event(96,0x21),event(192,0x29)])
  });
  assert.equal(result.status,'STOP_BEFORE_TARGET');
  assert.equal(result.reason,'AUDIO_Z80_LAB_STEP_BUDGET_STOP');
  assert.equal(result.executed_steps,5);
  assert.equal(result.native_sound_controls_applied,2);
  assert.equal(result.ym_port_writes_from_running_z80,0);
});

test('B4.T3-B4 long native capture timeline is accepted without future input injection',async()=>{
  const rom=new Uint8Array(0x8000);
  rom.set([0xfb,0x76,0xcb,0x40]);
  const result=await probeZ80SoundExecution(rom,[0],{
    targetTStates:100,maxSteps:100,
    nativeControls:controls([event(160_000_000,0x31),
      event(1_200_000_000,0x40)])
  });
  assert.equal(result.status,'LAB_ADVANCE_OK');
  assert.equal(result.native_sound_controls_total,2);
  assert.equal(result.native_sound_controls_applied,0);
  assert.equal(result.first_sound_command_tstates_after_release,40_000_000);
  assert.equal(result.ym_port_writes_from_running_z80,0);
  assert.equal(result.native_ym_events_replayed,false);
});

test('B4.T3-B4 bounded IM1 IRQ probe crosses first HOLD_LINE approximation without commands',async()=>{
  const rom=new Uint8Array(0x8000);
  rom.set([0xed,0x56,0xfb,0x76,0x18,0xfe,0xcb,0x40],0);
  rom.set([0xc9,0xcb,0x40],0x38);
  const result=await probeZ80SoundExecution(rom,[0,0x38],{
    targetTStates:12540,maxSteps:10000,
    nativeControls:controls([event(160_000_000,0x31)])
  });
  assert.equal(result.status,'LAB_ADVANCE_OK');
  assert.ok(result.irq_requests>=1);
  assert.ok(result.irq_acknowledged_lab>=1);
  assert.equal(result.native_sound_controls_applied,0);
  assert.equal(result.native_instruction_parity_verified,false);
  assert.equal(result.irq_phase_parity_verified,false);
});

test('B4.T3-B4 captive input time safety ceiling rejects out-of-range captures',async()=>{
  const rom=new Uint8Array(0x8000);
  const above=12_000_000*3600+8;
  await assert.rejects(()=>probeZ80SoundExecution(rom,[0],{
    nativeControls:controls([event(above,0x32)])
  }),e=>e instanceof AudioZ80ProbeStop&&
       e.code==='AUDIO_T3_PROBE_CONTROLS_INVALID');
});
