import test from 'node:test';
import assert from 'node:assert/strict';
import {browserAudioSnapshot,browserAudioReady,browserAudioContinuityStop,
  browserAudioSafeStopReason,browserAudioStartBlock,
  browserAudioSafeStartupState}
  from '../src/gngb_audio_browser_certification.mjs';

const server=(change={})=>({
  mode:'REAL_AOT',sessionId:3,cycle:5_000_000,operatorPause:false,
  halt:null,audio:{
    active:true,stop:null,queuedSamples:2000,
    producedSamples:340000,deliveredSamples:339000,nonzeroSamples:10000,
    worklet:{state:'PLAYING',sampleRate:48000,producedOutputSamples:244800,
      missingOutputSamples:0,lastInputSample:300000,avMs:25},...change
  }
});
test('T3.7 browser acceptance reads real PLAYING state and never assumes audibility',()=>{
  const s=browserAudioSnapshot(server());
  assert.equal(browserAudioReady(s),true);
  assert.equal(browserAudioContinuityStop(s,s.id,s),null);
  assert.equal(s.rate,48000);
  assert.equal(s.avMs,25);
  assert.equal(Object.hasOwn(s,'audible'),false);
});
test('T3.7 rejects synthetic producer stats when real worklet has not reported',()=>{
  const s=browserAudioSnapshot(server({worklet:null}));
  assert.equal(browserAudioReady(s),false);
  assert.equal(browserAudioContinuityStop(s,s.id,s),
    'AUDIO_BROWSER_WORKLET_NOT_PLAYING');
});
test('T3.7 strict window catches underrun, producer stop, queue overflow',()=>{
  const prior=browserAudioSnapshot(server());
  assert.equal(browserAudioContinuityStop(
    browserAudioSnapshot(server({worklet:{...server().audio.worklet,
      missingOutputSamples:1}})),prior.id,prior),
    'AUDIO_BROWSER_WORKLET_UNDERRUN');
  assert.equal(browserAudioContinuityStop(
    browserAudioSnapshot(server({stop:'AUDIO_LIVE_BACKPRESSURE_STOP'})),
    prior.id,prior),'AUDIO_BROWSER_PRODUCER_STOP');
  assert.equal(browserAudioContinuityStop(
    browserAudioSnapshot(server({queuedSamples:12501})),
    prior.id,prior),'AUDIO_BROWSER_QUEUE_LIMIT');
});
test('T3.7 catches stale session, backwards output and operator pause',()=>{
  const prior=browserAudioSnapshot(server());
  assert.equal(browserAudioContinuityStop(
    browserAudioSnapshot({...server(),sessionId:4}),3,prior),
    'AUDIO_BROWSER_SESSION_CHANGED_DURING_WINDOW');
  assert.equal(browserAudioContinuityStop(
    browserAudioSnapshot(server({worklet:{...server().audio.worklet,
      producedOutputSamples:100}})),3,prior),
    'AUDIO_BROWSER_OUTPUT_COUNTER_REVERSED');
  assert.equal(browserAudioContinuityStop(
    browserAudioSnapshot({...server(),operatorPause:true}),3,prior),
    'AUDIO_BROWSER_OPERATOR_PAUSED');
});
test('T3.7 rejects invalid engine state and does not echo private stop details',()=>{
  assert.throws(()=>browserAudioSnapshot({mode:'FAKE',sessionId:1,cycle:0}),
    /AUDIO_BROWSER_STATE_INVALID/);
  const s=browserAudioSnapshot(server({stop:'/private/ROM.zip:bad'}));
  assert.equal(s.stop,'AUDIO_BROWSER_REDACTED_STOP');
  assert.equal(browserAudioReady(s),false);
});

test('T3.7 certifier STOP path preserves only allowed codes and never references undefined helper',()=>{
  assert.equal(browserAudioSafeStopReason(Error('AUDIO_BROWSER_WORKLET_UNDERRUN')),
    'AUDIO_BROWSER_WORKLET_UNDERRUN');
  assert.equal(browserAudioSafeStopReason(Error('/private/rom/gg2.bin')),
    'AUDIO_BROWSER_UNEXPECTED_STOP');
  assert.equal(browserAudioSafeStopReason(undefined),
    'AUDIO_BROWSER_UNEXPECTED_STOP');
});

test('T3.7 start reports missing browser gesture, pause and absent telemetry',()=>{
  const active=browserAudioSnapshot(server());
  assert.equal(browserAudioStartBlock(active),null);
  const paused=browserAudioSnapshot({...server(),operatorPause:true});
  assert.equal(browserAudioStartBlock(paused),'AUDIO_BROWSER_OPERATOR_PAUSED');
  const inactive=browserAudioSnapshot(server({active:false}));
  assert.equal(browserAudioStartBlock(inactive),'AUDIO_BROWSER_AUDIO_NOT_ACTIVATED');
  assert.equal(browserAudioStartBlock(browserAudioSnapshot(server({worklet:null}))),
    'AUDIO_BROWSER_WORKLET_TELEMETRY_ABSENT');
  const waiting=browserAudioSnapshot(server({worklet:{
    ...server().audio.worklet,state:'WAITING'} }));
  assert.equal(browserAudioStartBlock(waiting),'AUDIO_BROWSER_WORKLET_WAITING_FOR_PCM');
  const workletStopped=browserAudioSnapshot(server({worklet:{
    ...server().audio.worklet,state:'STOP'} }));
  assert.equal(browserAudioStartBlock(workletStopped),'AUDIO_BROWSER_WORKLET_STOPPED');
});

test('T3.7 start blocks previously underrun worklet and shows privacy-safe state',()=>{
  const s=browserAudioSnapshot(server({worklet:{
    ...server().audio.worklet,missingOutputSamples:3} }));
  assert.equal(browserAudioReady(s),false);
  assert.equal(browserAudioStartBlock(s),'AUDIO_BROWSER_WORKLET_PRIOR_UNDERRUN');
  const state=browserAudioSafeStartupState(s);
  assert.deepEqual(state,{
    sessionId:3,paused:false,engineHalted:false,audioActivated:true,
    producerStop:null,workletState:'PLAYING',workletOutputSamples:244800,
    workletMissingSamples:3,queuedSourceSamples:2000,
    deliveredSourceSamples:339000
  });
  const halted=browserAudioSnapshot({...server(),halt:{status:'HALT'}});
  assert.equal(browserAudioStartBlock(halted),'AUDIO_BROWSER_ENGINE_HALT');
  const producerStopped=browserAudioSnapshot(server({stop:'AUDIO_WORKLET_UNDERRUN'}));
  assert.equal(browserAudioStartBlock(producerStopped),'AUDIO_BROWSER_PRODUCER_STOP');
});
