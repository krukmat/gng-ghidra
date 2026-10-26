/**
 * V3.B2B checkpoint validator. NO ROM imports, NO filesystem or side effects.
 * Reconstructs the historical 48-iteration tail without replaying its 48
 * discovery runs. A newly appended seed has not yet been compiled.
 */
export const RESUME_SCHEMA='gng.v3.b2b-discovery.v1';
const fail=why=>{throw Error('V3_B2B_RESUME_'+why);};
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function validateResumeCheckpoint({
  report,foundation,b2aMissing,code,tapeSha,seedOK,seedKey,compileProgram,libUrl
}){
  if(!report||report.schema!==RESUME_SCHEMA||
     report.status!=='BLOCKED_ITERATION_LIMIT'||
     report.profile!=='controls'||report.tape_sha256!==tapeSha||
     !Number.isSafeInteger(report.iterations)||report.iterations<1||
     !Number.isSafeInteger(report.blocks)||report.blocks<1||
     !Number.isSafeInteger(report.frames)||report.frames<1||
     !Number.isSafeInteger(report.seed_count)||!Array.isArray(report.seeds)||
     report.seeds.length!==report.seed_count||
     !Number.isSafeInteger(report.overlay_count)||
     report.overlay_count<code.ramOverlays.length)
    fail('HEADER_INVALID');
  const originalOverlayCount=code.ramOverlays.length;
  const extra=report.extra_overlays??[];
  if(!Array.isArray(extra)||extra.length!==report.overlay_count-originalOverlayCount)
    fail('OVERLAY_PROVENANCE_MISSING');
  for(const ov of extra){
    if(!ov||!Number.isSafeInteger(ov.start)||ov.start<0||
       ov.start>=0x3000||typeof ov.hex!=='string'||
       ov.hex.length<2||ov.hex.length%2!==0||
       ov.hex.length>0x6000||!/^[0-9a-f]+$/.test(ov.hex)||
       ov.start+ov.hex.length/2>0x3000)
      fail('OVERLAY_INVALID');
    const bytes=Uint8Array.from(ov.hex.match(/../g).map(h=>parseInt(h,16)));
    code.ramOverlays.push({start:ov.start,bytes});
  }
  const prefix=[...foundation,{bank:b2aMissing.bank,pc:b2aMissing.pc,
    overlay:b2aMissing.overlay??null}];
  if(report.seeds.length<=prefix.length||
     !equal(report.seeds.slice(0,prefix.length),prefix))
    fail('PREFIX_MISMATCH');
  if(!Number.isSafeInteger(report.iterations)||
     report.seeds.length-prefix.length!==report.iterations)
    fail('SEED_ITERATION_MISMATCH');
  const unique=new Set(foundation.map(seedKey));
  for(const seed of report.seeds.slice(foundation.length)){
    if(!seedOK(seed,code)||unique.has(seedKey(seed)))
      fail('DISCOVERED_SEED_INVALID');
    unique.add(seedKey(seed));
  }
  const last=report.last_result;
  const finalSeed=report.seeds.at(-1);
  if(last?.status==='UNCOMPILED'){
    const expected={bank:last.bank,pc:last.pc,overlay:last.overlay??null};
    if(!equal(finalSeed,expected))fail('LAST_SEED_MISMATCH');
  }else if(last?.status==='RAM_CODE_UNMAPPED'){
    if(finalSeed.pc!==last.pc||finalSeed.bank!==null||
       !Number.isInteger(finalSeed.overlay))
      fail('LAST_SEED_MISMATCH');
  }else fail('LAST_RESULT_NOT_RESUMABLE');
  // The last target was enqueued after the previous compilation, so
  // attest that program's exact *block count* before accepting the tail.
  const compiled=compileProgram(code,report.seeds.slice(0,-1),{libUrl});
  if(compiled.blockCount!==report.blocks)
    fail('CHECKPOINT_BLOCK_COUNT_MISMATCH');
  return {seeds:report.seeds.map(s=>({...s})),
    iterations:report.iterations,frames:report.frames,blocks:report.blocks,
    oldOverlayCount:originalOverlayCount};
}
export function checkpointOverlays(code,originalOverlayCount){
  if(!Number.isSafeInteger(originalOverlayCount)||originalOverlayCount<0||
     originalOverlayCount>code.ramOverlays.length)
    fail('OVERLAY_BOUNDARY_INVALID');
  return code.ramOverlays.slice(originalOverlayCount).map(o=>({
    start:o.start,hex:Buffer.from(o.bytes).toString('hex')
  }));
}
