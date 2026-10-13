import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {runHarness,executeControlled,executeInvalidContracts}
  from '../scripts/verify-guarded-functions.mjs';

function stub(entry){
  const site=entry==='0x622c'?0x6238:0x6771;
  return 'export function runRoutine(memory,registers){'+
  "if(registers[9]!==0||((registers[24]<<8)+registers[25])<0x100||"+
  "((registers[24]<<8)+registers[25])>0x2ffc)"+
  "throw new RangeError('Unmet experimental DP/S contract');"+
  'memory=memory.slice();registers=registers.slice();'+
  'memory[0x40]=registers[0];registers[1]=(registers[1]+1)&255;'+
  'return {memory,registers,steps:4,pc:'+site+'};}';
}
async function fixture(){
  const dir=await mkdtemp(join(tmpdir(),'gng-guard-test-'));
  const generated=[];
  for(const entry of ['0x622c','0x6755']){
    const file=join(dir,'guarded_'+entry.slice(2)+'.mjs'),code=stub(entry);
    await writeFile(file,code);
    generated.push({
      entry,javascript:file,conditional_access_count:entry==='0x622c'?3:5,
      entry_and_per_memory_access_guards:true,input_state_copied:true,
      equivalence_verified:false,sha256:createHash('sha256').update(code).digest('hex'),
    });
  }
  return {dir,manifest:{
    schema:'gng.guarded-pcode-experiment.v1',
    status:'EXPERIMENTAL_NOT_EQUIVALENCE_VERIFIED',
    contract:'illustrative-dp00-s0100-2ffc',
    unconditional_codegen_eligibility_changed:false,
    generated,blocked:[],
  }};
}

test('both synthetic guarded functions produce deterministic bounded JS traces',async()=>{
  const f=await fixture();
  try{
    const report=await runHarness({manifest:f.manifest,reportPath:join(f.dir,'report.json')});
    assert.equal(report.status,'PASS_JS_CONTROLLED_ONLY');
    assert.equal(report.routines.length,2);
    for(const item of report.routines){
      assert.equal(item.accepted.length,3);
      assert.equal(item.guard_rejections.length,3);
      assert.ok(item.accepted.every(x=>x.deterministic_replay&&x.input_unchanged));
      assert.ok(item.accepted.every(x=>x.memory_changes.forbidden_changes===0));
    }
    assert.equal(report.equivalence_verified,false);
    assert.equal(report.native_6809_reference_available,false);
  }finally{await rm(f.dir,{recursive:true,force:true});}
});

test('changed or stale generated module fails SHA-256 verification',async()=>{
  const f=await fixture();
  try{
    await writeFile(f.manifest.generated[0].javascript,'export const unrelated=1;');
    const report=await runHarness({manifest:f.manifest,reportPath:join(f.dir,'report.json')});
    assert.equal(report.status,'FAILED');
    assert.match(report.failures[0].reason,/integrity mismatch/);
  }finally{await rm(f.dir,{recursive:true,force:true});}
});

test('missing one candidate rejects entire manifest',async()=>{
  const f=await fixture();
  try{
    f.manifest.generated.pop();
    const report=await runHarness({manifest:f.manifest,reportPath:join(f.dir,'report.json')});
    assert.equal(report.status,'FAILED');
    assert.match(report.failures[0].reason,/exactly two/);
  }finally{await rm(f.dir,{recursive:true,force:true});}
});

test('false guard metadata fails closed',async()=>{
  const f=await fixture();
  try{
    f.manifest.generated[0].entry_and_per_memory_access_guards=false;
    const report=await runHarness({manifest:f.manifest,reportPath:join(f.dir,'report.json')});
    assert.equal(report.status,'FAILED');
    assert.match(report.failures[0].reason,/Missing guards/);
  }finally{await rm(f.dir,{recursive:true,force:true});}
});

test('unsafe MMIO output and aliased mutated buffers are rejected',()=>{
  const spec={name:'test',stack:0x200,seed:0xabc123};
  const illegal=(mem,reg)=>{
    const memory=mem.slice(),registers=reg.slice();
    memory[0x3e00]=1;
    return {memory,registers,steps:1,pc:0x6238};
  };
  assert.throws(()=>executeControlled(illegal,'0x622c',spec),/MMIO\/ROM/);
  const alias=(mem,reg)=>{
    mem[0x123]=0x55;
    return {memory:mem,registers:reg,steps:1,pc:0x6238};
  };
  assert.throws(()=>executeControlled(alias,'0x622c',spec),/alias caller memory/);
});

test('missing DP/S rejection is detected',()=>{
  const broken=(m,r)=>({memory:m.slice(),registers:r.slice(),steps:1,pc:0x6238});
  assert.throws(()=>executeInvalidContracts(broken,'0x622c'),/Missing expected exception/);
});
