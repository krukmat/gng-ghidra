import test from 'node:test';
import assert from 'node:assert/strict';
import {parseMainRamWrites,predictMainRamStores,compareMainRamWrites,requireSameRunEnvelope}
  from '../scripts/r3_native_main_ram_write_gate.mjs';
const base={address:3,data:0x42,mask:255};
function tsv(events=[[[3,66,255]],[[4,67,255]]],extra=''){
 let lines=['A063_MAIN_RAM_TAP_ENABLED\t1'];let ordinal=0;
 for(let ep=0;ep<2;ep++){
  if(ep)lines.push('RESET_NOTIFICATION\t1\t0');
  for(const [a,d,m] of events[ep])lines.push(`A063_MAIN_RAM_WRITE\t${ep}\t${++ordinal}\t${a}\t${d}\t${m}`);
 }
 return lines.concat([`A063_MAIN_RAM_WRITE_COUNT\t${ordinal}`,
 'A063_MAIN_RAM_WRITE_TRUNCATED\t0','PROBE_END\tframe-limit',extra]).join('\n');
}
const pred=(ep0=[base],ep1=[{address:4,data:67,mask:255}])=>({epochs:[ep0,ep1],total:ep0.length+ep1.length});
function eq(p=pred(),raw=tsv()){return compareMainRamWrites(p,parseMainRamWrites(raw));}
test('ordered exact match reports NON_CAUSAL, not native certification',()=>{
 const r=eq();assert.equal(r.status,'ORDERED_EXACT_MATCH_ONLY_NOT_INSTRUCTION_CAUSAL');
 assert.equal(r.instruction_causal_link_proven,false);assert.equal(r.native_main_ram_stores_certified,false);
});
test('missing write rejects',()=>assert.match(eq(pred(),tsv([[],[[4,67,255]]])).status,/BLOCKED/));
test('extra unrelated stack write is never assigned to a banked store',()=>{
 const r=eq(pred(),tsv([[[3,66,255],[6,12,255]],[[4,67,255]]]));
 assert.equal(r.status,'INCONCLUSIVE_UNATTRIBUTED_MAIN_RAM_WRITES');assert.equal(r.unattributed_native_writes,1);
});
test('wrong data and order do not pass',()=>{
 assert.match(eq(pred(),tsv([[[3,65,255]],[[4,67,255]]])).status,/BLOCKED/);
 const p=pred([{address:3,data:66,mask:255},{address:4,data:67,mask:255}],[]);
 assert.match(eq(p,tsv([[[4,67,255],[3,66,255]],[]])).status,/BLOCKED/);
});
test('invalid mask and out of range reject',()=>{
 assert.throws(()=>eq(pred(),tsv([[[3,66,127]],[[4,67,255]]])),/MASK/);
 assert.throws(()=>parseMainRamWrites(tsv([[[0x1e00,66,255]],[]])),/RANGE/);
});
test('duplicate or missing marker, truncation and epoch crossing reject',()=>{
 assert.throws(()=>parseMainRamWrites(tsv()+ '\nA063_MAIN_RAM_TAP_ENABLED\t1'),/ENABLED/);
 assert.throws(()=>parseMainRamWrites(tsv().replace('TRUNCATED\t0','TRUNCATED\t1')),/INCOMPLETE/);
 assert.throws(()=>parseMainRamWrites(tsv().replace('A063_MAIN_RAM_WRITE\t1','A063_MAIN_RAM_WRITE\t0')),/EPOCH|SEQUENCE/);
});
test('duplicate equal events cannot establish a unique subsequence',()=>{
 const r=eq(pred(),tsv([[[3,66,255],[3,66,255]],[[4,67,255]]]));
 assert.equal(r.status,'INCONCLUSIVE_NON_UNIQUE_ORDERED_MATCH');
});
test('predictor executes native-prestate codegen and excludes other regions',()=>{
 const make=(seq,pc,epoch)=>({row:{seq,pc,before:{PC:pc}},witness:{seq,pc,bank:0,epoch}});
 const a=make(0,0x4000,0),b=make(1,0x4000,1);
 const compiled={bankedSamples:2,groups:[{bank:0,pc:0x4000,spec:{name:'STA_INDEXED',writesRamByte:true,writesSpriteWord:false}}]};
 const byBank=new Map([[0,(cpu,_word,byte)=>byte(cpu.PC===0x4000?3:4,66)]]);
 const r=predictMainRamStores({rows:[a.row,b.row],witness:[a.witness,b.witness],compiled,compiledByBank:byBank});
 assert.equal(r.total,2);assert.equal(r.epochs[0].length,1);assert.equal(r.epochs[1].length,1);
 assert.throws(()=>predictMainRamStores({rows:[a.row,b.row],witness:[a.witness,{...b.witness,epoch:3}],compiled,compiledByBank:byBank}),/SEQUENCE/);
});
test('same-run envelope fail-closed and rejects mixed runs',()=>{
 const good={manifest:{schema:'gng.a06.private-bank-evidence-manifest.v1',full_oracle_same_run_postflight_verified:true,sha256:Object.fromEntries(Array.from({length:11},(_,i)=>[i,'a'.repeat(64)]))},
 fullOracle:{status:'A063_FULL_NATIVE_BANK_PROVENANCE_PASS',native_bank_per_instruction_full_run_proven:true},
 postflight:'A063_POSTFLIGHT_CHAIN_INTACT_NOT_BANK_PROVENANCE',rolesVerified:11};
 assert.equal(requireSameRunEnvelope(good),true);
 assert.throws(()=>requireSameRunEnvelope({...good,rolesVerified:10}),/SAME_RUN/);
});

test('capture footer is strictly ordered and final',()=>{
  const raw=tsv();
  assert.throws(()=>parseMainRamWrites(raw+'\nFRAME_SAMPLE\t6\t0\t1'),
    /MARKERS_AFTER_PROBE_END/);
  assert.throws(()=>parseMainRamWrites(raw.replace(
    'A063_MAIN_RAM_WRITE_COUNT\t2\nA063_MAIN_RAM_WRITE_TRUNCATED\t0',
    'A063_MAIN_RAM_WRITE_TRUNCATED\t0\nA063_MAIN_RAM_WRITE_COUNT\t2')),
    /TRUNCATION_MARKER_INVALID/);
  assert.throws(()=>parseMainRamWrites(raw.replace('PROBE_END\tframe-limit',
    'PROBE_END\tmachine-stop')),/PROBE_END_ORDER_OR_REASON_INVALID/);
});
test('writes and unrelated markers after summary are rejected',()=>{
  const raw=tsv();
  assert.throws(()=>parseMainRamWrites(raw.replace(
    'A063_MAIN_RAM_WRITE_COUNT\t2',
    'A063_MAIN_RAM_WRITE_COUNT\t2\nA063_MAIN_RAM_WRITE\t1\t3\t5\t70\t255')),
    /WRITE_OUTSIDE_CAPTURE_PHASE/);
  assert.throws(()=>parseMainRamWrites(raw.replace(
    'A063_MAIN_RAM_WRITE_TRUNCATED\t0',
    'A063_MAIN_RAM_WRITE_TRUNCATED\t0\nFRAME_SAMPLE\t6\t0\t1')),
    /UNEXPECTED_MARKER_DURING_SUMMARY/);
});
test('main RAM tap requires valid reset marker and prior opt-in',()=>{
  const raw=tsv();
  assert.throws(()=>parseMainRamWrites(raw.replace(
    'RESET_NOTIFICATION\t1\t0','RESET_NOTIFICATION\t1')),
    /RESET_MARKER_ORDER_INVALID/);
  assert.throws(()=>parseMainRamWrites(raw.replace(
    'A063_MAIN_RAM_TAP_ENABLED\t1\n','')),
    /WRITE_OUTSIDE_CAPTURE_PHASE|RESET_MARKER_ORDER_INVALID/);
});
