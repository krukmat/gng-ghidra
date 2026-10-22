import {test} from 'node:test';
import assert from 'node:assert/strict';
import {classifyResetAndSync} from '../scripts/r3_sync_reset_causality.mjs';

function nativeBoundary(){
  return {
    status:'SYNC_BYTE_AND_WAIT_BARRIER_PREPARED',
    boundary_prestate_count:2,
    epochs:[
      {epoch:0,sync_pc:'0x6016',sync_prestate_seq:388,
        next_debugger_pc:'0x6000',next_pc_equals_fallthrough:false,
        irq_masked_in_sync_prestate:true,firq_masked_in_sync_prestate:true},
      {epoch:1,sync_pc:'0x6016',sync_prestate_seq:778,
        next_debugger_pc:'0x6017',next_pc_equals_fallthrough:true,
        irq_masked_in_sync_prestate:true,firq_masked_in_sync_prestate:true}
    ]
  };
}
const observation=()=>[
  'PROBE\tr2-mame-capability-v1',
  'DRIVER\tgngb',
  'SPRITE_RAM_TAP_ENABLED\t1',
  'FRAME_SAMPLE\t1\t24598\t0',
  'SOFT_RESET_REQUESTED\t1\t24598',
  'RESET_NOTIFICATION\t0\t24576',
  'FRAME_SAMPLE\t2\t24599\t0',
  'CONTROLLED_SOFT_RESET_REQUESTED\t1',
  'OBSERVED_RESET_COUNT\t1',
  'OBSERVED_FRAME_COUNT\t4',
  'PROBE_END\tframe-limit'
].join('\n')+'\n';

test('reset-separated first epoch is not claimed to be IRQ wake',()=>{
  const x=classifyResetAndSync(nativeBoundary(),observation());
  assert.equal(x.status,'RESET_BOUNDARY_CONFIRMED_MASKED_WAKE_CAUSE_NOT_OBSERVED');
  assert.equal(x.native_reset_notifications,1);
  assert.equal(x.first_epoch.observed_reset_request_before_notification,true);
  assert.equal(x.first_epoch.next_debugger_pc,'0x6000');
  assert.equal(x.first_epoch.irq_assertion_observed,false);
  assert.equal(x.second_epoch.next_debugger_pc,'0x6017');
  assert.equal(x.second_epoch.irq_and_firq_masked,true);
  assert.equal(x.second_epoch.irq_assertion_observed,false);
  assert.equal(x.second_epoch.irq_handler_entry_observed,false);
  assert.equal(x.driver_vblank_line_assertion_directly_observed,false);
  assert.equal(x.post_sync_cpu_or_irq_equivalence_verified,false);
});
test('reset notifier must occur after exactly one request, never before',()=>{
  const obs=observation();
  const wrongOrder=obs.replace(
    'SOFT_RESET_REQUESTED\t1\t24598\nRESET_NOTIFICATION\t0\t24576',
    'RESET_NOTIFICATION\t0\t24576\nSOFT_RESET_REQUESTED\t1\t24598');
  const duplicate=obs.replace('OBSERVED_RESET_COUNT\t1',
    'RESET_NOTIFICATION\t0\t24576\nOBSERVED_RESET_COUNT\t2');
  const missing=obs.replace('RESET_NOTIFICATION\t0\t24576\n','');
  const notControlled=obs.replace('CONTROLLED_SOFT_RESET_REQUESTED\t1',
    'CONTROLLED_SOFT_RESET_REQUESTED\t0');
  for(const text of [wrongOrder,duplicate,missing,notControlled]){
    assert.throws(()=>classifyResetAndSync(nativeBoundary(),text),
      /R3_SYNC_B1_RESET_REQUEST_NOTIFICATION_NOT_CAUSAL/);
  }
});
test('opposite PC sequence cannot be misclassified as verified reset and masked wake',()=>{
  const r=nativeBoundary();
  r.epochs[0].next_debugger_pc='0x6017';
  assert.throws(()=>classifyResetAndSync(r,observation()),
    /R3_SYNC_B1_UNEXPECTED_TWO_EPOCH_DEBUGGER_SEQUENCE/);
});
test('masked IRQ and FIRQ must be grounded in both native SYNC pre-states',()=>{
  const r=nativeBoundary();
  r.epochs[1].irq_masked_in_sync_prestate=false;
  assert.throws(()=>classifyResetAndSync(r,observation()),
    /R3_SYNC_B1_REQUIRES_TWO_MASKED_NATIVE_SYNC_BOUNDARIES/);
});
test('corrupt observation fields cannot silently upgrade IRQ evidence',()=>{
  const t=observation();
  for(const raw of [
    t.replace('SOFT_RESET_REQUESTED\t1\t24598','SOFT_RESET_REQUESTED\tbogus\t24598'),
    t.replace('OBSERVED_RESET_COUNT\t1','OBSERVED_RESET_COUNT\tnan'),
    t.replace('PROBE_END\tframe-limit','PROBE_END\tinterrupted'),
    t.replace('RESET_NOTIFICATION\t0\t24576','RESET_NOTIFICATION\t0\tunavailable')
  ]){
    assert.throws(()=>classifyResetAndSync(nativeBoundary(),raw),/R3_SYNC_B1_/);
  }
});
test('classification exposes no raw registers, private ROM or speculative asserted lines',()=>{
  const x=classifyResetAndSync(nativeBoundary(),observation());
  const output=JSON.stringify(x);
  assert.doesNotMatch(output,/"A"\s*:|"CC"\s*:|255|rom_bytes|irq_assertion_observed":true/);
  assert.equal(x.driver_source_vblank_irq_configured,true);
  assert.equal(x.driver_vblank_line_assertion_directly_observed,false);
});
