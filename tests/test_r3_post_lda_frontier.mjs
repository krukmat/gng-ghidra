import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {compileAt,emitStaticModule} from '../scripts/r3_static_trace_probe.mjs';
import {compileLdaAt,emitLdaModule} from '../scripts/r3_lda_extended_gate.mjs';
import {emitStaticGngbUnmappedRead}
  from '../scripts/r3_unmapped_read_policy.mjs';
import {planPostLdaCandidates,inspectPostLdaFrontier}
  from '../scripts/r3_post_lda_frontier.mjs';

const regs=(PC,A=0,CC=0x50)=>({
  PC,A,B:0,X:0,Y:0,U:0,S:0x2000,DP:0,CC
});
const row=(seq,entry)=>({
  schema:'gng.r2.pre-instruction.v1',kind:'pre_instruction',
  origin:'mame-native-tracelog',seq,pc:entry.PC,before:entry
});
function image(){
  const rom=new Uint8Array(65536);
  rom[0xfffe]=0x60;rom[0xffff]=0;
  rom.set([0xb6,0x3c,0x00],0x6017);
  rom[0x601a]=0x12; // NOP, one byte
  rom.set([0x86,0x7f],0x601b); // LDA immediate
  rom.set([0x34,0x02],0x601d); // PSHS (not yet compiled)
  return rom;
}
const sync=()=>({
  status:'SYNC_BYTE_AND_WAIT_BARRIER_PREPARED',
  epochs:[{},{
    sync_prestate_seq:0,next_debugger_pc:'0x6017',
    irq_masked_in_sync_prestate:true,
    firq_masked_in_sync_prestate:true
  }]
});
const b4=()=>({
  status:'MAME_UNMAPPED_POLICY_MATCHES_NATIVE_TAPS_AND_STATIC_LDA',
  autonomous_read_policy_for_exact_address_validated:true,
  generated_lda_checkpoint_compared:true,
  all_native_tap_values_equal_map_policy:true,
  native_second_epoch_tap_count:100
});
function snapshotRows(){
  return [
    row(0,regs(0x6016)),
    row(1,regs(0x6017)),
    row(2,regs(0x601a,128,0x58)),
    row(3,regs(0x601b,128,0x58)),
    row(4,regs(0x601d,127,0x50))
  ];
}
async function fixture(run){
  await mkdir('out/r3',{recursive:true});
  const dir=await mkdtemp(resolve('out/r3/b5-test-'));
  try{
    const rom=image(),rows=snapshotRows();
    const plan=planPostLdaCandidates(rom,rows,sync(),b4());
    const names=['lda.mjs','bus.mjs','steps.mjs'].map(s=>resolve(dir,s));
    await writeFile(names[0],emitLdaModule(compileLdaAt(rom)));
    await writeFile(names[1],emitStaticGngbUnmappedRead(128));
    await writeFile(names[2],emitStaticModule(plan.specs));
    const [{executeLdaExt},{readGngbUnmappedByte},{compiledStep}]=
      await Promise.all(names.map(async name=>import(pathToFileURL(name).href)));
    return await run({rom,rows,sync:sync(),b4:b4(),
      executeLdaExt,readGngbUnmappedByte,compiledStep});
  }finally{await rm(dir,{recursive:true,force:true});}
}
test('generated JS carries registers through two post-LDA steps without reinjection',async()=>{
  await fixture(args=>{
    const r=inspectPostLdaFrontier(args);
    assert.equal(r.status,'POST_LDA_OPCODE_FRONTIER_IDENTIFIED');
    assert.equal(r.lda_pc,'0x6017');
    assert.equal(r.first_post_lda_pc,'0x601a');
    assert.equal(r.statically_compiled_steps_compared,2);
    assert.equal(r.last_matching_checkpoint_pc,'0x601d');
    assert.deepEqual(r.first_unsupported,{
      seq:4,pc:'0x601d',family:'PSHS'
    });
    assert.equal(r.accumulated_static_js_registers_from_one_lda_prestate,true);
    assert.equal(r.mame_state_reinjected_between_steps,false);
    assert.equal(r.irq_or_sync_wake_causality_verified,false);
    assert.equal(r.instruction_correlated_bus_access_verified,false);
    assert.equal(r.post_lda_memory_mmio_effects_verified,false);
    assert.equal(r.game_playable,false);
    assert.doesNotMatch(JSON.stringify(r),/0x3c00|15360|"A":128/);
  });
});
test('B4 genuine policy match is mandatory, not just a cached status label',async()=>{
  await fixture(args=>{
    for(const bad of [
      {...args.b4,autonomous_read_policy_for_exact_address_validated:false},
      {...args.b4,generated_lda_checkpoint_compared:false},
      {...args.b4,all_native_tap_values_equal_map_policy:false},
      {...args.b4,native_second_epoch_tap_count:0},
      {...args.b4,status:'BLOCKED_POLICY_OR_TAP_MISMATCH'},
    ]){
      assert.throws(()=>planPostLdaCandidates(args.rom,args.rows,args.sync,bad),
        /NO_SAME_RUN_B4_READ_POLICY_PROOF/);
    }
  });
});
test('wrong resumed CPU boundary and opcode fail closed',async()=>{
  await fixture(args=>{
    const wrong=structuredClone(args.rows);
    wrong[2]=row(2,regs(0x7000));
    assert.throws(()=>planPostLdaCandidates(args.rom,wrong,args.sync,args.b4),
      /NATIVE_POST_LDA_CHECKPOINT_MISSING/);
    const noRom=image();noRom[0x6017]=0x86;
    assert.throws(()=>planPostLdaCandidates(noRom,args.rows,args.sync,args.b4),
      /FIXED_ROM_LDA_NOT_ATTESTED/);
  });
});
test('first mismatched native checkpoint stops the static slice',async()=>{
  await fixture(args=>{
    const changed=structuredClone(args.rows);
    changed[3].before.A=20;
    const r=inspectPostLdaFrontier({...args,rows:changed});
    assert.equal(r.status,'BLOCKED_NATIVE_STEP_OR_EXTERNAL_EVENT_DIVERGENCE');
    assert.equal(r.statically_compiled_steps_compared,0);
    assert.equal(r.first_divergence.pc,'0x601a');
    assert.equal(r.first_divergence.stage,'native_step_or_external_cpu_event');
    assert.deepEqual(r.first_divergence.fields,['A']);
    assert.equal(r.game_playable,false);
  });
});
test('first unknown opcode at 0x601a is classified without inventing semantics',async()=>{
  await fixture(args=>{
    const modified=Uint8Array.from(args.rom);
    modified[0x601a]=0x3b;
    const plan=planPostLdaCandidates(modified,args.rows,args.sync,args.b4);
    assert.equal(plan.specs.length,0);
    assert.equal(plan.stopped,'FIRST_UNCOMPILED_OPCODE');
    assert.equal(plan.candidates[0].family,'RTI');
    const r=inspectPostLdaFrontier({...args,rom:modified});
    assert.equal(r.first_unsupported.family,'RTI');
    assert.equal(r.statically_compiled_steps_compared,0);
  });
});
test('no unverified RAM/MMIO side effects are silently executed',async()=>{
  await fixture(args=>{
    const modified=Uint8Array.from(args.rom);
    modified.set([0xed,0x81],0x600c);
    // This checks side-effect classification only, not executing ROM-generated
    // sprite RAM writes from a post-SYNC native state.
    assert.equal(compileAt(modified,0x600c).writesSpriteWord,true);
    const scan=planPostLdaCandidates(args.rom,args.rows,args.sync,args.b4,1);
    assert.equal(scan.candidates.length,1);
    assert.equal(scan.specs.length,1);
    assert.throws(()=>planPostLdaCandidates(args.rom,args.rows,args.sync,args.b4,65),
      /INVALID_SCAN_BUDGET/);
  });
});
test('the CLI recomputes native policy proof before planning any compiled steps',async()=>{
  const js=await readFile('scripts/r3_post_lda_frontier.mjs','utf8');
  const proofIdx=js.indexOf('const verifiedB4=verifyNativeUnmappedLda({');
  const failIdx=js.indexOf("R36_B5_NATIVE_B4_POLICY_GATE_NOT_PASSED");
  const planIdx=js.indexOf('const plan=planPostLdaCandidates(rom,rows,sync,verifiedB4)');
  assert.ok(proofIdx>=0&&failIdx>proofIdx&&planIdx>failIdx);
  assert.doesNotMatch(js,/Only provisional here|provisional B4/);
});
