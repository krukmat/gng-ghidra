#!/usr/bin/env node
// Execute P-code-transpiled JS with explicitly injected I/O and captured traces.
// There is NO independent Motorola 6809 oracle in this harness.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname,basename} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';

const GATES = {
  '0x622c':{pc:0x6238,ram:3,total:5,
    sites:[{pc:0x622c,kind:'read',addr:0x3003,size:1},
           {pc:0x6232,kind:'read',addr:0x3004,size:1}]},
  '0x6755':{pc:0x6771,ram:5,total:10,
    sites:[{pc:0x6759,kind:'write',addr:0x3d00,size:1},
           {pc:0x675e,kind:'write',addr:0x3b09,size:1},
           {pc:0x6761,kind:'write',addr:0x3b08,size:1},
           {pc:0x676b,kind:'write',addr:0x3b0b,size:1},
           {pc:0x676e,kind:'write',addr:0x3b0a,size:1}]},
};
const SPECS=[
  {name:'low-stack',seed:0x13572468,stack:0x200},
  {name:'middle-stack',seed:0x31415926,stack:0x1000},
  {name:'upper-stack',seed:0x9abcdef0,stack:0x2ffc},
];
const sha256 = input=>createHash('sha256').update(input).digest('hex');

function state(entry,spec) {
  const memory=new Uint8Array(65536),registers=new Uint8Array(256);
  let x=spec.seed>>>0;
  const next=()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return x&255;};
  for(let i=0;i<memory.length;i++)memory[i]=next();
  for(let i=0;i<registers.length;i++)registers[i]=next();
  const pc=parseInt(entry,16);
  registers[9]=0;registers[16]=pc>>>8;registers[17]=pc&255;
  registers[24]=spec.stack>>>8;registers[25]=spec.stack&255;
  memory[spec.stack]=0x70;memory[spec.stack+1]=0;
  return {memory,registers};
}
function ioInputs(entry,spec){
  const gate=GATES[entry];
  return gate.sites.filter(x=>x.kind==='read').map((x,i)=>({
    addr:x.addr,size:x.size,value:(spec.seed>>>((i%4)*8))&255,
  }));
}
function outputDigest(out) {
  assert.ok(out&&out.memory instanceof Uint8Array&&
    out.registers instanceof Uint8Array&&Array.isArray(out.ioTrace),
    'Incomplete board execution state');
  const encoded=JSON.stringify({pc:out.pc,steps:out.steps,ioTrace:out.ioTrace});
  return sha256(Buffer.concat([Buffer.from(out.memory),Buffer.from(out.registers),
    Buffer.from(encoded)]));
}
function deltas(before,after,samples=10){
  assert.equal(before.length,after.length,'Output size changed');
  const changed=[];
  let count=0;
  for(let i=0;i<before.length;i++)if(before[i]!==after[i]){
    count++;
    if(changed.length<samples)changed.push({offset:i,old:before[i],value:after[i]});
  }
  return {count,samples:changed};
}
function execute(fn,entry,spec){
  const gate=GATES[entry], init=state(entry,spec);
  const m0=init.memory.slice(),r0=init.registers.slice();
  const inputs=ioInputs(entry,spec),inputs0=JSON.stringify(inputs);
  const got=fn(init.memory,init.registers,1000,inputs);
  assert.equal(got.pc,gate.pc,'Wrong source RTS boundary');
  assert.ok(Number.isSafeInteger(got.steps)&&got.steps>0&&got.steps<=1000,
    'Invalid bounded steps');
  assert.notStrictEqual(got.memory,init.memory,'Aliased memory output');
  assert.notStrictEqual(got.registers,init.registers,'Aliased registers output');
  assert.deepEqual(init.memory,m0,'Mutated input memory');
  assert.deepEqual(init.registers,r0,'Mutated input registers');
  assert.equal(JSON.stringify(inputs),inputs0,'Mutated injected board reads');
  assert.deepEqual(got.memory.slice(0x3000),m0.slice(0x3000),
    'RAM output contains unmodelled MMIO/ROM writes');
  assert.deepEqual(got.ioTrace.map(({pc,kind,addr,size})=>({pc,kind,addr,size})),
    gate.sites,'MMIO events changed order/address/width or instruction PC');
  assert.deepEqual(got.ioTrace.filter(x=>x.kind==='read').map(x=>x.value),
    inputs.map(x=>x.value),'Read values differ from injected I/O');
  for(const x of got.ioTrace)assert.ok(Number.isSafeInteger(x.value)&&
    x.value>=0&&x.value<2**(8*x.size),'MMIO value out of range');
  const again=state(entry,spec), replay=fn(again.memory,again.registers,1000,ioInputs(entry,spec));
  assert.equal(outputDigest(got),outputDigest(replay),'Replay drift');
  return {name:spec.name,seed:spec.seed,stack:spec.stack,
    steps:got.steps,source_rts:got.pc,
    state_sha256:outputDigest(got),ioTrace:got.ioTrace,
    memory_delta:deltas(m0,got.memory),register_delta:deltas(r0,got.registers),
    deterministic_replay:true,input_unchanged:true,equivalence_verified:false};
}
function invalidCases(fn,entry){
  return [{name:'bad-DP',edit:r=>r[9]=1},
    {name:'stack-low',edit:r=>{r[24]=0;r[25]=0xff;}},
    {name:'stack-high',edit:r=>{r[24]=0x2f;r[25]=0xfd;}}].map(x=>{
      const input=state(entry,SPECS[1]), m=input.memory.slice(),r=input.registers.slice();
      x.edit(input.registers);
      const edited=input.registers.slice();
      assert.throws(()=>fn(input.memory,input.registers,1000,ioInputs(entry,SPECS[1])),
        /Unmet experimental DP\/S contract/);
      assert.deepEqual(input.memory,m);
      assert.deepEqual(input.registers,edited);
      return {name:x.name,rejected:true,input_unchanged:true};
  });
}
function verifyManifest(m,reportFile) {
  assert.equal(m.schema,'gng.board-pcode-experiment.v1');
  assert.equal(m.contract,'illustrative-dp00-s0100-2ffc');
  assert.equal(m.status,'EXPERIMENTAL_BOARD_IO_NO_6809_REFERENCE');
  assert.equal(m.pure_codegen_eligibility_changed,false);
  assert.equal(m.hardware_equivalence_verified,false);
  assert.ok(Array.isArray(m.generated)&&Array.isArray(m.blocked)&&m.blocked.length===0);
  assert.equal(m.generated.length,2,'Expected both board routines');
  assert.deepEqual(new Set(m.generated.map(x=>x.entry)),new Set(Object.keys(GATES)));
  const folder=dirname(reportFile);
  for(const item of m.generated){
    const gate=GATES[item.entry];
    assert.deepEqual(item.board_sites,gate.sites,'Manifest changed board I/O permissions');
    assert.equal(item.conditional_ram_accesses,gate.ram);
    assert.equal(item.all_memory_accesses,gate.total);
    assert.equal(item.equivalence_verified,false);
    assert.equal(item.runtime_dp_s_guards,true);
    assert.equal(item.input_state_copied,true);
    assert.equal(item.io_trace_captured,true);
    assert.match(item.sha256,/^[a-f0-9]{64}$/);
    const filename=resolve(item.javascript);
    assert.equal(dirname(filename),folder,'Artifact outside report directory');
    assert.equal(basename(filename),'board_'+item.entry.slice(2)+'.mjs');
  }
}
export async function runHarness(manifest,reportFile){
  const out={schema:'gng.board-execution.v1',status:'FAILED',
    oracle:'NONE',equivalence_verified:false,hardware_behavior_verified:false,
    entry_invariants_proven:false,routines:[],failures:[]};
  try{
    verifyManifest(manifest,reportFile);
    for(const item of manifest.generated){
      const result={entry:item.entry,accepted:[],rejected:[],failure:null};
      out.routines.push(result);
      try{
        const file=resolve(item.javascript),actual=sha256(await readFile(file));
        assert.equal(actual,item.sha256,'Generated artifact digest mismatch');
        const {runRoutine}=await import(pathToFileURL(file).href+'?sha256='+actual);
        assert.equal(typeof runRoutine,'function','Missing generated runRoutine');
        for(const spec of SPECS)result.accepted.push(execute(runRoutine,item.entry,spec));
        result.rejected=invalidCases(runRoutine,item.entry);
      }catch(error){
        result.failure=error.message;
        out.failures.push({entry:item.entry,reason:error.message});
      }
    }
  }catch(error){out.failures.push({entry:null,reason:error.message});}
  out.status=out.failures.length?'FAILED':'PASS_BOARD_JS_ONLY';
  return out;
}
export async function main(report='out/generated-board/report.json'){
  const reportFile=resolve(report);
  let manifest;
  try{manifest=JSON.parse(await readFile(reportFile,'utf8'));}
  catch(e){console.error('GNG_BOARD_HARNESS=FAIL '+e.message);process.exitCode=1;return;}
  const result=await runHarness(manifest,reportFile);
  const path=resolve(dirname(reportFile),'verification-report.json');
  await mkdir(dirname(path),{recursive:true});
  await writeFile(path,JSON.stringify(result,null,2)+'\n');
  console.log('GNG_BOARD_HARNESS='+result.status+
    ' routines='+result.routines.length);
  for(const item of result.routines){
    console.log('  '+item.entry+' accepted='+item.accepted.length+
      ' rejected='+item.rejected.length+(item.failure?' FAIL='+item.failure:''));
  }
  for(const fail of result.failures)
    console.error('  BLOCKED '+(fail.entry??'manifest')+' '+fail.reason);
  console.log('GNG_MC6809_EQUIVALENCE=NOT_ESTABLISHED no independent CPU reference');
  console.log('GNG_BOARD_HARNESS_REPORT='+path);
  if(result.failures.length)process.exitCode=1;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  await main(process.argv[2]);
