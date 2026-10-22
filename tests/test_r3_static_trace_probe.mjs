import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {compileAt,emitStaticModule,diffRegisters,runGate}
  from '../scripts/r3_static_trace_probe.mjs';

const basic=(PC,A=0,CC=128)=>({PC,A,B:0,X:0,Y:0,U:0,S:0x2000,DP:0,CC});
const row=(seq,r)=>({schema:'gng.r2.pre-instruction.v1',kind:'pre_instruction',
  seq,pc:r.PC,before:r,origin:'mame-native-tracelog'});
const image=()=>{
  const mem=new Uint8Array(65536);
  mem[0xfffe]=0x60;mem[0xffff]=0;
  mem.set([0x86,0x7f,0x1a,0x10,0x20,0x02],0x6000);
  mem[0x6008]=0x12;
  mem[0x6009]=0x39; // RTS intentionally NOT compiled
  return mem;
};
const rows=()=>[
  row(0,basic(0x6000)),
  row(1,basic(0x6002,0x7f)),
  row(2,basic(0x6004,0x7f,0x90)),
  row(3,basic(0x6008,0x7f,0x90)),
  row(4,basic(0x6009,0x7f,0x90)),
];
async function fixture(callback,{rom=image(),states=rows()}={}){
  await mkdir('out/r3',{recursive:true});
  const dir=await mkdtemp(resolve('out/r3/test-static-'));
  try{
    const romPath=resolve(dir,'synthetic-image.bin');
    const tracePath=resolve(dir,'synthetic-pre-instruction.jsonl');
    await writeFile(romPath,rom);
    await writeFile(tracePath,states.map(x=>JSON.stringify(x)).join('\n')+'\n');
    return await callback({romPath,tracePath,outDir:dir});
  }finally{await rm(dir,{force:true,recursive:true});}
}
test('static direct generation from ROM-decoded opcodes, no runtime decoder',async()=>{
  const rom=image();
  assert.equal(compileAt(rom,0x6000).name,'LDA_IMM');
  assert.equal(compileAt(rom,0x6004).name,'BRA');
  assert.equal(compileAt(rom,0x6009),null);
  assert.equal(compileAt(rom,0x5500),null);
  const js=emitStaticModule([compileAt(rom,0x6000),compileAt(rom,0x6004)]);
  assert.match(js,/case 0x6000:/);
  assert.match(js,/r.A=0x7f/);
  assert.match(js,/case 0x6004:/);
  assert.match(js,/next=0x6008/);
  assert.doesNotMatch(js,/switch\(rom|readByte|rom\[r.PC\]|decodeOpcode/);
});
test('native prestate shaped synthetic sequence compares four compiled one-step effects',async()=>{
  await fixture(async args=>{
    const report=await runGate(args);
    assert.equal(report.status,'MATCHED_SUPPORTED_PRESTATE_PAIRS');
    assert.equal(report.compared_pairs,4);
    assert.equal(report.matching_pairs,4);
    assert.equal(report.distinct_compared_pc,4);
    assert.equal(report.reference_provenance_independently_authenticated,false);
    assert.equal(report.full_game_or_bus_irq_equivalence_verified,false);
    assert.equal(report.runtime_opcode_interpreter,false);
    const generated=await readFile(resolve(args.outDir,'static-rom-slice.mjs'),'utf8');
    assert.match(generated,/export function compiledStep/);
    assert.doesNotMatch(generated,/interpreter/);
    const imported=await import(pathToFileURL(resolve(args.outDir,'static-rom-slice.mjs')).href);
    assert.deepEqual(imported.compiledStep(basic(0x6000)),basic(0x6002,0x7f));
    assert.deepEqual(imported.compiledStep(basic(0x6004,0x7f,0x90)),
      basic(0x6008,0x7f,0x90));
    assert.throws(()=>imported.compiledStep(basic(0x6009)),/UNCOMPILED_PC/);
  });
});
test('first divergence is reported, never silently skipped or converted to PASS',async()=>{
  const changed=rows();
  changed[1].before.CC=0x88;
  await fixture(async args=>{
    const report=await runGate(args);
    assert.equal(report.status,'FIRST_DIVERGENCE');
    assert.equal(report.first_divergence.seq,0);
    assert.equal(report.first_divergence.pc,'0x6000');
    assert.ok(report.first_divergence.divergent_fields.includes('CC'));
    assert.equal(report.full_game_or_bus_irq_equivalence_verified,false);
  },{states:changed});
});
test('empty whitelist does not pass by comparing zero instructions',async()=>{
  const mem=image();
  mem[0x6000]=0x39;
  await fixture(async args=>{
    const report=await runGate(args);
    assert.equal(report.status,'NO_SUPPORTED_NATIVE_PAIR');
    assert.equal(report.compared_pairs,0);
  },{rom:mem,states:[row(0,basic(0x6000)),row(1,basic(0x6001))]});
});
test('rejects forged provenance, discontinuous sequence and invalid snapshot',async()=>{
  const altered=rows();altered[1].seq=5;
  await fixture(async args=>{
    await assert.rejects(()=>runGate(args),/R3_PRETRACE_OR_SEQUENCE_INVALID/);
  },{states:altered});
  const forged=rows();forged[0].origin='generated-js-runtime';
  await fixture(async args=>{
    await assert.rejects(()=>runGate(args),/R3_PRETRACE_OR_SEQUENCE_INVALID/);
  },{states:forged});
  const bad=rows();bad[0].before.CC=256;
  await fixture(async args=>{
    await assert.rejects(()=>runGate(args),/INVALID_MC6809_REGISTER_STATE/);
  },{states:bad});
});
test('wrong reset vector and outputs outside ignored out/r3 cannot pass',async()=>{
  const rom=image();rom[0xfffe]=0xff;
  await fixture(async args=>{
    await assert.rejects(()=>runGate(args),/R3_UNEXPECTED_GNGB_RESET_VECTOR/);
  },{rom});
  await fixture(async args=>{
    await assert.rejects(()=>runGate({...args,outDir:'out/generated'}),/R3_PRIVATE_OUTPUT_OUTSIDE_OUT_R3/);
  });
});
test('generated loads update only N,Z,V, preserve H,C and remaining CC bits',async()=>{
  const rom=image();rom[0x6000]=0x86;rom[0x6001]=0x80;
  const src=emitStaticModule([compileAt(rom,0x6000)]);
  await fixture(async args=>{
    const path=resolve(args.outDir,'register-flag-test.mjs');
    await writeFile(path,src);
    const {compiledStep}=await import(pathToFileURL(path).href);
    const original=basic(0x6000,0,0x31);
    const result=compiledStep(original);
    assert.equal(result.CC,0x39);
    assert.equal(result.A,0x80);
    assert.equal(original.A,0);
  });
});
test('compare function rejects missing registers rather than normalising',()=>{
  assert.deepEqual(diffRegisters(basic(0x6000),basic(0x6000)),[]);
  assert.deepEqual(diffRegisters(basic(0x6000),basic(0x6001)),['PC']);
  assert.throws(()=>diffRegisters({PC:0},basic(0x6000)),/INVALID_MC6809_REGISTER_STATE/);
});
