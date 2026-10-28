/** Pure, ROM-free browser AudioWorklet acceptance checks for G5 T3.7. */
export const AUDIO_BROWSER_QUEUE_CAPACITY=12500;
const valid=n=>Number.isFinite(n)&&n>=0;
const sanitizedCode=c=>typeof c==='string'&&/^[A-Z0-9_]{3,80}$/.test(c)?c:null;

export function browserAudioSnapshot(raw){
  if(raw?.mode!=='REAL_AOT'||!Number.isSafeInteger(raw.sessionId)||
     !Number.isSafeInteger(raw.cycle)||raw.cycle<0)
    throw Error('AUDIO_BROWSER_STATE_INVALID');
  const a=raw.audio??{},w=a.worklet??{};
  return {
    id:raw.sessionId,paused:raw.operatorPause===true,
    halted:raw.halt!==null&&raw.halt!==undefined,
    active:a.active===true,stop:sanitizedCode(a.stop),
    queued:a.queuedSamples,delivered:a.deliveredSamples,
    produced:a.producedSamples,nonzero:a.nonzeroSamples,
    frame:raw.frame,wstate:w.state??null,
    out:w.producedOutputSamples,missing:w.missingOutputSamples,
    lastInput:w.lastInputSample,avMs:w.avMs,rate:w.sampleRate
  };
}
export function browserAudioReady(s){
  return s.id>=1&&!s.paused&&!s.halted&&s.active&&!s.stop&&
    s.wstate==='PLAYING'&&valid(s.out)&&s.out>0&&
    valid(s.missing)&&valid(s.queued)&&
    valid(s.produced)&&valid(s.delivered)&&valid(s.nonzero);
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
