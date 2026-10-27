import test from 'node:test';
import assert from 'node:assert/strict';
import {compileZ80Prefix} from '../src/gngb_z80_static_codegen.mjs';
import {createZ80SoundBus,Z80_SOUND_HARDWARE} from '../src/gngb_z80_sound_bus.mjs';
import {createZ80SchedulerLab,AudioZ80SchedulerStop}
  from '../src/gngb_z80_scheduler_lab.mjs';

async function hardware(bytes,{vector=null,onYmWrite=null}={}) {
  const rom=new Uint8Array(0x8000);
  rom.set([...bytes,0xcb,0x40]);
  if(vector!==null)rom.set(vector,0x38);
  const result=compileZ80Prefix(rom,{entries:vector!==null?[0,0x38]:[0]});
  const mod=await import('data:text/javascript,'+encodeURIComponent(result.source));
  const bus=createZ80SoundBus(rom,{onYmWrite});
  const scheduler=createZ80SchedulerLab(mod.z80AotBlocks,bus);
  return {scheduler,bus,result};
}
const release=({bus,scheduler})=>{
  bus.applyMainEvent({kind:'AUDIO_RESET_LINE',cycle:0,value:1});
  scheduler.syncBoardReset();
};

test('B4.T3-A IRQ timing constants and reset-held scheduler gate',async()=>{
  const lab=await hardware([0x00,0x76]);
  assert.equal(Z80_SOUND_HARDWARE.z80IrqPeriodTStates,12500);
  assert.equal(lab.scheduler.snapshot().inReset,true);
  assert.throws(()=>lab.scheduler.step(),e=>e instanceof AudioZ80SchedulerStop&&
    e.code==='AUDIO_Z80_LAB_CPU_IN_RESET');
  release(lab);
  assert.equal(lab.scheduler.snapshot().inReset,false);
  assert.deepEqual([lab.scheduler.state.pc,lab.scheduler.state.im,
    lab.scheduler.state.iff1,lab.scheduler.state.aAlt],[0,0,false,0]);
});

test('B4.T3-A EI then HALT with mode 1 services 240Hz IRQ at 12500T and RET returns',async()=>{
  const lab=await hardware([0xed,0x56,0xfb,0x76],{vector:[0xc9,0xcb,0x40]});
  release(lab);
  lab.scheduler.state.sp=0xc100;
  assert.equal(lab.scheduler.step(),'Z80_AOT_INSTRUCTION'); // IM 1 (8T)
  assert.equal(lab.scheduler.step(),'Z80_AOT_INSTRUCTION'); // EI (4T)
  assert.deepEqual([lab.scheduler.state.im,lab.scheduler.state.eiDelay,
    lab.scheduler.state.iff1],[1,1,true]);
  lab.scheduler.step(); // HALT (4T), EI inhibition expires
  assert.deepEqual([lab.scheduler.state.halted,lab.scheduler.state.eiDelay,
    lab.scheduler.state.t],[true,0,16]);
  const before=lab.scheduler.advanceTo(12500);
  assert.equal(before.irqAcknowledgements,0);
  assert.equal(before.boundaryOvershootTStates,0);
  assert.equal(lab.scheduler.state.pc,4);
  assert.equal(lab.scheduler.step(),'IM1_IRQ_ACK');
  assert.deepEqual([lab.scheduler.state.pc,lab.scheduler.state.sp,
    lab.scheduler.state.t,lab.scheduler.state.halted,
    lab.scheduler.state.iff1,lab.scheduler.state.iff2],
    [0x38,0xc0fe,12513,false,false,false]);
  assert.equal(lab.bus.read8(0xc0fe,12513),4);
  assert.equal(lab.bus.read8(0xc0ff,12513),0);
  assert.equal(lab.scheduler.snapshot().irqAcknowledged,1);
  lab.scheduler.step(); // RET IRQ
  assert.deepEqual([lab.scheduler.state.pc,lab.scheduler.state.sp,
    lab.scheduler.state.t],[4,0xc100,12523]);
  assert.equal(lab.scheduler.snapshot().nativeZ80ParityVerified,false);
});

test('B4.T3-A DI plus HALT keeps periodic IRQ pending but cannot acknowledge',async()=>{
  const lab=await hardware([0xf3,0x76]);
  release(lab);
  lab.scheduler.step();lab.scheduler.step();
  lab.scheduler.advanceTo(12500);
  assert.equal(lab.scheduler.step(),'HALT_IDLE_LAB');
  const snapshot=lab.scheduler.snapshot();
  assert.equal(snapshot.irqRequests,1);
  assert.equal(snapshot.irqAcknowledged,0);
  assert.equal(snapshot.irqPending,true);
  assert.equal(snapshot.halted,true);
  assert.equal(snapshot.nativeZ80ParityVerified,false);
});

test('B4.T3-A IM0 and IM2 fail closed before IRQ stack mutation',async()=>{
  for(const im of [0,2]){
    const lab=await hardware([0xfb,0x76],{vector:[0xc9,0xcb,0x40]});
    release(lab);
    lab.scheduler.state.im=im;
    lab.scheduler.state.sp=0xc100;
    lab.scheduler.step();lab.scheduler.step();
    lab.scheduler.advanceTo(12500);
    const before={...lab.scheduler.state};
    assert.throws(()=>lab.scheduler.step(),e=>
      e instanceof AudioZ80SchedulerStop&&
      e.code==='AUDIO_Z80_LAB_IRQ_MODE_NOT_SUPPORTED');
    assert.deepEqual(lab.scheduler.state,before);
  }
});

test('B4.T3-A IM1 handler must be compiled; fail before writing to sound RAM',async()=>{
  const lab=await hardware([0xfb,0x76]);
  release(lab);
  lab.scheduler.state.im=1;
  lab.scheduler.state.sp=0xc100;
  lab.scheduler.step();lab.scheduler.step();lab.scheduler.advanceTo(12500);
  assert.throws(()=>lab.scheduler.step(),/AUDIO_Z80_LAB_IRQ_VECTOR_NOT_COMPILED/);
  assert.equal(lab.bus.read8(0xc0fe,12500),0);
});

test('B4.T3-A reset assertion clears CPU/IFF/HALT state and IRQ phase but preserves global clock',async()=>{
  const lab=await hardware([0xfb,0x76]);
  release(lab);
  lab.scheduler.step();lab.scheduler.step();
  assert.equal(lab.scheduler.state.halted,true);
  lab.bus.applyMainEvent({kind:'AUDIO_RESET_LINE',cycle:1,value:0});
  assert.throws(()=>lab.scheduler.step(),/AUDIO_Z80_LAB_RESET_SYNC_REQUIRED/);
  lab.scheduler.syncBoardReset();
  assert.deepEqual([lab.scheduler.state.pc,lab.scheduler.state.t,
    lab.scheduler.state.iff1,lab.scheduler.state.halted],
    [0,8,false,false]);
  assert.equal(lab.scheduler.snapshot().nextIrqTState,12508);
  assert.equal(lab.scheduler.snapshot().resets,1);
  lab.bus.applyMainEvent({kind:'AUDIO_RESET_LINE',cycle:2,value:1});
  lab.scheduler.syncBoardReset();
  assert.equal(lab.scheduler.step(),'Z80_AOT_INSTRUCTION');
  assert.equal(lab.scheduler.state.pc,1);
});

test('B4.T3-A sound latch drives real AOT MMIO YM writes, not replayed MAME audio tape',async()=>{
  const audio=[];
  const lab=await hardware([0x3a,0x00,0xc8,0x32,0x01,0xe0,0x76],
    {onYmWrite:e=>audio.push(e)});
  release(lab);
  lab.bus.applyMainEvent({kind:'SOUNDLATCH_WRITE',value:0x28,cycle:1});
  lab.scheduler.step(); // LD A,(C800)
  lab.scheduler.step(); // LD (E001),A, emitted via live Z80 bus
  assert.equal(lab.scheduler.state.a,0x28);
  assert.deepEqual(audio.map(e=>[e.addr,e.value,e.z80TState,e.tick12m]),
    [[0xe001,0x28,26,104]]);
  assert.equal(lab.scheduler.snapshot().audioWorking,false);
});

test('B4.T3-A instruction boundary overshoot and bounded run avoid infinite silent loops',async()=>{
  const lab=await hardware([0x18,0xfe]); // JR -2, 12 T per step
  release(lab);
  const report=lab.scheduler.advanceTo(15);
  assert.deepEqual([report.steps,report.requestedTState,
    report.actualTState,report.boundaryOvershootTStates],[2,15,24,9]);
  assert.equal(report.nativeTimingParityVerified,false);
  assert.throws(()=>lab.scheduler.advanceTo(100,{maxSteps:4}),
    /AUDIO_Z80_LAB_STEP_BUDGET_STOP/);
  assert.equal(lab.scheduler.snapshot().nativeZ80ParityVerified,false);
});
