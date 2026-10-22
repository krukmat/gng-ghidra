import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {opcodeFamily,profileDynamicCoverage}
  from '../scripts/r3_dynamic_coverage.mjs';

function rom(){
  const bytes=new Uint8Array(65536);
  bytes[0xfffe]=0x60;bytes[0xffff]=0;
  bytes.set([0x86,0x40],0x6002); // LDA immediate
  bytes[0x6000]=0x12; // NOP
  bytes[0x6016]=0x13; // SYNC
  bytes.set([0xb6,0x3c,0x00],0x6017); // ROM-private specific LDA extended
  bytes.set([0x34,0x01,0x35,0x01],0x601a); // PSHS / PULS
  bytes.set([0x10,0x8e,0x12,0x34],0x6200); // LDY immediate
  bytes[0x4000]=0x39; // banked opcode is not trusted as fixed-ROM
  return bytes;
}
const registers=pc=>({PC:pc,A:0,B:0,X:0,Y:0,U:0,S:0,DP:0,CC:0x50});
function row(seq,pc){
  return {schema:'gng.r2.pre-instruction.v1',
    kind:'pre_instruction',origin:'mame-native-tracelog',
    seq,pc,before:registers(pc)};
}
function trace(){
  const pcs=[0x6002,0x6016,0x6000,0x6016,0x6017,
    0x601a,0x601c,0x601a,0x6200,0x4000];
  return pcs.map((pc,seq)=>row(seq,pc));
}
function sync(){
  return {status:'SYNC_BYTE_AND_WAIT_BARRIER_PREPARED',
    epochs:[
      {epoch:0,sync_pc:'0x6016',sync_prestate_seq:1,
        next_debugger_pc:'0x6000'},
      {epoch:1,sync_pc:'0x6016',sync_prestate_seq:3,
        next_debugger_pc:'0x6017',irq_masked_in_sync_prestate:true,
        firq_masked_in_sync_prestate:true}
    ]};
}
test('profile counts actual native PCs and AOT-eligible samples, not total game coverage',()=>{
  const r=profileDynamicCoverage(rom(),trace(),sync());
  assert.equal(r.status,'NATIVE_TRACE_COVERAGE_PROFILED_NOT_RUNTIME_EQUIVALENCE');
  assert.equal(r.native_prestate_samples,10);
  assert.deepEqual(r.native_epochs,[{epoch:0,samples:2},
    {epoch:1,samples:8}]);
  assert.equal(r.distinct_observed_pcs,8);
  assert.equal(r.aot_codegen_eligible_samples,6);
  assert.equal(r.aot_codegen_eligible_share_of_observed_samples,0.6);
  assert.equal(r.post_lda_first_pc,'0x601a');
  assert.equal(r.post_lda_first_family,'PSHS');
  assert.equal(r.post_lda_first_aot_eligibility,
    'UNSUPPORTED_OR_UNVERIFIED_OPCODE');
  assert.equal(r.most_repeated_unsupported_families[0].family,'PSHS');
  assert.equal(r.most_repeated_unsupported_families[0].samples,2);
  assert.deepEqual(r.highest_frequency_unsupported_pcs[0],
    {pc:'0x601a',family:'PSHS',samples:2});
  assert.equal(r.dynamic_edges_are_cpu_control_flow_proven,false);
  assert.equal(r.sampled_pc_coverage_is_total_rom_coverage,false);
  assert.equal(r.game_playable,false);
});
test('banked code is never misidentified as a trusted fixed-ROM RTS',()=>{
  const r=profileDynamicCoverage(rom(),trace(),sync());
  assert.ok(r.eligibility_categories.some(x=>
    x.eligibility==='BANKED_ROM_NOT_PROVEN'&&x.samples===1));
  assert.equal(opcodeFamily(rom(),0x4000),'NON_FIXED_ROM');
  assert.equal(r.distinct_fixed_rom_pcs,7);
  assert.equal(r.fixed_rom_prestate_samples,9);
});
test('common opcode hints provide priorities but no invented instruction semantics',()=>{
  const b=rom();
  assert.equal(opcodeFamily(b,0x601a),'PSHS');
  assert.equal(opcodeFamily(b,0x601c),'PULS');
  assert.equal(opcodeFamily(b,0x6017),'LDA_EXT');
  assert.equal(opcodeFamily(b,0x6200),'LDY_IMM');
  b[0x6200]=0x11;b[0x6201]=0x3f;
  assert.equal(opcodeFamily(b,0x6200),'SWI3');
  b[0x6200]=0x26;
  assert.equal(opcodeFamily(b,0x6200),'SHORT_BRANCH');
  b[0x6200]=0x10;b[0x6201]=0x26;
  assert.equal(opcodeFamily(b,0x6200),'PAGE10_LONG_BRANCH');
  b[0x6200]=0x45;
  assert.equal(opcodeFamily(b,0x6200),'REG_UNARY');
  assert.equal(opcodeFamily(b,0x3000),'NON_FIXED_ROM');
});
test('invalid/native-corrupted CPU samples fail closed, never count fictitious coverage',()=>{
  for(const modify of [
    rows=>{rows[5].seq=4;},
    rows=>{rows[4].origin='fake-generated-js';},
    rows=>{rows[0].before.PC=0x6003;},
    rows=>{rows[6].before.CC=256;},
    rows=>{rows[9].pc=0x10000;},
    rows=>{rows[2].kind='post_instruction';}
  ]){
    const rows=trace();modify(rows);
    assert.throws(()=>profileDynamicCoverage(rom(),rows,sync()),/A0_|INVALID_MC6809/);
  }
});
test('a fabricated reset/SYNC cut, unsupported ROM or invalid limit cannot produce metrics',()=>{
  const a=sync();a.epochs[1].next_debugger_pc='0x7000';
  assert.throws(()=>profileDynamicCoverage(rom(),trace(),a),
    /A0_NATIVE_SYNC_AND_RESET_PROVENANCE_REQUIRED/);
  const b=sync();b.epochs[0].sync_prestate_seq=4;
  assert.throws(()=>profileDynamicCoverage(rom(),trace(),b),
    /A0_NATIVE_BOUNDARY_SEQUENCE_MISSING/);
  const wrong=rom();wrong[0xffff]=1;
  assert.throws(()=>profileDynamicCoverage(wrong,trace(),sync()),
    /A0_NATIVE_ROM_OR_PRETRACE_INVALID/);
  assert.throws(()=>profileDynamicCoverage(rom(),trace(),sync(),{top:51}),
    /A0_INVALID_TOP_LIMIT/);
});
test('report contains no private ROM bytes, register state, native read values or generated code',()=>{
  const report=JSON.stringify(profileDynamicCoverage(rom(),trace(),sync()));
  assert.doesNotMatch(report,/"CC"\s*:|"A"\s*:|readByte\(|\b0x3c00\b|raw_opcodes|operand_bytes/);
  assert.match(report,/sampled_pc_coverage_is_total_rom_coverage":false/);
  assert.match(report,/raw_rom_bytes_registers_or_dynamic_read_values_exported":false/);
});
test('reuse existing compiler, ROM verifier and SYNC proof rather than new emulator or full CFG claim',async()=>{
  const script=await readFile('scripts/r3_dynamic_coverage.mjs','utf8');
  assert.match(script,/compileAt\(rom,pc\)/);
  assert.match(script,/inspectNativeSyncPrestates\(rom,rows,proof\)/);
  assert.match(script,/runNativeBootWriteGate\(/);
  assert.match(script,/top.*12/);
  assert.doesNotMatch(script,/eval\(|WebAssembly|interpreterLoop/);
});


test('A0.2 regression: 2,048-hit-family must outrank earlier 104-hit family',()=>{
  // Previous sort called .hits on output rows that contain .samples,
  // returning NaN and keeping insertion order instead of priority.
  const data=trace(),image=rom();
  image[0x6800]=0x34;image[0x6801]=0x01; // earlier PSHS
  image[0x6810]=0xa7;image[0x6811]=0x88; // uncompiled 8-bit offset STA indexed
  data.push(row(data.length,0x6800));
  for(let i=0;i<8;i++)data.push(row(data.length,0x6810));
  const result=profileDynamicCoverage(image,data,sync());
  const family=result.most_repeated_unsupported_families;
  assert.equal(family[0].family,'STA_INDEXED');
  assert.equal(family[0].samples,8);
  assert.ok(family.findIndex(x=>x.family==='PSHS')>0);
  for(let i=1;i<family.length;i++){
    assert.ok(family[i-1].samples>=family[i].samples,
      'families must be sorted by numerical hit count');
  }
});
test('A0.2 compiler additions increase codegen eligibility, not certified runtime coverage',()=>{
  const image=rom(),data=trace();
  // Synthetic DEC A, CMPX immediate, and BGE branch appear in supported
  // codegen categories without any claims of native state/bus equivalence.
  image[0x6800]=0x4a;
  image.set([0x8c,0x7f,0xff],0x6801);
  image.set([0x2c,0xfb],0x6804);
  data.push(row(data.length,0x6800));
  data.push(row(data.length,0x6801));
  data.push(row(data.length,0x6804));
  const report=profileDynamicCoverage(image,data,sync());
  assert.equal(report.aot_codegen_eligible_samples,9);
  assert.equal(report.full_cpu_bus_irq_or_gameplay_equivalence_verified,false);
  assert.equal(report.sampled_pc_coverage_is_total_rom_coverage,false);
});
