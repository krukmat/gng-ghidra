import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createEvaluation,compareEvaluations} from '../../bot/evaluation.mjs';

const sample=(frame,world,lives=3,stage=1)=>({frame,world,y:100,lives,stage});
function evaluate(samples,{status='FRAMES_DONE',frames=4000,...options}={}){
  const evaluation=createEvaluation({startFrame:2000,...options});
  samples.forEach(evaluation.observe);
  return evaluation.finish({status,frames});
}

test('a safe position outranks a condemned historical peak',()=>{
  const doomed=evaluate([sample(2000,1000),sample(2700,1606),
    sample(2800,1606,2),sample(3200,32,2)]);
  const safe=evaluate([sample(2000,1000),sample(2700,1400),sample(4000,1400)]);
  assert.equal(doomed.maxWorld,1606);
  assert.equal(doomed.finalWorld,32);
  assert.equal(doomed.firstLifeLossFrame,2800);
  assert.equal(doomed.survivalFrames,800);
  assert.equal(safe.survivalFrames,2000);
  assert.ok(compareEvaluations(safe,doomed)<0);
  assert.deepEqual([doomed,safe].sort(compareEvaluations),[safe,doomed]);
});

test('respawn and later extra lives cannot erase accumulated life losses',()=>{
  const result=evaluate([sample(1900,9999),sample(2000,1000),sample(2100,1200),
    sample(2200,1200,2),sample(2300,40,2),sample(2400,2000,3),
    sample(2500,2100,2)]);
  assert.equal(result.initialLives,3);
  assert.equal(result.endLives,2);
  assert.equal(result.livesLost,2);
  assert.equal(result.firstLifeLossFrame,2200);
  assert.equal(result.maxWorld,1200);
  assert.equal(result.finalWorld,2100);
  assert.equal(result.positionResets,1);
  assert.equal(result.survivalFrames,200);
});

test('a fall must exceed 256 world units to count as a position reset',()=>{
  const result=evaluate([sample(2000,1200),sample(2100,944),sample(2200,687)]);
  assert.equal(result.positionResets,1);
});

test('stage changes remain candidate events and never imply a cleared level',()=>{
  const result=evaluate([sample(2000,1000),sample(2100,1001,3,2),
    sample(2200,1002,3,2),sample(2300,1003,3,1)]);
  assert.deepEqual(result.stageCandidateChanges,[
    {frame:2100,from:1,to:2},{frame:2300,from:2,to:1},
  ]);
  assert.equal(Object.hasOwn(result,'stageClear'),false);
  assert.equal(Object.hasOwn(result,'stageCleared'),false);
});

test('unknown samples do not manufacture observations or life events',()=>{
  const result=evaluate([sample(2000,1000),
    {frame:2100,known:false,world:9999,lives:0,stage:99},sample(2200,1100)]);
  assert.equal(result.known,false);
  assert.equal(result.maxWorld,1100);
  assert.equal(result.livesLost,0);
  assert.deepEqual(result.stageCandidateChanges,[]);
  assert.deepEqual(result.checkpoints.map(x=>x.frame),[2000,2200]);
  const missing=evaluate([{frame:2100,known:false}]);
  assert.equal(missing.known,false);
  assert.equal(missing.maxWorld,null);
  assert.equal(missing.finalWorld,null);
  assert.deepEqual(missing.checkpoints,[]);
  assert.equal(evaluate([]).known,false);
});

test('ranking prioritizes completed known evaluations before spatial metrics',()=>{
  const base=evaluate([sample(2000,1000)]);
  const halted={...base,status:'UNCOMPILED',finalWorld:9999};
  const unknown={...base,known:false,finalWorld:9999};
  assert.ok(compareEvaluations(base,halted)<0);
  assert.ok(compareEvaluations(base,unknown)<0);
  assert.equal(compareEvaluations(base,{...base}),0);
  assert.ok(compareEvaluations({...base,finalWorld:1001},base)<0);
  assert.ok(compareEvaluations({...base,maxWorld:1001},base)<0);
  assert.ok(compareEvaluations({...base,survivalFrames:2001},base)<0);
});

test('checkpoints contain observed scalar values without inventing skipped frames',()=>{
  const result=evaluate([sample(2000,1000),sample(2001,1001),sample(2099,1002),
    sample(2250,1003),sample(2299,1004),sample(2300,1005)]);
  assert.deepEqual(result.checkpoints,[sample(2000,1000),sample(2250,1003),
    sample(2300,1005)]);
});

test('halt before the evaluated segment reports no observed progress',()=>{
  const evaluation=createEvaluation({startFrame:2000});
  evaluation.observe(sample(1500,500));
  const result=evaluation.finish({status:'UNCOMPILED',frames:1600,pc:0x5000,bank:3});
  assert.equal(result.known,false);
  assert.equal(result.maxWorld,null);
  assert.equal(result.survivalFrames,0);
  assert.equal(result.pc,0x5000);
  assert.equal(result.bank,3);
});

test('invalid observations and reuse fail closed',()=>{
  assert.throws(()=>createEvaluation({startFrame:-1}),/INVALID_START_FRAME/);
  assert.throws(()=>createEvaluation({startFrame:0,checkpointEvery:0}),
    /INVALID_CHECKPOINT_EVERY/);
  const evaluation=createEvaluation({startFrame:2000});
  evaluation.observe(sample(2000,1000));
  assert.throws(()=>evaluation.observe(sample(2000,1001)),/FRAME_ORDER/);
  evaluation.observe(sample(2100,1001));
  assert.throws(()=>evaluation.observe(sample(2001,1001)),/FRAME_ORDER/);
  evaluation.finish({status:'FRAMES_DONE',frames:2100});
  assert.throws(()=>evaluation.observe(sample(2200,1001)),/FINISHED/);
  assert.throws(()=>evaluation.finish({status:'FRAMES_DONE',frames:2200}),/FINISHED/);
});
