import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {compileLdaAt,emitLdaModule} from '../scripts/r3_lda_extended_gate.mjs';
import {classifyGngbReadMapping,diagnoseNativeReadMultiplicity}
  from '../scripts/r3_mmio_read_diagnostics.mjs';

const state=(PC,A=0,CC=0x50)=>({
  PC,A,B:0,X:0,Y:0,U:0,S:0x2000,DP:0,CC});
const row=(seq,s)=>({
  schema:'gng.r2.pre-instruction.v1',
  kind:'pre_instruction',origin:'mame-native-tracelog',
  seq,pc:s.PC,before:s
});
function romFixture(addr=0x3800){
  const rom=new Uint8Array(65536);
  rom[0xfffe]=0x60;rom[0xffff]=0;
  rom.set([0xb6,addr>>8,addr&255],0x6017);
  return rom;
}
function sampleTsv(samples){
  const records=['R36_TARGETED_READ_ENABLED\t1',
    'R36_TARGETED_READ_ADDR\t14336',
    'SOFT_RESET_REQUESTED\t1\t24598',
    'RESET_NOTIFICATION\t0\t24576'];
  for(const [index,{data,mask=255}] of samples.entries()){
    records.push(['R36_TARGETED_READ_BYTE',1,index+1,2,
      24599,14336,data,mask].join('\t'));
  }
  records.push('R36_TARGETED_READ_COUNT\t'+samples.length);
  records.push('PROBE_END\tframe-limit');
  return records.join('\n')+'\n';
}
const proof=()=>({
  status:'PASS_BOOT_SPRITE_RAM_WRITE_BYTES',
  actual_mame_sprite_byte_writes_compared:true,
  per_boot:[{uniquely_matched:true},{uniquely_matched:true}]
});
const sync=()=>({
  status:'SYNC_BYTE_AND_WAIT_BARRIER_PREPARED',
  epochs:[{},{
    sync_prestate_seq:0,next_debugger_pc:'0x6017',
    irq_masked_in_sync_prestate:true,
    firq_masked_in_sync_prestate:true
  }]
});
async function fixture(fn){
  await mkdir('out/r3',{recursive:true});
  const dir=await mkdtemp(resolve('out/r3/mmio-b3-test-'));
  try{
    const rom=romFixture();
    const modulePath=resolve(dir,'private-static-lda.mjs');
    await writeFile(modulePath,emitLdaModule(compileLdaAt(rom)));
    const {executeLdaExt}=await import(pathToFileURL(modulePath).href);
    const args={
      rom,executeLdaExt,
      rows:[row(0,state(0x6016)),row(1,state(0x6017)),
        row(2,state(0x601a,128,0x58))],
      bootProof:proof(),sync:sync()
    };
    return await fn(args);
  }finally{await rm(dir,{recursive:true,force:true});}
}
test('100 identical full-byte native reads: checkpoint consistent, but never bus/IRQ equivalence',async()=>{
  await fixture(args=>{
    const report=diagnoseNativeReadMultiplicity({...args,
      tsv:sampleTsv(Array.from({length:100},()=>({data:128})))});
    assert.equal(report.status,
      'UNIFORM_NATIVE_READS_REGISTER_CONSISTENT_BUS_CAUSE_UNVERIFIED');
    assert.equal(report.native_exact_target_read_count,100);
    assert.equal(report.reads_after_reset,100);
    assert.equal(report.distinct_second_epoch_read_values,1);
    assert.equal(report.all_second_epoch_read_values_same,true);
    assert.equal(report.sample_count_consistent_with_next_register_checkpoint,100);
    assert.equal(report.generated_static_lda_evaluated_for_all_distinct_values,true);
    assert.equal(report.native_bus_read_to_instruction_provenance_verified,false);
    assert.equal(report.autonomous_device_read_model_implemented,false);
    assert.equal(report.wake_irq_line_verified,false);
    assert.equal(report.game_playable,false);
    assert.equal(report.raw_values_or_operand_address_exported,false);
    assert.doesNotMatch(JSON.stringify(report),/14336|0x3800|"data":128/);
  });
});
test('100 mixed values cannot be cherry-picked even if some reproduce the next MAME A',async()=>{
  await fixture(args=>{
    const samples=Array.from({length:70},()=>({data:128}))
      .concat(Array.from({length:30},()=>({data:127})));
    const report=diagnoseNativeReadMultiplicity({...args,
      tsv:sampleTsv(samples)});
    assert.equal(report.status,
      'VARIABLE_NATIVE_READS_SOME_CHECKPOINT_CONSISTENT_NOT_CAUSAL');
    assert.equal(report.distinct_second_epoch_read_values,2);
    assert.equal(report.distinct_values_consistent_with_next_register_checkpoint,1);
    assert.equal(report.sample_count_consistent_with_next_register_checkpoint,70);
    assert.equal(report.native_bus_read_to_instruction_provenance_verified,false);
  });
});
test('uniform but inconsistent sample is NOT reported as CPU divergence',async()=>{
  await fixture(args=>{
    const report=diagnoseNativeReadMultiplicity({...args,
      tsv:sampleTsv([{data:127},{data:127}])});
    assert.equal(report.status,
      'UNIFORM_NATIVE_READS_REGISTER_DISAGREEMENT_CAUSE_UNVERIFIED');
    assert.equal(report.distinct_values_consistent_with_next_register_checkpoint,0);
    assert.equal(report.native_bus_read_to_instruction_provenance_verified,false);
  });
});
test('empty observations and partial read masks block, never generate accepted JS read',async()=>{
  await fixture(args=>{
    const missing=diagnoseNativeReadMultiplicity({...args,
      tsv:sampleTsv([])});
    assert.equal(missing.status,'BLOCKED_NO_POST_RESET_TARGET_READS');
    const mask=diagnoseNativeReadMultiplicity({...args,
      tsv:sampleTsv([{data:128,mask:0},{data:128}])});
    assert.equal(mask.status,'BLOCKED_NON_FULL_BYTE_NATIVE_READ_MASK');
    assert.equal(mask.generated_static_lda_evaluated_for_all_distinct_values,false);
  });
});
test('gngb write mappings are classified, but no undocumented read return is inferred',()=>{
  const pairs=[
    [0x3800,'PALETTE_EXT_WRITE_HANDLER'],
    [0x3900,'PALETTE_BASE_WRITE_HANDLER'],
    [0x3a00,'SOUND_LATCH_WRITE_HANDLER'],
    [0x3b08,'BG_SCROLL_X_WRITE_HANDLER'],
    [0x3b0b,'BG_SCROLL_Y_WRITE_HANDLER'],
    [0x3c00,'SPRITE_DMA_WRITE_HANDLER'],
    [0x3d07,'MAIN_LATCH_WRITE_HANDLER'],
    [0x3e00,'BANK_SELECT_WRITE_HANDLER'],
    [0x3f00,'NO_EXPLICIT_READ_HANDLER']
  ];
  for(const [addr,expected] of pairs){
    const r=classifyGngbReadMapping(addr);
    assert.equal(r.driver_mapping,expected);
    assert.equal(r.explicit_cpu_read_handler_in_gng_main_map,false);
    assert.equal(r.default_unmapped_read_value_verified,false);
  }
  assert.throws(()=>classifyGngbReadMapping(0x3000),
    /ADDRESS_OUTSIDE/);
});
test('same-run provenance, native checkpoint and exact address are mandatory',async()=>{
  await fixture(args=>{
    const tsv=sampleTsv([{data:128}]);
    assert.throws(()=>diagnoseNativeReadMultiplicity({
      ...args,bootProof:{...args.bootProof,
        actual_mame_sprite_byte_writes_compared:false},tsv}),
    /SAME_RUN_NATIVE_BOOT_PROOF_MISSING/);
    const changed={...args,sync:{...args.sync,epochs:[{},
      {...args.sync.epochs[1],next_debugger_pc:'0x7000'}]}};
    assert.throws(()=>diagnoseNativeReadMultiplicity({...changed,tsv}),
      /POST_SYNC_PROVENANCE_MISSING/);
    const wrong={...args,rom:romFixture(0x4000)};
    assert.throws(()=>diagnoseNativeReadMultiplicity({...wrong,tsv}),
      /NOT_FIXED_ROM_MMIO_LDA/);
  });
});
