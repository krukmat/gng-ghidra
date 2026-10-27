import {test} from 'node:test';
import assert from 'node:assert/strict';
import {trailingPlateau,inspectEntry,auditReports,captureFramesAround}
  from '../../bot/diagnostics.mjs';

const metrics=(status='FRAMES_DONE',extra={})=>({
  status,frames:3600,known:true,livesLost:0,maxWorld:1279,
  finalWorld:1279,firstLifeLossFrame:null,pc:null,
  checkpoints:[
    {frame:2300,world:1200,lives:3},
    {frame:2400,world:1279,lives:3},
    {frame:2500,world:1279,lives:3},
    {frame:2600,world:1279,lives:3},
  ],...extra,
});
const entry=(id,m,mode='sweep')=>({id,plan:{cut:2100},
  tape:'out/bot/'+mode+'/trial-'+id+'.json',metrics:m});

test('plateau requires a complete, known, same-life observation window',()=>{
  assert.equal(trailingPlateau(metrics()),true);
  assert.equal(trailingPlateau(metrics('UNCOMPILED')),false);
  assert.equal(trailingPlateau(metrics('FRAMES_DONE',{known:false})),false);
  assert.equal(trailingPlateau(metrics('FRAMES_DONE',{livesLost:1})),false);
  assert.equal(trailingPlateau(metrics('FRAMES_DONE',{
    checkpoints:[{frame:2400,world:1279,lives:3},
      {frame:2500,world:1279,lives:3}]})),false);
  assert.equal(trailingPlateau(metrics('FRAMES_DONE',{
    checkpoints:[{frame:2300,world:1279,lives:3},
      {frame:2400,world:1290,lives:3},
      {frame:2600,world:1279,lives:3}]})),false);
  assert.equal(trailingPlateau(metrics('FRAMES_DONE',{
    checkpoints:[{frame:2300,world:1279,lives:3},
      {frame:2400,world:1279,lives:2},
      {frame:2600,world:1279,lives:2}]})),false);
});

test('HALT is censored, even without a life decrement',()=>{
  const result=inspectEntry(entry(1,metrics('UNCOMPILED',{
    pc:0xe79e,frames:2750,livesLost:0,maxWorld:1800})));
  assert.equal(result.kind,'CENSORED_HALT');
  assert.equal(result.pc,0xe79e);
  assert.equal(result.plateauCandidate,false);
  assert.equal(result.maxWorld,1800);
  assert.equal(Object.hasOwn(result,'stageClear'),false);
});

test('a doomed spatial peak never becomes a success',()=>{
  const result=inspectEntry(entry(6,metrics('FRAMES_DONE',{
    maxWorld:1700,finalWorld:451,livesLost:1,
    firstLifeLossFrame:2881})));
  assert.equal(result.kind,'LIFE_LOSS');
  assert.equal(result.firstLifeLossFrame,2881);
  assert.equal(result.plateauCandidate,false);
});

test('reports retain censored trials in denominator and show representative cases',()=>{
  const r=auditReports([{mode:'late-sweep',trials:5,entries:[
    entry(6,metrics('FRAMES_DONE',{maxWorld:1700,finalWorld:451,
      livesLost:1,firstLifeLossFrame:2881})),
    entry(67,metrics()),
    entry(5,metrics('UNCOMPILED',{pc:0xe79e,frames:2800})),
    entry(9,metrics('UNCOMPILED',{pc:0xc3a3,frames:2801})),
    entry(10,metrics('UNKNOWN',{known:false})),
  ]}]);
  assert.equal(r.total,5);
  assert.equal(r.completed,2);
  assert.equal(r.censored,2);
  assert.equal(r.unresolved,1);
  assert.equal(r.lifeLoss,1);
  assert.equal(r.plateauCandidates,1);
  assert.deepEqual(r.haltByPc,{'0xE79E':1,'0xC3A3':1});
  assert.equal(r.examples.peakDoomed.id,6);
  assert.equal(r.examples.plateau.id,67);
  assert.equal(r.examples.haltExamples.length,2);
});

test('report consistency and duplicated trial IDs fail closed',()=>{
  assert.throws(()=>auditReports([]),/REPORTS/);
  assert.throws(()=>auditReports([{trials:2,entries:[entry(0,metrics())]}]),
    /REPORT_TRIALS/);
  assert.throws(()=>auditReports([{trials:2,entries:[
    entry(0,metrics()),entry(0,metrics())]}]),/DUPLICATE_ID/);
  assert.throws(()=>trailingPlateau(metrics(),{windowFrames:0}),/WINDOW/);
});

test('capture hints are bounded and include the exact event frame',()=>{
  const frames=captureFramesAround(2881,{before:30,after:20,step:10,endFrame:2900});
  assert.deepEqual(frames,[2851,2861,2871,2881,2891]);
  assert.deepEqual(captureFramesAround(3500,{endFrame:3000}),[]);
  assert.throws(()=>captureFramesAround(0),/CAPTURE/);
});
