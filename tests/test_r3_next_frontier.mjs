import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inspectPostBootFrontier} from '../scripts/r3_next_frontier.mjs';

const proof=()=>({
  status:'PASS_BOOT_SPRITE_RAM_WRITE_BYTES',
  boot_runs_compared:2,compiled_sprite_ram_word_writes:384,
  native_sprite_byte_samples:768,
  actual_mame_sprite_byte_writes_compared:true,
  per_boot:[0,1].map(epoch=>({epoch,uniquely_matched:true,
    native_sample_count:384,expected_byte_writes:384,
    unverified_other_native_writes:0}))
});
const image=()=>{
  const rom=new Uint8Array(65536);
  rom[0xfffe]=0x60;rom[0xffff]=0;
  rom[0x6014]=0x12; // known compiled NOP (test-only)
  rom[0x6015]=0x34; // PSHS: unsupported but labeled, not decoded
  return rom;
};
const trace=()=>{
  const rows=[];
  function add(PC){
    const seq=rows.length;
    rows.push({schema:'gng.r2.pre-instruction.v1',
      kind:'pre_instruction',origin:'mame-native-tracelog',
      seq,pc:PC,before:{PC,A:0,B:0,X:0,Y:0,U:0,S:0,DP:0,CC:0}});
  }
  for(const boot of [0x6002,0x6000]){
    if(boot===0x6000)add(0x6000);
    for(const pc of [0x6002,0x6005,0x6009])add(pc);
    for(let i=0;i<96;i++){
      for(const pc of [0x600c,0x600e,0x6010,0x6012])add(pc);
    }
    add(0x6014);
    add(0x6015);
    add(0x7000);
  }
  return rows;
};
test('identifies the first truly uncompiled ROM PC after both complete 192-store boots',()=>{
  const result=inspectPostBootFrontier(image(),trace(),proof());
  assert.equal(result.status,'FRONTIER_IDENTIFIED_NOT_COMPILED');
  assert.equal(result.boot_runs_with_native_ram_write_proof,2);
  assert.equal(result.unique_first_uncompiled_pc,'0x6015');
  assert.equal(result.boot_frontiers[0].boot_instruction_count,387);
  assert.equal(result.boot_frontiers[1].boot_instruction_count,388);
  assert.ok(result.boot_frontiers.every(x=>
    x.boot_exit_pc==='0x6014' && x.already_compiled_after_boot===1 &&
    x.candidate_opcode_family==='PSHS'));
  assert.equal(result.opcode_bytes_or_register_values_exported,false);
  assert.equal(result.next_instruction_cpu_equivalence_verified,false);
  assert.equal(result.full_ram_irq_bank_bus_verified,false);
  assert.doesNotMatch(JSON.stringify(result),/registers|raw_bytes|opcode_hex/i);
});
test('fails closed if native RAM write proof is missing, partial or ambiguous',()=>{
  const cases=[
    {status:'BLOCKED_NATIVE_BOOT_SPRITE_RAM_DIFFERENTIAL'},
    {...proof(),boot_runs_compared:1},
    {...proof(),native_sprite_byte_samples:767},
    {...proof(),per_boot:[{...proof().per_boot[0],uniquely_matched:false},proof().per_boot[1]]},
    {...proof(),per_boot:[{...proof().per_boot[0],unverified_other_native_writes:1},proof().per_boot[1]]},
  ];
  for(const p of cases){
    assert.throws(()=>inspectPostBootFrontier(image(),trace(),p),
      /R3_FRONTIER_MISSING_COMPLETE_NATIVE_BOOT_WRITE_PROOF/);
  }
});
test('malformed row sequence, missing stores or premature reset cannot fake frontier',()=>{
  const rows=trace();
  rows[1].seq=42;
  assert.throws(()=>inspectPostBootFrontier(image(),rows,proof()),
    /R3_FRONTIER_PRETRACE_INCOMPATIBLE/);
  const shortened=trace().filter(x=>x.seq!==11)
    .map((r,i)=>({...r,seq:i}));
  assert.throws(()=>inspectPostBootFrontier(image(),shortened,proof()),
    /R3_FRONTIER_(UNEXPECTED_BOOT_INSTRUCTION_COUNT|MISSING_BOOT_SPRITE_STORES)/);
});
test('unclassified candidate is explicit; no guessed opcode semantics',()=>{
  const rom=image();rom[0x6015]=0xff;
  const result=inspectPostBootFrontier(rom,trace(),proof());
  assert.equal(result.boot_frontiers[0].candidate_opcode_family,
    'UNCLASSIFIED_NEEDS_GHIDRA');
});
test('both boots must reach the same first unsupported frontier',()=>{
  const rows=trace();
  // Second epoch jumps to a separate unknown instruction after 0x6014.
  const second=rows.findIndex((r,i)=>r.pc===0x6000&&i>10);
  const idx=rows.findIndex((r,i)=>i>second&&r.pc===0x6015);
  rows[idx]={...rows[idx],pc:0x6016,
    before:{...rows[idx].before,PC:0x6016}};
  assert.throws(()=>inspectPostBootFrontier(image(),rows,proof()),
    /R3_FRONTIER_BOOT_EXITS_DIFFER/);
});
