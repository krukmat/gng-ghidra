import test from 'node:test';
import assert from 'node:assert/strict';
import {compileZ80Prefix} from '../src/gngb_z80_static_codegen.mjs';
import {summarizeZ80Frontiers,parseZ80OperatorSeeds} from '../src/gngb_audio_frontier_report.mjs';

test('B1 report groups separate branch frontiers; family order is deterministic',()=>{
  const rom=new Uint8Array(0x8000);
  // Both branch targets stop on different unsupported families.
  rom.set([0x20,0x02,0xcb,0x11,0xdd,0x21],0);
  const result=compileZ80Prefix(rom);
  const report=summarizeZ80Frontiers(result);
  assert.equal(report.kind,'GNG_AUDIO_Z80_FRONTIER_SCAN_V1');
  assert.equal(report.status,'PARTIAL_UNCERTIFIED');
  assert.equal(report.static_decoded_pcs,1);
  assert.equal(report.static_frontiers_total,2);
  assert.deepEqual(report.families,[
    {family:'CB_BIT_ROTATE_PREFIX',blocked_static_pcs:1,first_pc:2,priority:'P0'},
    {family:'DD_IX_PREFIX',blocked_static_pcs:1,first_pc:4,priority:'P0'}
  ]);
  assert.deepEqual(report.frontiers,[
    {pc:2,family:'CB_BIT_ROTATE_PREFIX',reason:'UNSUPPORTED_Z80_OPCODE'},
    {pc:4,family:'DD_IX_PREFIX',reason:'UNSUPPORTED_Z80_OPCODE'}
  ]);
  assert.equal(report.native_trace_parity_verified,false);
  assert.equal(report.ym_pcm_verified,false);
  assert.equal(report.private_rom_bytes_exported,false);
  assert.equal(report.static_generated_code_exported,false);
  assert.equal(JSON.stringify(report).includes('z80AotBlocks'),false);
});

test('B1 multiple seeded roots deduplicate PC and rank frequent blocker family',()=>{
  const rom=new Uint8Array(0x8000);
  rom.set([0xcb],0);
  rom.set([0xcb],0x100);
  rom.set([0xed,0xb1],0x200);
  const result=compileZ80Prefix(rom,{entries:[0,0x100,0x200,0]});
  const report=summarizeZ80Frontiers(result,{
    seedSource:'OPERATOR_SUPPLIED_PCS'
  });
  assert.deepEqual(report.operator_seed_pcs,[0,0x100,0x200]);
  assert.equal(report.seed_source,'OPERATOR_SUPPLIED_PCS');
  assert.equal(report.static_frontiers_total,3);
  assert.equal(report.families[0].family,'CB_BIT_ROTATE_PREFIX');
  assert.equal(report.families[0].blocked_static_pcs,2);
  assert.equal(report.families[1].family,'ED_EXTENDED_PREFIX');
  assert.equal(report.families[1].blocked_static_pcs,1);
  assert.equal(report.executed_pc_coverage_verified,false);
});

test('B1 report caps output without hiding total blocked frontiers',()=>{
  const rom=new Uint8Array(0x8000);
  for(let k=0;k<4;k++)rom[0x100*k]=0xcb;
  const result=compileZ80Prefix(rom,{entries:[0,0x100,0x200,0x300]});
  const report=summarizeZ80Frontiers(result,{maxFrontiers:2});
  assert.equal(report.static_frontiers_total,4);
  assert.equal(report.static_frontiers_reported,2);
  assert.equal(report.static_frontiers_omitted,2);
  assert.equal(report.frontiers.length,2);
  assert.equal(report.families[0].blocked_static_pcs,4);
});

test('B1 scanner distinguishes truncation, static completion and native evidence',()=>{
  const rom=new Uint8Array(0x8000);
  rom.set([0x00,0x00,0x00,0xc9]);
  const capped=summarizeZ80Frontiers(compileZ80Prefix(rom,{limit:2}),{limit:2});
  assert.equal(capped.status,'TRUNCATED');
  assert.equal(capped.pending_static_edges,1);
  assert.equal(capped.truncated,true);
  const done=summarizeZ80Frontiers(compileZ80Prefix(rom));
  assert.equal(done.status,'NO_STATIC_BLOCKER_NOT_CERTIFIED');
  assert.equal(done.native_trace_parity_verified,false);
  assert.equal(done.gameplay_audio_verified,false);
});

test('B1 strict operator-PC format cannot silently certify arbitrary ROM offsets',()=>{
  const json=JSON.stringify({
    kind:'GNG_AUDIO_Z80_OPERATOR_PCS_V1',
    rom_sha1:'7ef9ec5c2072e21c787a6bbf700033f50c759c1d',
    pcs:[256,512,256]
  });
  assert.deepEqual(parseZ80OperatorSeeds(json),[0,256,512]);
  for(const bad of [
    '{not json}',
    JSON.stringify({kind:'GNG_AUDIO_Z80_OPERATOR_PCS_V1',rom_sha1:'0',pcs:[256]}),
    JSON.stringify({kind:'GNG_AUDIO_Z80_OPERATOR_PCS_V1',
      rom_sha1:'7ef9ec5c2072e21c787a6bbf700033f50c759c1d',pcs:[32768]}),
    JSON.stringify({kind:'GNG_AUDIO_Z80_OPERATOR_PCS_V1',
      rom_sha1:'7ef9ec5c2072e21c787a6bbf700033f50c759c1d',pcs:[]})
  ])assert.throws(()=>parseZ80OperatorSeeds(bad),/AUDIO_SCAN_ROOTS_INVALID/);
});

test('B1 report uses positive allowlist for tags, reasons, PCs and never serializes source',()=>{
  const rom=new Uint8Array(0x8000);
  rom[0]=0xcb;
  const result=compileZ80Prefix(rom);
  result.source='private ROM-derived secret phrase';
  const report=summarizeZ80Frontiers(result);
  assert.equal(JSON.stringify(report).includes('secret phrase'),false);
  const fail={...result,blockers:result.blockers.map(b=>({...b}))};
  fail.blockers=[{pc:0,reason:'bad',family:'CB_BIT_ROTATE_PREFIX'}];
  assert.throws(()=>summarizeZ80Frontiers(fail),/AUDIO_REPORT_INVALID_REASON/);
  fail.blockers=[{pc:0,reason:'UNSUPPORTED_Z80_OPCODE',
    family:'<malicious private data>'}];
  assert.throws(()=>summarizeZ80Frontiers(fail),/AUDIO_REPORT_UNSAFE_TAG/);
});
