import {test} from 'node:test';
import assert from 'node:assert/strict';
import {decodeNativeLog,classifyNativeSyncLog}
  from '../scripts/r3_native_irq_report.mjs';

const M='GNG_R35_NATIVE_V1';
const prefix=(kind,...args)=>M+'\t'+kind+'\t'+args.join('\t')+'\n';
function maskedFixture(){
  return [
    prefix('CPU_RESET','0'),
    prefix('SYNC_ENTER','6016','50','100'),
    prefix('CPU_RESET','101'),
    prefix('SYNC_ENTER','6016','50','200'),
    prefix('LINE_DELIVERED','IRQ','1','6017','50','202'),
    prefix('SYNC_EXIT','6017','50','1','0','0','204')
  ].join('');
}
test('direct native IRQ delivery can be correlated to masked SYNC wake but not full CPU equivalence',()=>{
  const x=classifyNativeSyncLog(maskedFixture());
  assert.equal(x.status,'NATIVE_MASKED_SYNC_WAKE_EVENT_CORRELATED');
  assert.equal(x.cpu_reset_events,2);
  assert.equal(x.sync_entry_events,2);
  assert.equal(x.sync_exit_events,1);
  assert.equal(x.masked_sync_wakes_with_direct_asserted_line,1);
  assert.equal(x.events[0].epoch,1);
  assert.equal(x.events[0].resume_pc,'0x6017');
  assert.equal(x.events[0].direct_line_event_correlated,true);
  assert.equal(x.events[0].masked_wake_observed,true);
  assert.deepEqual(x.events[0].line_assertions_since_sync_entry,['IRQ']);
  assert.equal(x.instrumented_binary_hash_verified,false);
  assert.equal(x.compiled_js_irq_equivalence_verified,false);
  assert.equal(x.game_playable,false);
});
test('post-SYNC fallthrough without direct asserted line NEVER counts as IRQ',()=>{
  const raw=maskedFixture().replace(
    prefix('LINE_DELIVERED','IRQ','1','6017','50','202'),'');
  const x=classifyNativeSyncLog(raw);
  assert.equal(x.status,'NATIVE_SYNC_WAKE_NOT_CORRELATED');
  assert.equal(x.masked_sync_wakes_with_direct_asserted_line,0);
  assert.equal(x.events[0].direct_line_event_correlated,false);
});
test('masked line held without corresponding true exit state cannot pass',()=>{
  const raw=maskedFixture().replace(
    prefix('SYNC_EXIT','6017','50','1','0','0','204'),
    prefix('SYNC_EXIT','6017','50','0','0','0','204'));
  const r=classifyNativeSyncLog(raw);
  assert.equal(r.masked_sync_wakes_with_direct_asserted_line,0);
});
test('unmasked interrupt is not classified as masked wake',()=>{
  const raw=maskedFixture().replace(
    prefix('SYNC_ENTER','6016','50','200'),
    prefix('SYNC_ENTER','6016','40','200'));
  const r=classifyNativeSyncLog(raw);
  assert.equal(r.masked_sync_wakes_with_direct_asserted_line,0);
});
test('malformed native markers and shortened lines reject instead of guessing',()=>{
  for(const raw of [
    '',
    prefix('LINE_DELIVERED','IRQ','true','6017','50','202'),
    prefix('SYNC_EXIT','6017','50','1','0','204'),
    prefix('SYNC_ENTER','6016','zz','200'),
    prefix('VECTOR_FETCH','FFF8','hello','222'),
    prefix('IRQ_ENTRY','INVALID','6017','50','222'),
    prefix('SURROGATE_PASS','1')
  ])assert.throws(()=>decodeNativeLog(raw),/R35_NATIVE_/);
});
test('native source log events can contain a MAME prefix without accepting other logs',()=>{
  const raw=maskedFixture().split('\n').filter(Boolean)
    .map(v=>'MAME instrumentation '+v).join('\n')+'\n';
  const e=decodeNativeLog(raw);
  assert.equal(e.length,6);
  assert.equal(classifyNativeSyncLog(raw).masked_sync_wakes_with_direct_asserted_line,1);
});
test('regressing CPU cycles within one SYNC wait blocks a false native PASS',()=>{
  const raw=maskedFixture().replace(
    prefix('SYNC_EXIT','6017','50','1','0','0','204'),
    prefix('SYNC_EXIT','6017','50','1','0','0','190'));
  assert.throws(()=>classifyNativeSyncLog(raw),
    /R35_NATIVE_CPU_CYCLES_DECREASED_DURING_WAIT/);
});
