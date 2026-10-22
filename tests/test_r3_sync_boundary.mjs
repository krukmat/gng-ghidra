import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {compileSyncAt,emitSyncModule,inspectNativeSyncPrestates}
  from '../scripts/r3_sync_boundary.mjs';

function image(){
  const rom=new Uint8Array(65536);
  rom[0xfffe]=0x60;rom[0xffff]=0;
  rom[0x6014]=0x12; // locally supported NOP (not ROM claim)
  rom[0x6016]=0x13; // SYNC, one byte in MAME m6809.lst
  return rom;
}
function snapshot(pc,cc=0x50){
  return {PC:pc,A:0,B:0,X:0,Y:0,U:0,S:0x2000,DP:0,CC:cc};
}
function pretrace(){
  const rows=[];
  function add(pc,cc=0x50){
    const seq=rows.length;
    rows.push({schema:'gng.r2.pre-instruction.v1',
      kind:'pre_instruction',origin:'mame-native-tracelog',
      seq,pc,before:snapshot(pc,cc)});
  }
  for(const boot of [0x6002,0x6000]){
    if(boot===0x6000)add(0x6000);
    for(const pc of [0x6002,0x6005,0x6009])add(pc);
    for(let i=0;i<96;i++)
      for(const pc of [0x600c,0x600e,0x6010,0x6012])add(pc);
    add(0x6014);
    add(0x6016,0x50); // IRQ and FIRQ masked
    add(0x6017,0x50); // synthetic post-wake next debug instruction
    add(0x7000);
  }
  return rows;
}
function proof(){
  return {
    status:'PASS_BOOT_SPRITE_RAM_WRITE_BYTES',
    boot_runs_compared:2,
    compiled_sprite_ram_word_writes:384,
    native_sprite_byte_samples:768,
    actual_mame_sprite_byte_writes_compared:true,
    per_boot:[0,1].map(epoch=>({
      epoch,uniquely_matched:true,
      native_sample_count:384,expected_byte_writes:384,
      unverified_other_native_writes:0
    }))
  };
}
async function moduleFixture(run){
  await mkdir('out/r3',{recursive:true});
  const dir=await mkdtemp(resolve('out/r3/sync-test-'));
  try{
    const src=emitSyncModule(compileSyncAt(image(),0x6016));
    const path=resolve(dir,'generated-sync.mjs');
    await writeFile(path,src);
    const mod=await import(pathToFileURL(path).href);
    return await run(mod,src);
  }finally{await rm(dir,{recursive:true,force:true});}
}
test('only ROM instruction 0x13 at exact 0x6016 is compiled as SYNC',()=>{
  const rom=image();
  assert.equal(compileSyncAt(rom,0x6016).opcode_name,'SYNC');
  assert.equal(compileSyncAt(rom,0x6016).length,1);
  assert.equal(compileSyncAt(rom,0x6015),null);
  rom[0x6016]=0x12;
  assert.equal(compileSyncAt(rom,0x6016),null);
  assert.throws(()=>emitSyncModule({...compileSyncAt(image(),0x6016),
    resume_pc:0x6018}),/UNVERIFIED_SYNC_SPEC/);
});
test('generated SYNC waits and never advances or invents an IRQ',async()=>{
  await moduleFixture(({enterSync,wakeSync},source)=>{
    const before=snapshot(0x6016);
    const waiting=enterSync(before);
    assert.equal(waiting.phase,'SYNC_WAIT');
    assert.equal(waiting.state.PC,0x6017);
    assert.equal(waiting.state.CC,before.CC);
    assert.equal(before.PC,0x6016);
    assert.ok(Object.isFrozen(waiting));
    assert.ok(Object.isFrozen(waiting.state));
    assert.throws(()=>enterSync(snapshot(0x6014)),/SYNC_WRONG_ENTRY_PC/);
    assert.throws(()=>wakeSync(waiting),/SYNC_REQUIRES_ASSERTED_EXTERNAL_LINE/);
    assert.throws(()=>wakeSync(waiting,{line:'IRQ',asserted:false}),
      /SYNC_REQUIRES_ASSERTED_EXTERNAL_LINE/);
    assert.throws(()=>wakeSync(waiting,{line:'TIMER',asserted:true}),
      /SYNC_REQUIRES_ASSERTED_EXTERNAL_LINE/);
    assert.doesNotMatch(source,/switch\s*\(|readOpcode|decodeOpcode|vectorRead|stackPush/);
  });
});
test('masked IRQ and FIRQ wake to fallthrough without interrupt entry',async()=>{
  await moduleFixture(({enterSync,wakeSync})=>{
    for(const line of ['IRQ','FIRQ']){
      const wait=enterSync(snapshot(0x6016,0x50));
      const woke=wakeSync(wait,{line,asserted:true});
      assert.equal(woke.phase,'RUNNABLE_AFTER_MASKED_WAKE');
      assert.equal(woke.state.PC,0x6017);
      assert.equal(woke.state.CC,0x50);
      assert.equal(woke.irq_handler_executed,false);
      assert.equal(woke.irq_stack_or_vector_modeled,false);
      assert.equal(woke.signal_provenance_authenticated,false);
      assert.equal(wait.phase,'SYNC_WAIT');
    }
  });
});
test('unmasked IRQ/FIRQ and NMI defer to explicit interrupt-entry handler',async()=>{
  await moduleFixture(({enterSync,wakeSync})=>{
    for(const [line,cc] of [['IRQ',0x40],['FIRQ',0x10],['NMI',0x50]]){
      const next=wakeSync(enterSync(snapshot(0x6016,cc)),
        {line,asserted:true});
      assert.equal(next.phase,'INTERRUPT_ENTRY_REQUIRED');
      assert.equal(next.state.PC,0x6017);
      assert.equal(next.state.CC,cc);
      assert.equal(next.irq_handler_executed,false);
      assert.equal(next.irq_stack_or_vector_modeled,false);
    }
    assert.throws(()=>wakeSync({phase:'RUNNABLE_AFTER_MASKED_WAKE'},
      {line:'IRQ',asserted:true}),/SYNC_NOT_WAITING/);
  });
});
test('native boundary audit classifies two boot SYNC instructions but NEVER authenticates IRQ',()=>{
  const r=inspectNativeSyncPrestates(image(),pretrace(),proof());
  assert.equal(r.status,'SYNC_BYTE_AND_WAIT_BARRIER_PREPARED');
  assert.equal(r.boundary_prestate_count,2);
  assert.ok(r.epochs.every(x=>
    x.sync_pc==='0x6016'&&x.next_debugger_pc==='0x6017'&&
    x.irq_masked_in_sync_prestate&&x.firq_masked_in_sync_prestate&&
    x.classification==='FALLTHROUGH_OBSERVED_CAUSING_LINE_NOT_CAPTURED'&&
    !x.event_source_verified&&!x.irq_acceptance_verified));
  assert.equal(r.cpu_post_sync_equivalence_verified,false);
  assert.equal(r.irq_or_firq_or_nmi_assertion_observed,false);
  assert.equal(r.interrupt_acceptance_or_stack_verified,false);
});
test('non-fallthrough after SYNC is classified, not promoted to real IRQ evidence',()=>{
  const rows=pretrace();
  for(let i=0;i<rows.length-1;i++){
    if(rows[i].pc===0x6016){
      rows[i+1]={...rows[i+1],pc:0x7000,
        before:snapshot(0x7000)};
    }
  }
  const r=inspectNativeSyncPrestates(image(),rows,proof());
  assert.ok(r.epochs.every(x=>
    x.classification==='NON_FALLTHROUGH_OBSERVED_IRQ_VECTOR_OR_OTHER_CAUSE_UNVERIFIED'));
  assert.equal(r.interrupt_acceptance_or_stack_verified,false);
});
test('missing ROM opcode, incomplete boot proof and forged boundary fail closed',()=>{
  const rom=image();
  rom[0x6016]=0x12;
  assert.throws(()=>inspectNativeSyncPrestates(rom,pretrace(),proof()),
    /R3_SYNC_(FRONTIER_NOT_EXACT|BYTE_13_NOT_CONFIRMED)/);
  const badProof=proof();badProof.actual_mame_sprite_byte_writes_compared=false;
  assert.throws(()=>inspectNativeSyncPrestates(image(),pretrace(),badProof),
    /R3_FRONTIER_MISSING_COMPLETE_NATIVE_BOOT_WRITE_PROOF/);
  const rows=pretrace();
  const index=rows.findIndex(x=>x.pc===0x6016);
  rows[index]={...rows[index],pc:0x6018,before:snapshot(0x6018)};
  assert.throws(()=>inspectNativeSyncPrestates(image(),rows,proof()),
    /R3_FRONTIER_(BOOT_EXITS_DIFFER|BOOT_|UNSUPPORTED_PC)/);
});
