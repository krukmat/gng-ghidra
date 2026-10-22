import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {compileAt,emitStaticModule}
  from '../scripts/r3_static_trace_probe.mjs';
import {compileNativeBankedPairs,verifyNativeBankedStaticSteps}
  from '../scripts/r3_banked_static_gate.mjs';

function fixtureData(){
  const fixed=new Uint8Array(65536);
  fixed[0xfffe]=0x60;fixed[0xffff]=0;
  const packed=new Uint8Array(5*8192);
  packed.set([0x86,0x01,0x12],0); // bank 0, PC 0x4000: LDA #01, NOP
  packed.set([0x86,0x03,0x12],3*8192); // bank 3: same PC, distinct opcode operand
  const reg=(PC,A)=>({PC,A,B:0,X:0,Y:0,U:0,S:0x2000,DP:0,CC:0x50});
  const pcs=[0x6000,0x4000,0x4002,0x4000,0x4002,0x6000];
  const A=[0,0,1,1,3,3],ids=[0,0,0,3,3,3];
  const rows=pcs.map((pc,seq)=>({
    schema:'gng.r2.pre-instruction.v1',origin:'mame-native-tracelog',
    kind:'pre_instruction',seq,pc,before:reg(pc,A[seq])
  }));
  const witness=pcs.map((pc,seq)=>({seq,pc,bank:ids[seq]}));
  const nativeBankReport={
    status:'BANK_IDENTITY_AT_EVERY_NATIVE_PRESTATE_VERIFIED',
    native_preinstruction_samples:rows.length,
    bank_window_pc_samples:4,
    native_banked_prestate_bank_identified:4,
    distinct_observed_bank_pc_pairs:4,
    native_per_instruction_mapped_ROM_signature_verified:true
  };
  return {fixed,packed,rows,witness,nativeBankReport};
}
async function compiledFixture(run){
  const x=fixtureData();
  const compiled=compileNativeBankedPairs(x);
  await mkdir('out/r3',{recursive:true});
  const dir=await mkdtemp(resolve('out/r3/a064-banked-'));
  try{
    const compiledByBank=new Map();
    for(const [bank,specs] of compiled.byBank){
      const code=emitStaticModule(specs);
      assert.doesNotMatch(code,/decodeOpcode|opcodeTable|interpreterLoop/);
      const path=resolve(dir,'bank-'+bank+'.mjs');
      await writeFile(path,code);
      const {compiledStep}=await import(pathToFileURL(path).href);
      compiledByBank.set(bank,compiledStep);
    }
    return await run({...x,compiled,compiledByBank});
  }finally{await rm(dir,{recursive:true,force:true});}
}
test('same PC in different authentic banks is compiled to two independent static modules',async()=>{
  await compiledFixture(x=>{
    assert.equal(x.compiled.groups.length,4);
    assert.deepEqual([...x.compiled.byBank.keys()].sort(),[0,3]);
    const result=verifyNativeBankedStaticSteps(x);
    assert.equal(result.status,'BANKED_CODEGEN_WITH_NATIVE_CHECKPOINT_PREFIX_ONLY');
    assert.equal(result.native_bank_window_samples,4);
    assert.equal(result.bank_pc_pairs_with_static_codegen,4);
    assert.equal(result.independently_matched_register_checkpoints,4);
    assert.equal(result.differing_register_checkpoints,0);
    assert.equal(result.bank_per_instruction_mapped_rom_verified,true);
    assert.equal(result.native_irq_sync_resume_verified,false);
    assert.equal(result.autonomous_runtime_or_first_frame_verified,false);
    assert.equal(result.game_playable,false);
    assert.doesNotMatch(JSON.stringify(result),/"A":|"B":|raw_opcode/);
  });
});
test('ordinary fixed-ROM compileAt still refuses bank PCs unless explicitly selected',()=>{
  const x=fixtureData();
  const view=Uint8Array.from(x.fixed);
  view.set(x.packed.subarray(0,8192),0x4000);
  assert.equal(compileAt(view,0x4000),null);
  assert.equal(compileAt(view,0x4000,{banked:false}),null);
  assert.equal(compileAt(view,0x4000,{banked:true})?.name,'LDA_IMM');
  assert.equal(compileAt(view,0x4002,{banked:true})?.name,'NOP');
  view[0x5fff]=0x20; // branch requires second byte in the NEXT mapping
  assert.equal(compileAt(view,0x5fff,{banked:true}),null);
  view[0x5fff]=0x12;
  assert.equal(compileAt(view,0x5fff,{banked:true})?.name,'NOP');
});
test('stale or forged bank per-CPU witness is rejected even when opcode exists',()=>{
  const x=fixtureData();
  for(const modify of [
    w=>{w[2].seq=1;},w=>{w[3].pc=0x4001;},
    w=>{w[2].bank=5;},w=>{w.pop();}
  ]){
    const witness=structuredClone(x.witness);
    modify(witness);
    assert.throws(()=>compileNativeBankedPairs({...x,witness}),/A064_/);
  }
  assert.throws(()=>compileNativeBankedPairs({
    ...x,nativeBankReport:{...x.nativeBankReport,status:'BLOCKED'}
  }),/A064_SAME_RUN/);
});
test('unsupported native bank opcode is inventoried, never executed speculatively',async()=>{
  const x=fixtureData();
  x.packed[0]=0x3b; // unsupported RTI
  const compiled=compileNativeBankedPairs(x);
  assert.equal(compiled.groups.find(g=>g.bank===0&&g.pc===0x4000).spec,null);
  await compiledFixture(async valid=>{
    const modules=new Map(valid.compiledByBank);
    const result=verifyNativeBankedStaticSteps({
      rows:x.rows,witness:x.witness,compiled,compiledByBank:modules
    });
    assert.equal(result.native_samples_without_static_codegen,1);
    assert.equal(result.game_playable,false);
  });
});
test('a native checkpoint divergence is reported with fields only, never CPU or ROM values',async()=>{
  await compiledFixture(x=>{
    const rows=structuredClone(x.rows);
    rows[4].before.A=5;
    const result=verifyNativeBankedStaticSteps({...x,rows});
    assert.equal(result.status,'BANKED_STATIC_CPU_OR_EXTERNAL_EVENT_DIVERGENCE');
    assert.equal(result.first_divergence.pc,'0x4000');
    assert.deepEqual(result.first_divergence.mismatched_register_fields,['A']);
    assert.equal(result.native_cpu_fetch_transaction_correlated,false);
  });
});
