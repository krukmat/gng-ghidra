import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createVisualProgressTracker} from '../../bot/perception/progress.mjs';

const sample=(frame,extra={})=>({
  frame,session:'session-A',lifeKey:'life-1',screenX:100,
  scrollDelta:0,confidence:0.99,playing:true,...extra,
});

test('stationary screen plus camera motion is candidate new progress',()=>{
  const tracker=createVisualProgressTracker({windowFrames:3,minAdvancePx:3});
  assert.equal(tracker.observe(sample(1)).label,'UNKNOWN');
  for(let f=2;f<=3;f++)
    assert.equal(tracker.observe(sample(f,{scrollDelta:2})).label,'UNKNOWN');
  const result=tracker.observe(sample(4,{scrollDelta:2}));
  assert.equal(result.label,'ADVANCE_CANDIDATE');
  assert.equal(result.relativeX,6);
  assert.equal(result.maxRelativeX,6);
});

test('stationary pixels are a plateau candidate, never a stage clear',()=>{
  const tracker=createVisualProgressTracker({windowFrames:3});
  for(let f=1;f<=3;f++)tracker.observe(sample(f));
  const result=tracker.observe(sample(4));
  assert.equal(result.label,'PLATEAU_CANDIDATE');
  assert.equal(result.relativeX,0);
  assert.equal(Object.hasOwn(result,'stageClear'),false);
});

test('an uncertain frame resets the displacement anchor',()=>{
  const tracker=createVisualProgressTracker({windowFrames:2});
  tracker.observe(sample(1));
  tracker.observe(sample(2,{scrollDelta:4}));
  assert.equal(tracker.observe(sample(3,{confidence:0.5})).label,'UNKNOWN');
  const restart=tracker.observe(sample(4,{scrollDelta:50}));
  assert.equal(restart.reason,'NEW_ANCHOR');
  assert.equal(restart.relativeX,0);
});

test('life and session changes never inherit prior progress',()=>{
  const tracker=createVisualProgressTracker({windowFrames:2});
  tracker.observe(sample(1));
  tracker.observe(sample(2,{scrollDelta:5}));
  assert.equal(tracker.observe(sample(3,{lifeKey:'life-2'})).relativeX,0);
  assert.equal(tracker.observe(sample(4,{session:'session-B'})).relativeX,0);
  assert.equal(tracker.observe(sample(5,{lifeKey:null})).label,'UNKNOWN');
  assert.equal(tracker.observe(sample(6)).reason,'NEW_ANCHOR');
});

test('death, out-of-order frames and large jumps fail closed',()=>{
  const tracker=createVisualProgressTracker({windowFrames:2});
  tracker.observe(sample(1));
  assert.equal(tracker.observe(sample(2,{playing:false})).label,'UNKNOWN');
  assert.equal(tracker.observe(sample(3)).reason,'NEW_ANCHOR');
  assert.equal(tracker.observe(sample(3)).reason,'STALE_OR_GAPPED_FRAME');
  assert.equal(tracker.observe(sample(4)).reason,'NEW_ANCHOR');
  assert.equal(tracker.observe(sample(5,{scrollDelta:100})).reason,
    'IMPLAUSIBLE_MOTION');
});

test('negative movement cannot be counted as new advance',()=>{
  const tracker=createVisualProgressTracker({windowFrames:2});
  tracker.observe(sample(1));
  tracker.observe(sample(2,{screenX:95}));
  const result=tracker.observe(sample(3,{screenX:90}));
  assert.equal(result.label,'UNKNOWN');
  assert.equal(result.reason,'NO_CONFIRMED_NEW_PROGRESS');
});

test('invalid configuration and frame are rejected',()=>{
  assert.throws(()=>createVisualProgressTracker({minConfidence:2}),/OPTIONS/);
  assert.throws(()=>createVisualProgressTracker({windowFrames:0}),/OPTIONS/);
  assert.throws(()=>createVisualProgressTracker().observe(sample(-1)),/FRAME/);
});
