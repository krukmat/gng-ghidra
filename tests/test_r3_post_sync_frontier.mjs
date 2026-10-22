import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inspectPostSync} from '../scripts/r3_post_sync_frontier.mjs';

function romFixture(){
  const rom=new Uint8Array(65536);
  rom[0xfffe]=0x60;rom[0xffff]=0;
  rom.set([0x86,0x7f,0x34,0x04],0x6017); // LDA #127 then PSHS A
  return rom;
}
function row(pc,seq){
  return {schema:'gng.r2.pre-instruction.v1',
    kind:'pre_instruction',origin:'mame-native-tracelog',
    seq,pc,before:{PC:pc,A:0,B:0,X:0,Y:0,U:0,S:0,DP:0,CC:0x50}};
}
function rows(){
  return [row(0x6016,0),row(0x6000,1),row(0x6016,2),
    row(0x6017,3),row(0x6019,4),row(0x6200,5)];
}
function proof(){
  return {status:'SYNC_BYTE_AND_WAIT_BARRIER_PREPARED',
    boundary_prestate_count:2,epochs:[
      {sync_prestate_seq:0,next_debugger_pc:'0x6000'},
      {sync_prestate_seq:2,next_debugger_pc:'0x6017',
        next_pc_equals_fallthrough:true,
        irq_masked_in_sync_prestate:true,
        firq_masked_in_sync_prestate:true}
    ]};
}
test('post-SYNC audit identifies unsupported PC without pretending resumed JS',()=>{
  const r=inspectPostSync(romFixture(),rows(),proof());
  assert.equal(r.status,'POST_SYNC_OPCODE_FRONTIER_IDENTIFIED');
  assert.equal(r.starting_pc,'0x6017');
  assert.equal(r.start_seq,3);
  assert.equal(r.supported_fixed_rom_prefix,1);
  assert.deepEqual(r.first_unsupported,{
    pc:'0x6019',supported:false,family:'PSHS',
    effects_on_bus_verified:false,seq:4
  });
  assert.equal(r.wait_to_resume_transition_executed_by_js,false);
  assert.equal(r.cause_of_native_sync_wake_observed,false);
  assert.equal(r.native_cpu_irq_entry_verified,false);
  assert.equal(r.generated_code_after_sync_verified,false);
  assert.equal(r.game_playable,false);
});
test('gate fails without the actual masked native fallthrough',()=>{
  const c=proof();c.epochs[1].next_debugger_pc='0x7000';
  assert.throws(()=>inspectPostSync(romFixture(),rows(),c),
    /NO_GROUNDED_MASKED_FALLTHROUGH/);
  c.epochs[1].next_debugger_pc='0x6017';
  c.epochs[1].irq_masked_in_sync_prestate=false;
  assert.throws(()=>inspectPostSync(romFixture(),rows(),c),
    /NO_GROUNDED_MASKED_FALLTHROUGH/);
});
test('gate rejects forged next PC and corrupt snapshot',()=>{
  const rr=rows();rr[3]=row(0x6020,3);
  assert.throws(()=>inspectPostSync(romFixture(),rr,proof()),
    /BOUNDARY_SEQUENCE_MISSING/);
  const bad=rows();bad[3].before.CC=256;
  assert.throws(()=>inspectPostSync(romFixture(),bad,proof()),
    /INVALID_MC6809_REGISTER_STATE/);
});
test('unknown first instruction is a candidate, never silently skipped',()=>{
  const rom=romFixture();rom[0x6017]=0x35;
  const r=inspectPostSync(rom,rows(),proof());
  assert.equal(r.supported_fixed_rom_prefix,0);
  assert.equal(r.first_unsupported.family,'PULS');
});
test('bounded survey reports no unsupported opcode instead of fabricating a gap',()=>{
  const r=inspectPostSync(romFixture(),rows(),proof(),1);
  assert.equal(r.status,'POST_SYNC_ONLY_SUPPORTED_WINDOW_OBSERVED');
  assert.equal(r.first_unsupported,null);
  assert.equal(r.inspected_instruction_count,1);
});
