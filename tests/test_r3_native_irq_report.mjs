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
  assert.equal(x.reset_interrupted_sync_waits,1);
  assert.equal(x.target_sync_exit_events,1);
  assert.equal(x.masked_sync_wakes_with_direct_asserted_line,1);
  assert.equal(x.events[0].epoch,1);
  assert.equal(x.events[0].resume_pc,'0x6017');
  assert.equal(x.events[0].direct_line_event_correlated,true);
  assert.equal(x.events[0].masked_wake_observed,true);
  assert.deepEqual(x.events[0].line_assertions_since_sync_entry,['IRQ']);
  assert.equal(x.instrumented_binary_hash_verified,false);
  assert.equal(x.compiled_js_irq_equivalence_verified,false);
  assert.equal(x.full_bus_equivalence_verified,false);
  assert.equal(x.events[0].cpu_cold_reset_proven,false);
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
    /R35_NATIVE_CPU_CYCLES_DECREASED_WITHIN_RESET_EPOCH/);
});
test('all native event kinds require an observed CPU reset epoch',()=>{
  for(const event of [
    prefix('SYNC_ENTER','6016','50','1'),
    prefix('SYNC_EXIT','6017','50','1','0','0','1'),
    prefix('LINE_DELIVERED','IRQ','1','6017','50','1'),
    prefix('IRQ_ENTRY','IRQ','6017','50','1'),
    prefix('VECTOR_FETCH','FFF8','6200','1')
  ])assert.throws(()=>classifyNativeSyncLog(event),
    /R35_NATIVE_EVENT_BEFORE_CPU_RESET/);
});
test('cycles cannot regress on any nonreset event within an epoch',()=>{
  const start=prefix('CPU_RESET','0')+
    prefix('LINE_DELIVERED','IRQ','0','6000','50','20');
  for(const event of [
    prefix('SYNC_ENTER','6016','50','19'),
    prefix('SYNC_EXIT','6017','50','1','0','0','19'),
    prefix('LINE_DELIVERED','IRQ','1','6017','50','19'),
    prefix('IRQ_ENTRY','IRQ','6017','50','19'),
    prefix('VECTOR_FETCH','FFF8','6200','19')
  ])assert.throws(()=>classifyNativeSyncLog(start+event),
    /R35_NATIVE_CPU_CYCLES_DECREASED_WITHIN_RESET_EPOCH/);
  assert.throws(()=>classifyNativeSyncLog(prefix('CPU_RESET','20')+
    prefix('LINE_DELIVERED','IRQ','0','6000','50','19')),
    /R35_NATIVE_CPU_CYCLES_DECREASED_WITHIN_RESET_EPOCH/);
});
test('a new reset may restart cycles and cancels the previous wait',()=>{
  const raw=[
    prefix('CPU_RESET','1000'),
    prefix('SYNC_ENTER','6016','50','1001'),
    prefix('LINE_DELIVERED','IRQ','1','6017','50','1002'),
    prefix('CPU_RESET','0'),
    prefix('SYNC_ENTER','6016','50','1'),
    prefix('LINE_DELIVERED','IRQ','1','6017','50','2'),
    prefix('SYNC_EXIT','6017','50','1','0','0','3')
  ].join('');
  const x=classifyNativeSyncLog(raw);
  assert.equal(x.masked_sync_wakes_with_direct_asserted_line,1);
  assert.equal(x.reset_interrupted_sync_waits,1);
  assert.equal(x.events[0].epoch,1);
});
test('same-cycle ordered markers are valid within a reset epoch',()=>{
  const raw=maskedFixture()
    .replace(prefix('LINE_DELIVERED','IRQ','1','6017','50','202'),
      prefix('LINE_DELIVERED','IRQ','1','6017','50','200'))
    .replace(prefix('SYNC_EXIT','6017','50','1','0','0','204'),
      prefix('SYNC_EXIT','6017','50','1','0','0','200'));
  assert.equal(classifyNativeSyncLog(raw).masked_sync_wakes_with_direct_asserted_line,1);
});
test('nested SYNC entries cannot replace the original pending wait',()=>{
  for(const pc of ['6016','7000']){
    const raw=prefix('CPU_RESET','0')+
      prefix('SYNC_ENTER','6016','50','1')+
      prefix('SYNC_ENTER',pc,'50','2');
    assert.throws(()=>classifyNativeSyncLog(raw),/R35_NATIVE_NESTED_SYNC_ENTER/);
  }
});
test('orphan and duplicate SYNC exits reject, including after reset cancellation',()=>{
  const exit=prefix('SYNC_EXIT','6017','50','1','0','0','205');
  for(const raw of [
    prefix('CPU_RESET','0')+exit,
    maskedFixture()+exit,
    prefix('CPU_RESET','0')+prefix('SYNC_ENTER','6016','50','1')+
      prefix('CPU_RESET','2')+exit
  ])assert.throws(()=>classifyNativeSyncLog(raw),/R35_NATIVE_SYNC_EXIT_WITHOUT_ENTRY/);
});
test('an unfinished wait requires an exit or an explicit reset cancellation',()=>{
  const raw=prefix('CPU_RESET','0')+prefix('SYNC_ENTER','6016','50','1');
  assert.throws(()=>classifyNativeSyncLog(raw),
    /R35_NATIVE_SYNC_ENTRY_WITHOUT_EXIT_OR_RESET/);
  const x=classifyNativeSyncLog(raw+prefix('CPU_RESET','0'));
  assert.equal(x.reset_interrupted_sync_waits,1);
  assert.equal(x.sync_exit_events,0);
  assert.equal(x.status,'NATIVE_SYNC_WAKE_NOT_CORRELATED');
});
test('assertions before entry or across a reset cannot cause a later correlated wake',()=>{
  const enter=prefix('SYNC_ENTER','6016','50','10');
  const assertion=prefix('LINE_DELIVERED','IRQ','1','6017','50','11');
  const exit=prefix('SYNC_EXIT','6017','50','1','0','0','12');
  for(const raw of [
    prefix('CPU_RESET','0')+prefix('LINE_DELIVERED','IRQ','1','6017','50','9')+
      enter+exit,
    prefix('CPU_RESET','0')+enter+assertion+prefix('CPU_RESET','0')+enter+exit
  ]){
    const x=classifyNativeSyncLog(raw);
    assert.equal(x.masked_sync_wakes_with_direct_asserted_line,0);
    assert.deepEqual(x.events[0].line_assertions_since_sync_entry,[]);
  }
});
test('a cleared line loses its candidate assertion until reasserted within the wait',()=>{
  const clear=prefix('LINE_DELIVERED','IRQ','0','6017','50','203');
  const exit=prefix('SYNC_EXIT','6017','50','1','0','0','204');
  const raw=maskedFixture().replace(exit,clear+exit);
  assert.equal(classifyNativeSyncLog(raw).masked_sync_wakes_with_direct_asserted_line,0);
  const reassert=prefix('LINE_DELIVERED','IRQ','1','6017','50','203');
  assert.equal(classifyNativeSyncLog(raw.replace(exit,reassert+exit))
    .masked_sync_wakes_with_direct_asserted_line,1);
});
test('another active unmasked line cannot be ignored when classifying masked wake',()=>{
  for(const [cc,firq,nmi] of [['50','0','1'],['10','1','0']]){
    const raw=maskedFixture()
      .replace(prefix('SYNC_ENTER','6016','50','200'),
        prefix('SYNC_ENTER','6016',cc,'200'))
      .replace(prefix('SYNC_EXIT','6017','50','1','0','0','204'),
        prefix('SYNC_EXIT','6017',cc,'1',firq,nmi,'204'));
    const x=classifyNativeSyncLog(raw);
    assert.equal(x.events[0].direct_line_event_correlated,true);
    assert.equal(x.events[0].masked_wake_observed,false);
    assert.equal(x.status,'NATIVE_SYNC_WAKE_NOT_CORRELATED');
  }
});
test('nonboot SYNC waits are paired and counted without certifying the boot wake',()=>{
  const raw=prefix('CPU_RESET','0')+
    prefix('SYNC_ENTER','7000','50','1')+
    prefix('LINE_DELIVERED','IRQ','1','7001','50','2')+
    prefix('SYNC_EXIT','7001','50','1','0','0','3');
  const x=classifyNativeSyncLog(raw);
  assert.equal(x.sync_entry_events,1);
  assert.equal(x.sync_exit_events,1);
  assert.equal(x.target_sync_exit_events,0);
  assert.deepEqual(x.events,[]);
  assert.equal(x.status,'NATIVE_SYNC_WAKE_NOT_CORRELATED');
  assert.throws(()=>classifyNativeSyncLog(raw.replace('SYNC_EXIT\t7001','SYNC_EXIT\t6017')),
    /R35_NATIVE_SYNC_EXIT_WRONG_PC/);
});
test('interrupt entry and vector events cannot precede the corresponding SYNC exit',()=>{
  const start=prefix('CPU_RESET','0')+prefix('SYNC_ENTER','6016','50','1');
  for(const event of [
    prefix('IRQ_ENTRY','IRQ','6017','50','2'),
    prefix('VECTOR_FETCH','FFF8','6200','2')
  ])assert.throws(()=>classifyNativeSyncLog(start+event),
    /R35_NATIVE_INTERRUPT_EVENT_DURING_SYNC_WAIT/);
  const x=classifyNativeSyncLog(maskedFixture()+
    prefix('IRQ_ENTRY','IRQ','6017','50','205')+
    prefix('VECTOR_FETCH','FFF8','6200','206'));
  assert.equal(x.irq_handler_entry_events,1);
  assert.equal(x.vector_fetch_events,1);
  assert.equal(x.events[0].handler_entry_correlated,false);
  assert.equal(x.compiled_js_irq_equivalence_verified,false);
});
