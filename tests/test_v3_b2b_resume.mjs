import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateResumeCheckpoint,checkpointOverlays}
  from '../src/v3_b2b_resume.mjs';
const original=()=>({
  code:{ramOverlays:[]},
  foundation:[{bank:null,pc:0x6000}],
  b2aMissing:{bank:null,pc:0x6400,overlay:null},
  tapeSha:'a'.repeat(64),
  seedOK:(s,code)=>s&&Number.isInteger(s.pc)&&
    (s.bank===null||Number.isInteger(s.bank))&&
    (s.overlay===null||s.overlay===undefined||
      Number.isInteger(s.overlay)&&s.overlay<code.ramOverlays.length),
  seedKey:s=>[s.bank??'F',s.pc,s.overlay??'-'].join(':'),
  compileProgram:(_code,seeds)=>({blockCount:seeds.length}),
  libUrl:'file:///tmp/aot.mjs'
});
const historical=()=>({
  schema:'gng.v3.b2b-discovery.v1',status:'BLOCKED_ITERATION_LIMIT',
  profile:'controls',tape_sha256:'a'.repeat(64),iterations:2,
  frames:892,blocks:4,seed_count:4,overlay_count:0,
  last_result:{status:'UNCOMPILED',bank:null,pc:0x6800,overlay:null},
  seeds:[{bank:null,pc:0x6000},{bank:null,pc:0x6400,overlay:null},
    {bank:null,pc:0x6500,overlay:null},
    {bank:null,pc:0x6800,overlay:null}]
});
test('resumes historical non-overlay tail without 48 replay iterations',()=>{
  const opts=original(),checkpoint=historical();
  let builds=0;
  opts.compileProgram=(_code,seeds)=>{builds++;return {blockCount:seeds.length}};
  const r=validateResumeCheckpoint({...opts,report:checkpoint});
  assert.equal(builds,1);
  assert.equal(r.iterations,2);
  assert.equal(r.seeds.length,4);
  assert.equal(r.frames,892);
  assert.equal(opts.code.ramOverlays.length,0);
});
test('rejects tampered seeds even if the header block count matches',()=>{
  const opts=original(),report=historical();
  report.seeds[2].pc=0x6400;
  assert.throws(()=>validateResumeCheckpoint({...opts,report}),/DISCOVERED_SEED_INVALID/);
});
test('rejects prefix drift and fabricated iteration count',()=>{
  const opts=original(),report=historical();
  report.seeds[0].pc=0x1234;
  assert.throws(()=>validateResumeCheckpoint({...opts,report}),/PREFIX_MISMATCH/);
  report.seeds[0].pc=0x6000;
  report.iterations=99;
  assert.throws(()=>validateResumeCheckpoint({...opts,report}),/SEED_ITERATION_MISMATCH/);
});
test('rejects corrupt last result, count and tape fingerprint',()=>{
  const opts=original(),report=historical();
  report.last_result.pc=0x7777;
  assert.throws(()=>validateResumeCheckpoint({...opts,report}),/LAST_SEED_MISMATCH/);
  report.last_result.pc=0x6800;report.blocks=77;
  assert.throws(()=>validateResumeCheckpoint({...opts,report}),/CHECKPOINT_BLOCK_COUNT_MISMATCH/);
  report.blocks=4;report.tape_sha256='b'.repeat(64);
  assert.throws(()=>validateResumeCheckpoint({...opts,report}),/HEADER_INVALID/);
});
test('legacy checkpoint with inaccessible RAM overlay data blocks safely',()=>{
  const opts=original(),report=historical();report.overlay_count=1;
  assert.throws(()=>validateResumeCheckpoint({...opts,report}),/OVERLAY_PROVENANCE_MISSING/);
});
test('new checkpoint can reconstruct verified local RAM bytes without ROM decode',()=>{
  const opts=original(),report=historical();
  opts.code.ramOverlays.push({start:0x100,bytes:Uint8Array.from([1,2,255])});
  assert.deepEqual(checkpointOverlays(opts.code,0),[{start:0x100,hex:'0102ff'}]);
  opts.code.ramOverlays.pop();
  report.overlay_count=1;report.extra_overlays=[{start:0x100,hex:'0102ff'}];
  const r=validateResumeCheckpoint({...opts,report});
  assert.equal(r.seeds.length,4);
  assert.deepEqual([...opts.code.ramOverlays[0].bytes],[1,2,255]);
});
test('bad extra overlay data is never decoded or used',()=>{
  const opts=original(),report=historical();
  report.overlay_count=1;report.extra_overlays=[{start:0x100,hex:'xyz'}];
  assert.throws(()=>validateResumeCheckpoint({...opts,report}),/OVERLAY_INVALID/);
});
