/**
 * G5 audio-side boundary gate for compiled Z80 instructions.
 * Does NOT deliver or acknowledge interrupts, schedule IRQ 240 Hz, or
 * claim a runnable CPU: it only models maskable-INT eligibility.
 *
 * EI sets IFF1/IFF2 immediately and blocks maskable IRQs until after
 * the following instruction. The AOT block writes eiDelay=2; this wrapper
 * consumes the current instruction boundary, leaving eiDelay=1.
 * After the next FULL instruction, the helper reaches eiDelay=0.
 *
 * Caller must execute each compiled block through this helper if its
 * maskable-IRQ eligibility result is to be meaningful.
 */
export class AudioZ80BoundaryStop extends Error {
  constructor(code){super(code);this.code=code;}
}
function requireState(state){
  if(!state||typeof state!=='object'||!Number.isInteger(state.pc)||
    state.pc<0||state.pc>65535||
    !Number.isSafeInteger(state.t)||state.t<0 ||
    ![undefined,0,1].includes(state.eiDelay))
    throw new AudioZ80BoundaryStop('AUDIO_Z80_IRQ_BOUNDARY_BAD_STATE');
}
export function canAcceptZ80MaskableIrq(state){
  requireState(state);
  // Eligibility only: pending signal, reset, IM0/1/2, and NMI are
  // scheduler-level concerns NOT handled in this module.
  return state.iff1===true && (state.eiDelay??0)===0;
}
export function stepZ80AotAtBoundary(blocks,state,bus){
  requireState(state);
  if(!(blocks instanceof Map))throw new AudioZ80BoundaryStop('AUDIO_Z80_IRQ_BAD_BLOCKS');
  const block=blocks.get(state.pc);
  if(typeof block!=='function')
    throw new AudioZ80BoundaryStop('AUDIO_Z80_IRQ_UNCOMPILED_PC');
  const old=state.eiDelay??0;
  const originalT=state.t;
  block(state,bus);
  if(!Number.isSafeInteger(state.t)||state.t<=originalT||
     !Number.isInteger(state.pc)||state.pc<0||state.pc>65535)
    throw new AudioZ80BoundaryStop('AUDIO_Z80_IRQ_INVALID_STEP');
  // Newly executed EI has precedence over any previous EI delay.
  if(state.eiDelay===2)state.eiDelay=1;
  else if(old===1&&state.eiDelay===1)state.eiDelay=0;
  requireState(state);
  return Object.freeze({
    pc:state.pc,tStates:state.t,
    maskableIrqEligible:canAcceptZ80MaskableIrq(state),
    // Eligibility is NOT acknowledgement or IRQ/native parity.
    irqAcknowledged:false,nativeParityVerified:false
  });
}
