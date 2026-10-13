#!/usr/bin/env node
// Deterministic JS-only experiment: NOT equivalence with the 6809 CPU.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname,basename} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';

const EXPECTED = new Map([['0x622c',0x6238],['0x6755',0x6771]]);
const CONTRACT = 'illustrative-dp00-s0100-2ffc';
const CASES = [
  {name:'low-stack',stack:0x0200,seed:0x13572468},
  {name:'middle-stack',stack:0x1000,seed:0x31415926},
  {name:'upper-stack',stack:0x2ffc,seed:0x9abcdef0},
];
const MAX_STEPS=1000;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const hx = (v,n=4) => '0x'+v.toString(16).padStart(n,'0');

export function controlledState(entry,spec) {
  const memory=new Uint8Array(65536), registers=new Uint8Array(256);
  let x=spec.seed>>>0;
  const rnd=()=>{ x^=x<<13; x^=x>>>17; x^=x<<5; return x&255; };
  for(let i=0;i<memory.length;i++)memory[i]=rnd();
  for(let i=0;i<registers.length;i++)registers[i]=rnd();
  const start=Number.parseInt(entry,16);
  registers[9]=0; // DP set explicitly, not inferred from the ROM.
  registers[16]=(start>>>8)&255;registers[17]=start&255;
  registers[24]=(spec.stack>>>8)&255;registers[25]=spec.stack&255;
  memory[spec.stack]=0x70;memory[spec.stack+1]=0;
  return {memory,registers};
}

function delta(before,after,max=12) {
  assert.equal(before.length,after.length,'Output buffer length changed');
  let count=0,forbidden=0;const samples=[];
  for(let i=0;i<before.length;i++)if(before[i]!==after[i]){
    count++;
    if(before.length===65536&&i>=0x3000)forbidden++;
    if(samples.length<max)samples.push({offset:hx(i),before:before[i],after:after[i]});
  }
  return {count,forbidden_changes:forbidden,samples};
}
function digest(output){
  return hash(Buffer.concat([Buffer.from(output.memory),Buffer.from(output.registers),
    Buffer.from(String(output.steps)+'|'+String(output.pc))]));
}
function inspect(output,input,returnSite){
  assert.ok(output&&output.memory instanceof Uint8Array&&output.memory.length===65536,
    'Invalid output memory');
  assert.ok(output.registers instanceof Uint8Array&&output.registers.length===256,
    'Invalid output register file');
  assert.notStrictEqual(output.memory,input.memory,'Output may not alias caller memory');
  assert.notStrictEqual(output.registers,input.registers,'Output may not alias caller registers');
  assert.ok(Number.isSafeInteger(output.steps)&&output.steps>0&&output.steps<=MAX_STEPS,
    'Invalid bounded step count');
  // Output pc identifies source RTS instruction, NOT architectural return PC.
  assert.equal(output.pc,returnSite,'Did not reach known RTS instruction');
  assert.deepEqual(output.memory.slice(0x3000),input.memory.slice(0x3000),
    'Experimental JS modified MMIO/ROM');
}

export function executeControlled(runRoutine,entry,spec){
  const site=EXPECTED.get(entry);
  if(site===undefined)throw new Error('Unsupported entry '+entry);
  const initial=controlledState(entry,spec);
  const originalMemory=initial.memory.slice(),originalRegisters=initial.registers.slice();
  const result=runRoutine(initial.memory,initial.registers,MAX_STEPS);
  inspect(result,initial,site);
  assert.deepEqual(initial.memory,originalMemory,'Caller memory changed');
  assert.deepEqual(initial.registers,originalRegisters,'Caller registers changed');
  const again=controlledState(entry,spec);
  const repeated=runRoutine(again.memory,again.registers,MAX_STEPS);
  inspect(repeated,again,site);
  assert.equal(digest(result),digest(repeated),'Deterministic replay mismatch');
  const memory=delta(originalMemory,result.memory);
  assert.equal(memory.forbidden_changes,0,'MMIO/ROM changed');
  return {
    case:spec.name,initial_stack:hx(spec.stack),seed:hx(spec.seed,8),
    synthetic_return_address:'0x7000',return_instruction:hx(result.pc),
    steps:result.steps,state_sha256:digest(result),
    memory_changes:memory,register_changes:delta(originalRegisters,result.registers),
    input_unchanged:true,deterministic_replay:true,equivalence_verified:false,
  };
}

export function executeInvalidContracts(runRoutine,entry){
  const errors=[
    {name:'invalid-DP',edit:r=>{r[9]=1;}},
    {name:'stack-too-low',edit:r=>{r[24]=0;r[25]=0xff;}},
    {name:'stack-too-high',edit:r=>{r[24]=0x2f;r[25]=0xfd;}},
  ];
  return errors.map(spec=>{
    const init=controlledState(entry,CASES[1]);
    spec.edit(init.registers);
    const m=init.memory.slice(),r=init.registers.slice();
    assert.throws(()=>runRoutine(init.memory,init.registers,MAX_STEPS),
      /Unmet experimental DP\/S contract/,'Missing expected contract rejection');
    assert.deepEqual(init.memory,m,'Rejected call modified memory');
    assert.deepEqual(init.registers,r,'Rejected call modified registers');
    return {case:spec.name,guard_rejected:true,input_unchanged:true};
  });
}

export async function verifyManifest(manifest,reportPath){
  if(manifest?.schema!=='gng.guarded-pcode-experiment.v1'||
     manifest.contract!==CONTRACT||
     manifest.status!=='EXPERIMENTAL_NOT_EQUIVALENCE_VERIFIED'||
     manifest.unconditional_codegen_eligibility_changed!==false||
     !Array.isArray(manifest.generated)||!Array.isArray(manifest.blocked))
    throw new Error('Invalid experiment manifest');
  if(manifest.generated.length!==2||manifest.blocked.length||
     new Set(manifest.generated.map(x=>x.entry)).size!==2||
     manifest.generated.some(x=>!EXPECTED.has(x.entry)))
    throw new Error('Require exactly two unblocked ROM candidates');
  const base=resolve(dirname(reportPath)),modules=new Map();
  for(const x of manifest.generated){
    if(x.equivalence_verified!==false||x.entry_and_per_memory_access_guards!==true||
       x.input_state_copied!==true||
       x.conditional_access_count!==(x.entry==='0x622c'?3:5)||
       typeof x.sha256!=='string'||!/^[a-f0-9]{64}$/.test(x.sha256))
      throw new Error('Missing guards or artifact SHA: '+x.entry);
    if(basename(x.javascript)!=='guarded_'+x.entry.slice(2)+'.mjs')
      throw new Error('Unexpected artifact filename');
    const file=resolve(x.javascript);
    if(dirname(file)!==base)throw new Error('Generated module outside report directory');
    if(hash(await readFile(file))!==x.sha256)
      throw new Error('Generated JS integrity mismatch: '+x.entry);
    const exports=await import(pathToFileURL(file).href+'?sha256='+x.sha256);
    if(typeof exports.runRoutine!=='function')throw new Error('Missing runRoutine: '+x.entry);
    modules.set(x.entry,exports.runRoutine);
  }
  return modules;
}

export async function runHarness({manifest,reportPath}){
  const output={
    schema:'gng.guarded-execution.v1',status:'JS_CONTROLLED_EXPERIMENT',
    contract:CONTRACT,native_6809_reference_available:false,
    equivalence_verified:false,hardware_context_verified:false,
    runtime_reachability_verified:false,routines:[],failures:[],
  };
  try{
    const modules=await verifyManifest(manifest,reportPath);
    for(const [entry,fn] of modules){
      const item={entry,accepted:[],guard_rejections:[],failure:null};
      output.routines.push(item);
      try{
        for(const spec of CASES)item.accepted.push(executeControlled(fn,entry,spec));
        item.guard_rejections=executeInvalidContracts(fn,entry);
      }catch(e){
        item.failure=e.message;
        output.failures.push({entry,reason:e.message});
      }
    }
  }catch(e){output.failures.push({entry:null,reason:e.message});}
  output.status=output.failures.length?'FAILED':'PASS_JS_CONTROLLED_ONLY';
  return output;
}

export async function main(report='out/generated-guarded/report.json'){
  const file=resolve(report);
  let manifest;
  try{manifest=JSON.parse(await readFile(file,'utf8'));}
  catch(e){console.error('GNG_GUARDED_HARNESS=FAIL: '+e.message);process.exitCode=1;return;}
  const result=await runHarness({manifest,reportPath:file});
  const dest=resolve(dirname(file),'verification-report.json');
  await mkdir(dirname(dest),{recursive:true});
  await writeFile(dest,JSON.stringify(result,null,2)+'\n');
  console.log('GNG_GUARDED_HARNESS='+result.status+' routines='+result.routines.length);
  for(const r of result.routines){
    console.log('  '+r.entry+' accepted='+r.accepted.length+' guard_rejected='+r.guard_rejections.length+
      (r.failure?' FAIL='+r.failure:''));
    for(const x of r.accepted)console.log('    '+x.case+' steps='+x.steps+
      ' memory_delta='+x.memory_changes.count+' registers_delta='+x.register_changes.count+
      ' state_sha256='+x.state_sha256.slice(0,12));
  }
  for(const e of result.failures)console.error('  HARNESS_BLOCKED '+(e.entry??'manifest')+' '+e.reason);
  console.log('GNG_6809_EQUIVALENCE=NOT_ESTABLISHED synthetic inputs; no native CPU oracle');
  console.log('GNG_GUARDED_HARNESS_REPORT='+dest);
  if(result.failures.length)process.exitCode=1;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  await main(process.argv[2]);
