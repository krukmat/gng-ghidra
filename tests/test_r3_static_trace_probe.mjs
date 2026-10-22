import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {compileAt,emitStaticModule,diffRegisters,runGate,analyzeContiguousSegments}
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
test('G2 contiguous replay executes four JS instructions with one initial real-shape state',async()=>{
  await fixture(async args=>{
    const result=await runGate(args);
    assert.equal(result.status,'MATCHED_SUPPORTED_PRESTATE_PAIRS');
    const c=result.contiguous;
    assert.equal(c.status,'FOUR_PLUS_STEPS_OBSERVED');
    assert.equal(c.compiled_supported_pairs,4);
    assert.equal(c.matching_pairs,4);
    assert.equal(c.longest_segment_steps,4);
    assert.equal(c.segments_at_least_4,1);
    assert.equal(c.top_segments[0].start_seq,0);
    assert.equal(c.top_segments[0].start_pc,'0x6000');
    assert.equal(c.top_segments[0].stop_reason,'TRACE_END');
    assert.equal(c.starts_from_one_mame_prestate_per_segment,true);
    assert.equal(c.reinjects_mame_state_per_instruction,false);
    assert.equal(c.bus_or_irq_equivalence_verified,false);
    assert.equal(c.game_executable,false);
  });
});
test('G2 stops runs on uncompiled instructions, does not concatenate separated matching pairs',()=>{
  const mem=image();
  const compiled=new Map([
    [0x6000,compileAt(mem,0x6000)],
    [0x6004,compileAt(mem,0x6004)],
  ]);
  function syntheticStep(r){
    if(r.PC===0x6000)return {...r,PC:0x6002,A:0x7f};
    if(r.PC===0x6004)return {...r,PC:0x6008};
    throw Error('UNCOMPILED_PC');
  }
  const r=analyzeContiguousSegments(rows(),compiled,syntheticStep);
  assert.equal(r.matching_pairs,2);
  assert.equal(r.compiled_supported_pairs,2);
  assert.equal(r.longest_segment_steps,1);
  assert.equal(r.segments_at_least_2,0);
  assert.equal(r.status,'NO_MULTISTEP_FOUND');
});
test('G2 stops and records a CC divergence rather than forging a continuous segment',async()=>{
  const corrupt=rows();
  corrupt[1].before.CC=0x88;
  await fixture(async args=>{
    const result=await runGate(args);
    const c=result.contiguous;
    assert.equal(result.status,'FIRST_DIVERGENCE');
    assert.equal(c.status,'FIRST_DIVERGENCE');
    assert.equal(c.first_divergence.seq,0);
    assert.deepEqual(c.first_divergence.divergent_fields,['CC']);
    assert.ok(c.longest_segment_steps<4);
    assert.equal(c.matching_pairs,result.matching_pairs);
  },{states:corrupt});
});
test('G2 never reads MAME before state again inside contiguous segment',()=>{
  const mem=image(),states=rows();
  const specs=new Map(states.slice(0,4).map(row=>[row.pc,compileAt(mem,row.pc)]));
  const bogusStep=()=>{
    // Failing generated execution must surface as an exception,
    // not be concealed by resetting from a new MAME row.
    throw Error('SYNTHETIC_COMPILED_JS_FAILURE');
  };
  assert.throws(
    ()=>analyzeContiguousSegments(states,specs,bogusStep),
    /SYNTHETIC_COMPILED_JS_FAILURE/);
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
// A synthetic *ROM-pattern* fixture based on the previously verified
// src/poc.py reset-loop decoder. These are hand-authored expected register
// checkpoints, not captured MAME evidence or true memory equivalence.
const resetLoopImage=()=>{
  const mem=new Uint8Array(65536);
  mem[0xfffe]=0x60;mem[0xffff]=0;
  mem.set([
    0x1a,0x50,       // ORCC #$50
    0x8e,0x1e,0x00,  // LDX #$1e00
    0x10,0x8e,0,2,   // LDY #$0002
    0xcc,0x12,0x34,  // LDD #$1234
    0xed,0x81,       // STD ,X++
    0xed,0x81,       // STD ,X++
    0x31,0x3f,       // LEAY -1,Y
    0x26,0xf8,       // BNE $600c
    0x39,            // unsupported RTS, stops segment
  ],0x6000);
  return mem;
};
const resetCheckpoint=(PC,X,Y,A,B,CC)=>({
  PC,X,Y,A,B,CC,U:0,S:0x2000,DP:0
});
const resetLoopRows=()=>{
  const states=[
    resetCheckpoint(0x6000,0,0,0,0,0x80),
    resetCheckpoint(0x6002,0,0,0,0,0xd0),
    resetCheckpoint(0x6005,0x1e00,0,0,0,0xd0),
    resetCheckpoint(0x6009,0x1e00,2,0,0,0xd0),
    resetCheckpoint(0x600c,0x1e00,2,0x12,0x34,0xd0),
    resetCheckpoint(0x600e,0x1e02,2,0x12,0x34,0xd0),
    resetCheckpoint(0x6010,0x1e04,2,0x12,0x34,0xd0),
    resetCheckpoint(0x6012,0x1e04,1,0x12,0x34,0xd0),
    resetCheckpoint(0x600c,0x1e04,1,0x12,0x34,0xd0),
    resetCheckpoint(0x600e,0x1e06,1,0x12,0x34,0xd0),
    resetCheckpoint(0x6010,0x1e08,1,0x12,0x34,0xd0),
    resetCheckpoint(0x6012,0x1e08,0,0x12,0x34,0xd4),
    resetCheckpoint(0x6014,0x1e08,0,0x12,0x34,0xd4)
  ];
  return states.map((state,i)=>row(i,state));
};
test('ROM-attested reset loop statically compiles STD ,X++ and LEAY -1,Y only at exact PCs',()=>{
  const rom=resetLoopImage();
  assert.equal(compileAt(rom,0x600c)?.name,'STD_X_POSTINC');
  assert.equal(compileAt(rom,0x600e)?.name,'STD_X_POSTINC');
  assert.equal(compileAt(rom,0x6010)?.name,'LEAY_MINUS_1');
  assert.equal(compileAt(rom,0x6014),null);
  rom[0x6100]=0xed;rom[0x6101]=0x81;
  assert.equal(compileAt(rom,0x6100),null);
  rom[0x600c]=0xed;rom[0x600d]=0x80; // wrong postbyte
  assert.equal(compileAt(rom,0x600c),null);
});
test('generated STD X++ performs guarded 16-bit RAM write, increments X, updates NZV',async()=>{
  await fixture(async args=>{
    const rom=resetLoopImage(),source=emitStaticModule([
      compileAt(rom,0x600c),compileAt(rom,0x6010)]);
    const output=resolve(args.outDir,'boot-mem-tests.mjs');
    await writeFile(output,source);
    const {compiledStep}=await import(pathToFileURL(output).href);
    const initial=resetCheckpoint(0x600c,0x1e00,2,0x80,0,0xf2);
    const writes=[];
    const result=compiledStep(initial,(addr,word)=>writes.push([addr,word]));
    assert.deepEqual(writes,[[0x1e00,0x8000]]);
    assert.equal(result.X,0x1e02);
    assert.equal(result.PC,0x600e);
    assert.equal(result.CC,0xf8); // N set, V cleared, Z cleared, H and C preserved
    assert.equal(initial.X,0x1e00); // no caller register mutation
    assert.throws(()=>compiledStep(initial),/MISSING_RAM_WORD_SINK/);
    assert.throws(()=>compiledStep({...initial,X:0x1fff},
      ()=>assert.fail('must not write')),/SPRITE_RAM_WRITE_OUT_OF_RANGE/);
    const leay=compiledStep(resetCheckpoint(0x6010,0x1e02,1,0x80,0,0xf8));
    assert.equal(leay.Y,0);
    assert.equal(leay.CC,0xfc);
  });
});
test('synthetic reset loop G2+ crosses memory writes with accumulated JS register state',async()=>{
  await fixture(async args=>{
    const result=await runGate(args);
    assert.equal(result.status,'MATCHED_SUPPORTED_PRESTATE_PAIRS');
    assert.equal(result.compared_pairs,12);
    assert.equal(result.matching_pairs,12);
    assert.equal(result.contiguous.longest_segment_steps,12);
    assert.equal(result.contiguous.top_segments[0].start_pc,'0x6000');
    assert.equal(result.contiguous.top_segments[0].modeled_ram_word_writes,4);
    assert.equal(result.contiguous.modeled_ram_word_writes,4);
    assert.equal(result.contiguous.ram_writes_compared_with_mame,false);
    assert.equal(result.generated_sprite_ram_writes_unverified_by_reference,true);
    assert.equal(result.no_runtime_memory_or_io,false);
    assert.equal(result.full_game_or_bus_irq_equivalence_verified,false);
    const source=await readFile(resolve(args.outDir,'static-rom-slice.mjs'),'utf8');
    assert.match(source,/writeRamWord\(r.X,\(r.A<<8\)\|r.B\)/);
    assert.doesNotMatch(source,/decodeOpcode|opcodes\[|rom\[r.PC\]/);
  },{rom:resetLoopImage(),states:resetLoopRows()});
});
test('bad synthetic RAM write range blocks, never normalises outside sprite RAM',async()=>{
  const states=resetLoopRows();
  // Change only the entry state to an invalid sprite pointer.
  states[4].before.X=0x2000;
  await fixture(async args=>{
    await assert.rejects(()=>runGate(args),/SPRITE_RAM_WRITE_OUT_OF_RANGE/);
  },{rom:resetLoopImage(),states});
});

test('compare function rejects missing registers rather than normalising',()=>{
  assert.deepEqual(diffRegisters(basic(0x6000),basic(0x6000)),[]);
  assert.deepEqual(diffRegisters(basic(0x6000),basic(0x6001)),['PC']);
  assert.throws(()=>diffRegisters({PC:0},basic(0x6000)),/INVALID_MC6809_REGISTER_STATE/);
});
