/**
 * G5 B4.T3-A: isolated, deterministic Z80 sound-CPU scheduler LAB.
 *
 * NO MC6809 engine wiring, PCM synthesis, bot changes or native parity.
 * MAME 0.288 capcom/gng.cpp uses 240 Hz set_periodic_int and irq0_line_hold
 * (HOLD_LINE). This lab approximates asserted-line persistence as one pending
 * bit until acknowledgement. IRQ phase and CPU/native parity are unverified.
 * Only IM1 is serviced.
 * 12500 T-states per period; Z80 IM1 acknowledgement is 13 T-states.
 * The fixed step API can overshoot a requested target to finish an instruction.
 */
import {stepZ80AotAtBoundary,canAcceptZ80MaskableIrq}
  from './gngb_z80_irq_boundary.mjs';
import {Z80_SOUND_HARDWARE} from './gngb_z80_sound_bus.mjs';

export class AudioZ80SchedulerStop extends Error {
  constructor(code){super(code);this.code=code;}
}
const safeT=value=>Number.isSafeInteger(value)&&value>=0;
const PC16=value=>Number.isInteger(value)&&value>=0&&value<=65535;
const CPU_ZERO=Object.freeze({
  pc:0,sp:0xffff,t:0,a:0,f:0,bc:0,de:0,hl:0,ix:0,iy:0,
  aAlt:0,fAlt:0,bcAlt:0,deAlt:0,hlAlt:0,
  i:0,r:0,im:0,iff1:false,iff2:false,eiDelay:0,halted:false
});
export function createZ80SchedulerLab(blocks,bus,{
  irqPeriodTStates=Z80_SOUND_HARDWARE.z80IrqPeriodTStates,
  maxStepsPerAdvance=100000
}={}) {
  if(!(blocks instanceof Map)||
     [...blocks.values()].some(fn=>typeof fn!=='function')||
     !bus||typeof bus.read8!=='function'||typeof bus.write8!=='function'||
     typeof bus.resetAsserted!=='boolean' ||
     !Number.isSafeInteger(irqPeriodTStates)||irqPeriodTStates<4||
     irqPeriodTStates>1000000||
     !Number.isInteger(maxStepsPerAdvance)||maxStepsPerAdvance<1||
     maxStepsPerAdvance>1000000)
    throw new AudioZ80SchedulerStop('AUDIO_Z80_LAB_SCHEDULER_BAD_CONFIG');

  const state={...CPU_ZERO};
  let heldReset=bus.resetAsserted,irqPending=false;
  let nextIrqAt=irqPeriodTStates,irqRequests=0,irqAcknowledged=0;
  let idleHaltCycles=0,steps=0,resets=0,overshootTStates=0;
  const noteIrqDue=()=>{
    if(state.t<nextIrqAt)return;
    const count=Math.floor((state.t-nextIrqAt)/irqPeriodTStates)+1;
    if(!safeT(irqRequests+count)||!safeT(nextIrqAt+count*irqPeriodTStates))
      throw new AudioZ80SchedulerStop('AUDIO_Z80_LAB_IRQ_CLOCK_OVERFLOW');
    irqRequests+=count;
    nextIrqAt+=count*irqPeriodTStates;
    irqPending=true;
  };
  // Caller must apply board reset controls on the sound bus BEFORE syncing.
  const syncBoardReset=()=>{
    if(bus.resetAsserted) {
      if(!heldReset) {
        const now=state.t;
        Object.assign(state,CPU_ZERO,{t:now});
        irqPending=false;
        nextIrqAt=now+irqPeriodTStates;
        resets++;
      }
      heldReset=true;
    } else heldReset=false;
    return snapshot();
  };
  const checkReady=()=>{
    if(bus.resetAsserted!==heldReset)
      throw new AudioZ80SchedulerStop('AUDIO_Z80_LAB_RESET_SYNC_REQUIRED');
    if(heldReset)throw new AudioZ80SchedulerStop('AUDIO_Z80_LAB_CPU_IN_RESET');
    if(!PC16(state.pc)||!PC16(state.sp)||!safeT(state.t)||
       ![0,1,2].includes(state.im)||typeof state.iff1!=='boolean'||
       typeof state.iff2!=='boolean')
      throw new AudioZ80SchedulerStop('AUDIO_Z80_LAB_BAD_CPU_STATE');
  };
  const acknowledgeIm1=()=>{
    if(state.im!==1)
      throw new AudioZ80SchedulerStop('AUDIO_Z80_LAB_IRQ_MODE_NOT_SUPPORTED');
    if(!blocks.has(0x38))
      throw new AudioZ80SchedulerStop('AUDIO_Z80_LAB_IRQ_VECTOR_NOT_COMPILED');
    const pc=state.pc,t=state.t,sp=state.sp;
    // Fail before modifying CPU if stack MMIO bus rejects the write;
    // caller must discard session on any bus failure after first write.
    const high=pc>>>8,low=pc&255;
    bus.write8((sp-1)&65535,high,t+10);
    bus.write8((sp-2)&65535,low,t+13);
    state.sp=(sp-2)&65535;
    state.pc=0x38;
    state.iff1=false;state.iff2=false;state.eiDelay=0;state.halted=false;
    state.t=t+13;irqPending=false;irqAcknowledged++;steps++;
    return 'IM1_IRQ_ACK';
  };
  const step=()=>{
    checkReady();
    noteIrqDue();
    if(irqPending&&canAcceptZ80MaskableIrq(state))
      return acknowledgeIm1();
    if(state.halted===true){
      // HALT cycles are idle instruction fetch periods, NOT a synthesized
      // CPU instruction or a verified MAME R-register update.
      state.t+=4;idleHaltCycles+=4;steps++;
      return 'HALT_IDLE_LAB';
    }
    stepZ80AotAtBoundary(blocks,state,bus);
    steps++;
    return 'Z80_AOT_INSTRUCTION';
  };
  const advanceTo=(target,{maxSteps=maxStepsPerAdvance}={})=>{
    if(!safeT(target)||target<state.t||!Number.isInteger(maxSteps)||
       maxSteps<1||maxSteps>maxStepsPerAdvance)
      throw new AudioZ80SchedulerStop('AUDIO_Z80_LAB_TARGET_INVALID');
    checkReady();
    let executed=0,ack=0;
    while(state.t<target) {
      if(executed>=maxSteps)
        throw new AudioZ80SchedulerStop('AUDIO_Z80_LAB_STEP_BUDGET_STOP');
      const kind=step();
      if(kind==='IM1_IRQ_ACK')ack++;
      executed++;
    }
    // Auditable boundary skew: this scheduler is not a subinstruction
    // interleaver with the MC6809, and target may be crossed.
    overshootTStates+=state.t-target;
    return Object.freeze({kind:'GNG_AUDIO_B4_T3_LAB_ADVANCE_V1',
      status:'LAB_ONLY_NOT_NATIVE_PARITY',
      steps:executed,irqAcknowledgements:ack,
      requestedTState:target,actualTState:state.t,
      boundaryOvershootTStates:state.t-target,
      nativeTimingParityVerified:false,pcmGenerated:false});
  };
  const snapshot=()=>Object.freeze({
    kind:'GNG_AUDIO_B4_T3_SCHEDULER_LAB_V1',
    status:'LAB_IM1_ONLY_PENDING_IRQ_PHASE_NOT_CERTIFIED',
    pc:state.pc,tStates:state.t,inReset:heldReset,halted:state.halted,
    interruptMode:state.im,irqPending,irqRequests,irqAcknowledged,
    interruptLineModel:'MAME_0288_HOLD_LINE_APPROXIMATION',
    nativeIrqRequestTraceObserved:false,nativeIrqAckTraceObserved:false,
    nextIrqTState:nextIrqAt,haltIdleTStates:idleHaltCycles,
    executedSteps:steps,resets,boundaryOvershootTStates:overshootTStates,
    irqPulseWidthNativeVerified:false,irqPhaseNativeVerified:false,
    romLoadedByMameVerified:false,nativeZ80ParityVerified:false,
    audioWorking:false
  });
  return Object.freeze({state,step,advanceTo,syncBoardReset,snapshot});
}
