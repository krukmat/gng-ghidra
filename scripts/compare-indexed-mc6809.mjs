#!/usr/bin/env node
// Third-routine differential gate: genuine ROM P-code JS vs independent 6809.
// Conditional indexed-RAM lab contract, NOT proof of reachability during play.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,basename,dirname} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {initialState,readRegisters,readNative} from './compare-mc6809.mjs';

const PIN='5bad24375961418d6591491929aea1f4dc8cb90f';
const sha256=v=>createHash('sha256').update(v).digest('hex');
const SEEDS=[0,0xffffffff,0x13572468,0x31415926,0x9abcdef0,0xff00ff00];
const STACKS=[0x0100,0x1000,0x2ffc];
const INDEXES=[0x0100,0x0200,0x2ffc];
export const VECTORS=SEEDS.flatMap((seed,i)=>STACKS.flatMap((stack,j)=>
    INDEXES.map((index,k)=>({name:'seed-'+i+'-stack-'+j+'-index-'+k,
      seed,stack,index})));

// Do not trust attacker-supplied report fields to change board/RAM policy.
export function checkManifest(m,rom,folder) {
  assert.equal(m.schema,'gng.indexed-pcode-experiment.v1');
  assert.equal(m.status,'EXPERIMENTAL_INDEXED_JS_NOT_NATIVE_EQUIVALENCE');
  assert.equal(m.native_equivalence_verified,false);
  assert.equal(m.actual_game_entry_conditions_proven,false);
  assert.equal(m.pure_unconditional_codegen_eligibility_changed,false);
  assert.equal(m.rom_sha256,sha256(rom),'ROM digest changed after generation');
  assert.ok(Array.isArray(m.blocked)&&m.blocked.length===0);
  assert.ok(Array.isArray(m.generated)&&m.generated.length===1);
  const item=m.generated[0];
  assert.equal(item.entry,'0x6239');
  assert.equal(item.native_equivalence_verified,false);
  assert.equal(item.runtime_per_memory_access_guards,true);
  assert.equal(item.input_state_copied,true);
  assert.equal(item.memory_sites,12);
  assert.equal(item.conditionally_bounded,10);
  assert.ok(Array.isArray(item.index_registers) &&
    item.index_registers.length>=1 && item.index_registers.length<=3);
  assert.ok(item.index_registers.every(x=>['X','Y','U'].includes(x)));
  assert.equal(new Set(item.index_registers).size,item.index_registers.length);
  assert.ok(Array.isArray(item.indexed_memory_sites) &&
    item.indexed_memory_sites.length===2);
  assert.ok(item.indexed_memory_sites.every(x=>
    Number.parseInt(x.pc,16)>=0x6239 &&
    ['LOAD','STORE'].includes(x.op) &&
    item.index_registers.includes(x.register) &&
    x.width>=1 && x.width<=4));
  const sourceRts=Number.parseInt(item.source_rts,16);
  assert.ok(Number.isSafeInteger(sourceRts)&&
    sourceRts>0x6239 && sourceRts<0x10000 &&
    rom[sourceRts]===0x39,'Unique source RTS must match real 6809 ROM opcode');
  assert.match(item.sha256,/^[a-f0-9]{64}$/);
  assert.equal(dirname(resolve(item.javascript)),folder);
  assert.equal(basename(item.javascript),'indexed_6239.mjs');
  return {item,sourceRts};
}

function fullRamChanges(before,after) {
  const changes=[];
  for(let addr=0;addr<0x3000;addr++){
    if(before[addr]!==after[addr])
      changes.push({addr,before:before[addr],after:after[addr]});
  }
  return changes;
}
export function compareIndexed(spec,state,js,native,sourceRts){
  const diffs=[];
  const field=(key,got,want)=>{
    if(got!==want)diffs.push({field:key,generated:got,reference:want});
  };
  field('oracle.schema',native.schema,'gng.mc6809-oracle.v1');
  field('oracle.provider',native.provider,'elmerucr/mc6809');
  field('oracle.commit',native.provider_commit,PIN);
  field('oracle.entry',native.entry,'0x6239');
  field('oracle.seed',native.seed,spec.seed);
  field('oracle.stack',native.stack,spec.stack);
  field('oracle.index_initial',native.index_initial,spec.index);
  field('oracle.source_rts',native.source_rts,sourceRts);
  field('oracle.return_address',native.return_address,0x7000);
  field('oracle.registers.PC',native.registers?.PC,0x7000);
  field('generated.source_rts',js.pc,sourceRts);
  field('instruction_count',js.steps,native.steps);
  const registers=readRegisters(js.registers);
  for(const key of ['A','B','CC','DP','X','Y','U','S'])
    field('register.'+key,registers[key],native.registers?.[key]);
  if(JSON.stringify(js.ioTrace??[])!==JSON.stringify(native.ioTrace??[]))
    diffs.push({field:'MMIO trace',generated:js.ioTrace,reference:native.ioTrace});
  const jsChanges=fullRamChanges(state.memory,js.memory);
  if(JSON.stringify(jsChanges)!==JSON.stringify(native.ramChanges)){
    diffs.push({field:'RAM or stack delta',
      generated:jsChanges.slice(0,12),
      reference:native.ramChanges?.slice(0,12),
      generated_count:jsChanges.length,reference_count:native.ramChanges?.length});
  }
  if(!(js.memory instanceof Uint8Array)||js.memory.length!==65536 ||
     !js.memory.slice(0x3000).every((v,i)=>v===state.memory[0x3000+i]))
    diffs.push({field:'Unexpected MMIO/ROM output memory mutation'});
  return diffs;
}

export async function run(manifest,romPath,nativeBin,reportFile){
  const result={schema:'gng.mc6809-indexed-differential.v1',
    status:'BLOCKED',entry:'0x6239',oracle_provider:'elmerucr/mc6809',
    native_6809_vectors_verified:false,actual_game_entry_conditions_proven:false,
    vectors:[],failures:[]};
  try{
    const rom=await readFile(romPath);
    assert.equal(rom.length,65536,'ROM image must be exactly 64 KiB');
    const {item,sourceRts}=checkManifest(manifest,rom,dirname(reportFile));
    const file=resolve(item.javascript);
    assert.equal(sha256(await readFile(file)),item.sha256,'Generated JS digest mismatch');
    const {runRoutine}=await import(pathToFileURL(file).href+'?sha256='+item.sha256);
    assert.equal(typeof runRoutine,'function');
    for(const spec of VECTORS){
      try {
        const state=initialState('0x6239',spec);
        for(const offset of [18,20,22]){
          state.registers[offset]=spec.index>>>8;
          state.registers[offset+1]=spec.index&255;
        }
        const originalM=state.memory.slice(),originalR=state.registers.slice();
        const js=runRoutine(state.memory,state.registers,1000);
        assert.deepEqual(state.memory,originalM,'Generated routine mutated caller memory');
        assert.deepEqual(state.registers,originalR,'Generated routine mutated caller registers');
        assert.ok(js.memory instanceof Uint8Array && js.registers instanceof Uint8Array);
        const native=spawnSync(nativeBin,[
          romPath,'0x6239','0x'+spec.seed.toString(16),
          '0x'+spec.stack.toString(16),
          '0x'+sourceRts.toString(16),
          '0x'+spec.index.toString(16)],
          {encoding:'utf8',timeout:15000,maxBuffer:4*1024*1024});
        if(native.error||native.status!==0)
          throw Error('Independent native MC6809 blocked: '+
            (native.error?.message??native.stderr??'failed').slice(0,1200));
        const oracle=readNative(native.stdout);
        const differences=compareIndexed(spec,state,js,oracle,sourceRts);
        result.vectors.push({
          name:spec.name,seed:spec.seed,stack:spec.stack,index:spec.index,
          js_steps:js.steps,native_steps:oracle.steps,
          matched:!differences.length,differences});
        if(differences.length) result.failures.push({name:spec.name,differences});
      }catch(error){
        result.failures.push({name:spec.name,error:error.message});
        break; // fail closed on first uncontrolled runtime error
      }
    }
    result.status=result.failures.length?'MISMATCH_OR_BLOCKED':
      'PASS_DIFFERENTIAL_TEST_VECTORS';
    result.native_6809_vectors_verified=result.status==='PASS_DIFFERENTIAL_TEST_VECTORS';
  }catch(error){result.failures.push({error:error.message});}
  return result;
}

export async function main(args=process.argv.slice(2)){
  const romPath=resolve(args[0]??'out/gngb-flat.bin');
  const bin=resolve(args[1]??'out/native-oracle/mc6809-reference');
  const manifestPath=resolve('out/generated-indexed/report.json');
  let report;
  try{
    const manifest=JSON.parse(await readFile(manifestPath,'utf8'));
    report=await run(manifest,romPath,bin,manifestPath);
  }catch(error){report={status:'BLOCKED',failures:[{error:error.message}]};}
  const destination=resolve('out/generated-indexed/differential-report.json');
  await mkdir(dirname(destination),{recursive:true});
  await writeFile(destination,JSON.stringify(report,null,2)+'\n');
  const matched=(report.vectors??[]).filter(x=>x.matched).length;
  console.log('GNG_INDEXED_DIFFERENTIAL='+report.status+
    ' vectors='+((report.vectors??[]).length)+
    ' matched='+matched+' failures='+report.failures.length);
  for(const failure of report.failures.slice(0,5))
    console.log('  BLOCKED '+JSON.stringify(failure).slice(0,800));
  console.log('GNG_INDEXED_GAME_REACHABILITY=UNPROVEN');
  console.log('GNG_INDEXED_DIFFERENTIAL_REPORT='+destination);
  if(report.status!=='PASS_DIFFERENTIAL_TEST_VECTORS')
    process.exitCode=1;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  await main();
