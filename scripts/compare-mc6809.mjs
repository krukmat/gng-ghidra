#!/usr/bin/env node
// Strict differential oracle: generated JS vs pinned external MC6809 C++ CPU.
// Passing controlled vectors is NOT proof of game runtime reachability.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const PIN='5bad24375961418d6591491929aea1f4dc8cb90f';
const GATES={
  '0x622c':{site:0x6238,ram:3,total:5,
    ports:[{kind:'read',pc:0x622c,addr:0x3003,size:1},
           {kind:'read',pc:0x6232,addr:0x3004,size:1}]},
  '0x6755':{site:0x6771,ram:5,total:10,
    ports:[{kind:'write',pc:0x6759,addr:0x3d00,size:1},
           {kind:'write',pc:0x675e,addr:0x3b09,size:1},
           {kind:'write',pc:0x6761,addr:0x3b08,size:1},
           {kind:'write',pc:0x676b,addr:0x3b0b,size:1},
           {kind:'write',pc:0x676e,addr:0x3b0a,size:1}]},
};
// Native/JS vectors exercise input-port extremes, CC/register randomness,
// and lower/upper stack boundaries. Still synthetic entry states, not game
// traces. Use distinct names and deterministic seeds for reproducibility.
const SEEDS=[
  0x00000000,0xffffffff,0x0000ff00,0x000000ff,
  0x0000807f,0x00007f80,0x13572468,0x31415926,
  0x9abcdef0,0xdeadbeef,0xff00ff00,0x00001234,
];
const STACKS=[0x0100,0x01ff,0x0200,0x1000,0x2ffc];
export const CASES=SEEDS.flatMap((seed,i)=>STACKS.map((stack,j)=>({
  name:'seed-'+i+'-stack-'+j,seed,stack,
})));
const sha256=v=>createHash('sha256').update(v).digest('hex');
const word=(r,i)=>(r[i]<<8)|r[i+1];

export function initialState(entry,spec){
  const memory=new Uint8Array(65536),registers=new Uint8Array(256);
  let x=spec.seed>>>0;
  const rnd=()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return x&255;};
  for(let i=0;i<memory.length;i++)memory[i]=rnd();
  for(let i=0;i<registers.length;i++)registers[i]=rnd();
  const pc=parseInt(entry,16);
  registers[9]=0;registers[16]=pc>>>8;registers[17]=pc&255;
  registers[24]=spec.stack>>>8;registers[25]=spec.stack&255;
  memory[spec.stack]=0x70;memory[spec.stack+1]=0;
  return {memory,registers};
}
function boardReads(entry,spec){
  return GATES[entry].ports.filter(x=>x.kind==='read').map((x,i)=>
    ({addr:x.addr,size:x.size,value:(spec.seed>>>(8*i))&255}));
}
export function readRegisters(r){
  assert.ok(r instanceof Uint8Array&&r.length===256);
  return {A:r[0],B:r[1],CC:r[8],DP:r[9],X:word(r,18),
    Y:word(r,20),U:word(r,22),S:word(r,24),PC:word(r,16)};
}
export function readNative(stdout){
  const a='GNG_NATIVE_BEGIN\n',b='\nGNG_NATIVE_END';
  const i=stdout.indexOf(a),j=stdout.indexOf(b);
  if(i<0||j<=i||stdout.indexOf(a,i+a.length)>=0||
     stdout.indexOf(b,j+b.length)>=0)
    throw Error('Missing/ambiguous independent CPU output markers');
  return JSON.parse(stdout.slice(i+a.length,j));
}
function memoryDiff(a,b){
  const changes=[];
  for(let addr=0;addr<0x3000;addr++)if(a[addr]!==b[addr])
    changes.push({addr,before:a[addr],after:b[addr]});
  return changes;
}
export function compareState(entry,spec,initial,js,native){
  const gate=GATES[entry],differences=[];
  function eq(field,actual,expected){
    if(actual!==expected)differences.push({field,actual,expected});
  }
  eq('oracle schema',native.schema,'gng.mc6809-oracle.v1');
  eq('provider',native.provider,'elmerucr/mc6809');
  eq('provider pin',native.provider_commit,PIN);
  eq('entry',native.entry,entry);
  eq('seed',native.seed,spec.seed);
  eq('stack',native.stack,spec.stack);
  eq('native return address',native.return_address,0x7000);
  eq('native source RTS',native.source_rts,gate.site);
  eq('native PC',native.registers?.PC,0x7000);
  eq('generated source RTS',js.pc,gate.site);
  eq('instructions executed',js.steps,native.steps);
  const regs=readRegisters(js.registers);
  for(const k of ['A','B','CC','DP','X','Y','U','S'])
    eq('register.'+k,regs[k],native.registers?.[k]);
  // The generated pc field reports source RTS while real CPU PC is the
  // post-return address. These distinct representations have explicit checks.
  if(JSON.stringify(js.ioTrace)!==JSON.stringify(native.ioTrace))
    differences.push({field:'ordered MMIO effects',actual:js.ioTrace,
      expected:native.ioTrace});
  const changes=memoryDiff(initial.memory,js.memory);
  if(JSON.stringify(changes)!==JSON.stringify(native.ramChanges))
    differences.push({field:'RAM and stack mutations',
      actual:changes.slice(0,12),expected:native.ramChanges?.slice(0,12),
      actual_count:changes.length,expected_count:native.ramChanges?.length});
  if(!(js.memory instanceof Uint8Array)||js.memory.length!==65536||
     !js.memory.slice(0x3000).every((v,i)=>v===initial.memory[0x3000+i]))
    differences.push({field:'generated MMIO/ROM memory mutation'});
  return differences;
}
export async function runDifferential(manifest,romPath,binaryPath){
  const result={schema:'gng.mc6809-differential.v1',
    status:'BLOCKED',native_provider:'elmerucr/mc6809',provider_commit:PIN,
    differential_vectors_verified:false,real_game_entry_state_proven:false,
    routines:[],failures:[]};
  try{
    assert.equal(manifest.schema,'gng.board-pcode-experiment.v1');
    assert.equal(manifest.status,'EXPERIMENTAL_BOARD_IO_NO_6809_REFERENCE');
    assert.equal(manifest.pure_codegen_eligibility_changed,false);
    assert.equal(manifest.hardware_equivalence_verified,false);
    assert.ok(Array.isArray(manifest.blocked)&&manifest.blocked.length===0);
    assert.ok(Array.isArray(manifest.generated)&&manifest.generated.length===2);
    const rom=await readFile(romPath);
    assert.equal(rom.length,65536);
    assert.equal(sha256(rom),manifest.rom_sha256,
      'ROM digest differs from original Ghidra/codegen');
    for(const entry of Object.keys(GATES)){
      const gate=GATES[entry],record={entry,cases:[],failures:[]};
      result.routines.push(record);
      try{
        const item=manifest.generated.find(x=>x.entry===entry);
        assert.ok(item,'Missing board JS routine '+entry);
        assert.equal(item.equivalence_verified,false);
        assert.equal(item.all_memory_accesses,gate.total);
        assert.equal(item.conditional_ram_accesses,gate.ram);
        assert.deepEqual(item.board_sites,gate.ports);
        assert.match(item.sha256,/^[a-f0-9]{64}$/);
        const filename=resolve(item.javascript);
        assert.equal(sha256(await readFile(filename)),item.sha256,
          'Generated JS digest differs from manifest');
        const {runRoutine}=await import(pathToFileURL(filename).href+
          '?sha256='+item.sha256);
        assert.equal(typeof runRoutine,'function');
        for(const spec of CASES){
          const input=initialState(entry,spec),beforeM=input.memory.slice(),
            beforeR=input.registers.slice();
          const js=runRoutine(input.memory,input.registers,1000,boardReads(entry,spec));
          assert.deepEqual(input.memory,beforeM,'Caller memory mutated');
          assert.deepEqual(input.registers,beforeR,'Caller registers mutated');
          const native=spawnSync(binaryPath,
            [romPath,entry,'0x'+spec.seed.toString(16),
              '0x'+spec.stack.toString(16)],{
              encoding:'utf8',timeout:15000,maxBuffer:2*1024*1024});
          if(native.error||native.status!==0)
            throw Error('Native MC6809 failed: '+
              String(native.error?.message??native.stderr).slice(0,1000));
          const oracle=readNative(native.stdout);
          const differences=compareState(entry,spec,input,js,oracle);
          record.cases.push({name:spec.name,seed:spec.seed,stack:spec.stack,
            generated_steps:js.steps,native_steps:oracle.steps,
            port_events:js.ioTrace?.length,differences,
            verified:differences.length===0});
          if(differences.length)record.failures.push({case:spec.name,differences});
        }
      }catch(err){record.failures.push({error:err.message});}
      if(record.failures.length)result.failures.push({
        entry,failures:record.failures});
    }
    result.status=result.failures.length?'MISMATCH_OR_BLOCKED':
      'PASS_DIFFERENTIAL_TEST_VECTORS';
    result.differential_vectors_verified=!result.failures.length;
  }catch(err){result.failures.push({error:err.message});}
  return result;
}
export async function main(args=process.argv.slice(2)){
  const romPath=resolve(args[0]??'out/gngb-flat.bin');
  const binaryPath=resolve(args[1]??'out/native-oracle/mc6809-reference');
  let result;
  try{
    const manifest=JSON.parse(await readFile('out/generated-board/report.json','utf8'));
    result=await runDifferential(manifest,romPath,binaryPath);
  }catch(err){result={status:'BLOCKED',failures:[{error:err.message}]};}
  const path=resolve('out/generated-board/differential-report.json');
  await writeFile(path,JSON.stringify(result,null,2)+'\n');
  console.log('GNG_MC6809_DIFFERENTIAL='+result.status);
  for(const item of result.routines??[]){
    console.log('  '+item.entry+' vectors='+item.cases.length+
      ' matched='+item.cases.filter(x=>x.verified).length+
      ' failed='+item.failures.length);
    for(const failure of item.failures){
      for(const delta of failure.differences??[])
        console.error('    '+failure.case+' '+delta.field+
          ' generated='+JSON.stringify(delta.actual)+
          ' cpu='+JSON.stringify(delta.expected));
      if(failure.error)console.error('    '+failure.error);
    }
  }
  console.log('GNG_MC6809_DIFFERENTIAL_REPORT='+path);
  console.log('GNG_REAL_GAME_ENTRY_STATES=UNPROVEN');
  if(result.status!=='PASS_DIFFERENTIAL_TEST_VECTORS')
    process.exitCode=1;
}
if(process.argv[1]&&resolve(process.argv[1]).endsWith('scripts/compare-mc6809.mjs'))
  await main();
