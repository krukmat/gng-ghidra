import test from 'node:test';
import assert from 'node:assert/strict';
import {browserAudioSnapshot,browserAudioReady,browserAudioContinuityStop}
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
  assert.equal(s.stop,null);
  assert.equal(browserAudioReady(s),true);
});
