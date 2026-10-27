/**
 * B4.T3-B2: execute only already-compiled sound Z80 instructions from a
 * caller-provided ROM and native-backed PC seed set, in the isolated bus.
 * Synthetic tests use synthetic ROM; operator CLI verifies private gg2.bin.
 * Does NOT load MAME captured YM events or generate audio from recordings.
 * Every runtime STOP propagates as a code only (never compiled ROM source).
 */
import {compileZ80Prefix} from './gngb_z80_static_codegen.mjs';
import {createZ80SoundBus,Z80_SOUND_HARDWARE} from './gngb_z80_sound_bus.mjs';
import {createZ80SchedulerLab} from './gngb_z80_scheduler_lab.mjs';

export class AudioZ80ProbeStop extends Error {
  constructor(code){super(code);this.code=code;}
}
export async function probeZ80SoundExecution(rom,roots,{
  targetTStates=12500,maxSteps=100000,latchValue=null
}={}) {
  if(!(rom instanceof Uint8Array)||rom.length!==0x8000||
     !Array.isArray(roots)||roots.length<1||roots.length>64||
     roots.some(pc=>!Number.isInteger(pc)||pc<0||pc>=0x8000)||
     !Number.isSafeInteger(targetTStates)||targetTStates<4||
     targetTStates>3000000||
     !Number.isInteger(maxSteps)||maxSteps<1||maxSteps>1000000||
     (latchValue!==null&&(!Number.isInteger(latchValue)||latchValue<0||
                          latchValue>255)))
    throw new AudioZ80ProbeStop('AUDIO_T3_PROBE_INVALID_CONFIGURATION');
  const compiled=compileZ80Prefix(rom,{entries:roots,limit:16384});
  // A data: module stays in process memory; never persisted or returned.
  const generated=await import('data:text/javascript,'+
                               encodeURIComponent(compiled.source));
  let ymWrites=0,ymChip1Writes=0,ymChip2Writes=0;
  const bus=createZ80SoundBus(rom,{onYmWrite:e=>{
    ymWrites++;
    if(e.addr<=0xe001)ymChip1Writes++;
    else ymChip2Writes++;
  }});
  const z80=createZ80SchedulerLab(generated.z80AotBlocks,bus,{
    maxStepsPerAdvance:maxSteps
  });
  bus.applyMainEvent({kind:'AUDIO_RESET_LINE',value:1,cycle:0});
  z80.syncBoardReset();
  if(latchValue!==null)
    bus.applyMainEvent({kind:'SOUNDLATCH_WRITE',value:latchValue,cycle:0});
  let runtimeStatus='LAB_ADVANCE_OK';
  let runtimeStopCode=null,advance=null;
  try {
    advance=z80.advanceTo(targetTStates,{maxSteps});
  } catch(e) {
    runtimeStatus='STOP_BEFORE_TARGET';
    const code=e?.code;
    runtimeStopCode=(typeof code==='string'&&/^AUDIO_[A-Z0-9_]{3,80}$/.test(code))?
      code:'AUDIO_T3_PROBE_UNKNOWN_STOP';
  }
  const state=z80.snapshot();
  return Object.freeze({
    kind:'GNG_AUDIO_B4_T3_Z80_NATIVE_ROM_LAB_PROBE_V1',
    status:runtimeStatus,
    reason:runtimeStopCode,
    sound_rom_shape_verified:true,
    compiled_static_rom_pcs:compiled.compiled,
    initial_native_root_count:compiled.entrypoints.length,
    compiler_pending_static_edges:compiled.pending,
    compiler_blocked_static_frontiers:compiled.blockers.length,
    target_tstates:targetTStates,
    reached_tstates:state.tStates,
    executed_steps:state.executedSteps,
    irq_requests:state.irqRequests,
    irq_acknowledged_lab:state.irqAcknowledged,
    interrupt_mode_at_stop:state.interruptMode,
    cpu_halted_at_stop:state.halted,
    ym_port_writes_from_running_z80:ymWrites,
    ym1_writes:ymChip1Writes,ym2_writes:ymChip2Writes,
    scheduler_target_overshoot:advance?.boundaryOvershootTStates??null,
    native_mame_same_rom_verified:false,
    native_instruction_parity_verified:false,
    irq_phase_parity_verified:false,
    sound_pcm_working:false,
    browser_audio_working:false,
    rom_bytes_exported:false
  });
}
