/** Pure, ROM-free browser AudioWorklet acceptance checks for G5 T3.7. */
export const AUDIO_BROWSER_QUEUE_CAPACITY=12500;
const valid=n=>Number.isFinite(n)&&n>=0;
const sanitizedCode=c=>typeof c==='string'&&/^[A-Z0-9_]{3,80}$/.test(c)?c:null;
export const browserAudioSafeStopReason=error=>
  sanitizedCode(error?.message)??'AUDIO_BROWSER_UNEXPECTED_STOP';

export function browserAudioSnapshot(raw){
  if(raw?.mode!=='REAL_AOT'||!Number.isSafeInteger(raw.sessionId)||
     !Number.isSafeInteger(raw.cycle)||raw.cycle<0)
    throw Error('AUDIO_BROWSER_STATE_INVALID');
  const a=raw.audio??{},w=a.worklet??{};
  return {
    id:raw.sessionId,paused:raw.operatorPause===true,
    halted:raw.halt!==null&&raw.halt!==undefined,
    active:a.active===true,
    stop:a.stop===null||a.stop===undefined?null:
      sanitizedCode(a.stop)??'AUDIO_BROWSER_REDACTED_STOP',
    queued:a.queuedSamples,delivered:a.deliveredSamples,
    produced:a.producedSamples,nonzero:a.nonzeroSamples,
    frame:raw.frame,wstate:w.state??null,
    out:w.producedOutputSamples,missing:w.missingOutputSamples,
    lastInput:w.lastInputSample,avMs:w.avMs,rate:w.sampleRate
  };
}
// Return the *first* unmet requirement, rather than a boolean-only
// 120-second startup timeout. All codes are safe to print or persist.
export function browserAudioStartBlock(s){
  if(!s||!Number.isSafeInteger(s.id)||s.id<1)
    return 'AUDIO_BROWSER_NO_LIVE_SESSION';
  if(s.halted)return 'AUDIO_BROWSER_ENGINE_HALT';
  if(s.stop)return 'AUDIO_BROWSER_PRODUCER_STOP';
  if(s.paused)return 'AUDIO_BROWSER_OPERATOR_PAUSED';
  if(!s.active)return 'AUDIO_BROWSER_AUDIO_NOT_ACTIVATED';
  if(s.wstate===null)return 'AUDIO_BROWSER_WORKLET_TELEMETRY_ABSENT';
  if(s.wstate==='WAITING')return 'AUDIO_BROWSER_WORKLET_WAITING_FOR_PCM';
  if(s.wstate==='STOP')return 'AUDIO_BROWSER_WORKLET_STOPPED';
  if(s.wstate!=='PLAYING')return 'AUDIO_BROWSER_WORKLET_STATE_INVALID';
  if(!valid(s.missing)||s.missing>0)
    return 'AUDIO_BROWSER_WORKLET_PRIOR_UNDERRUN';
  if(!valid(s.out)||s.out===0)return 'AUDIO_BROWSER_WORKLET_NO_OUTPUT';
  if(!valid(s.queued)||!valid(s.produced)||!valid(s.delivered)||
     !valid(s.nonzero))return 'AUDIO_BROWSER_COUNTERS_MISSING';
  return null;
}
export function browserAudioReady(s){
  return browserAudioStartBlock(s)===null;
}
export function browserAudioSafeStartupState(s){
  if(!s)return null;
  return Object.freeze({
    sessionId:s.id,paused:s.paused,engineHalted:s.halted,
    audioActivated:s.active,producerStop:s.stop,
    workletState:s.wstate,workletOutputSamples:valid(s.out)?s.out:null,
    workletMissingSamples:valid(s.missing)?s.missing:null,
    queuedSourceSamples:valid(s.queued)?s.queued:null,
    deliveredSourceSamples:valid(s.delivered)?s.delivered:null
  });
}
export function browserAudioContinuityStop(s,session,prior){
  if(s.id!==session)return 'AUDIO_BROWSER_SESSION_CHANGED_DURING_WINDOW';
  if(s.halted)return 'AUDIO_BROWSER_ENGINE_HALT';
  if(s.paused)return 'AUDIO_BROWSER_OPERATOR_PAUSED';
  if(!s.active)return 'AUDIO_BROWSER_AUDIO_INACTIVE';
  if(s.stop)return 'AUDIO_BROWSER_PRODUCER_STOP';
  if(s.wstate!=='PLAYING')return 'AUDIO_BROWSER_WORKLET_NOT_PLAYING';
  if(!valid(s.queued)||s.queued>AUDIO_BROWSER_QUEUE_CAPACITY)
    return 'AUDIO_BROWSER_QUEUE_LIMIT';
  if(!valid(s.missing)||s.missing>prior.missing)
    return 'AUDIO_BROWSER_WORKLET_UNDERRUN';
  if(!valid(s.out)||s.out<prior.out)
    return 'AUDIO_BROWSER_OUTPUT_COUNTER_REVERSED';
  if(!valid(s.produced)||s.produced<prior.produced)
    return 'AUDIO_BROWSER_PRODUCER_COUNTER_REVERSED';
  if(!valid(s.delivered)||s.delivered<prior.delivered)
    return 'AUDIO_BROWSER_DELIVERY_COUNTER_REVERSED';
  return null;
}
