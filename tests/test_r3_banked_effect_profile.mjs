import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compileAt,emitStaticModule} from '../scripts/r3_static_trace_probe.mjs';
import {compileNativeBankedPairs} from '../scripts/r3_banked_static_gate.mjs';
import {profileNativeBankedEffects,EFFECT_PROFILE_FAMILIES,EFFECT_PROFILE_REGIONS}
  from '../scripts/r3_banked_effect_profile.mjs';

const cpu=(PC,overrides={})=>({PC,A:0x31,B:0x42,X:0,Y:0,U:0,S:0x2000,
  DP:0,CC:0x50,...overrides});
const generated=async specs=>(await import('data:text/javascript;base64,'+
  Buffer.from(emitStaticModule(specs)).toString('base64'))).compiledStep;

async function fixture({cases=[{bank:0,address:0x0010}],tail=false}={}){
  const fixed=new Uint8Array(65536),packed=new Uint8Array(5*8192);
  // All supported synthetic stores end at the fixed mapping boundary. Their
  // following checkpoint is independent test data, not an oracle-fed runner.
  packed.set([0xa7,0x84],8190);       // bank 0: STA ,X
  packed.set([0xe7,0x84],8192+8190);  // bank 1: STB ,X
  packed[2*8192+8191]=0x3b;         // bank 2: unsupported RTI
  packed[3*8192+8191]=0x12;         // bank 3: NOP
  const runners=new Map();
  for(const bank of [0,1,3]){
    const image=Uint8Array.from(fixed);
    image.set(packed.subarray(bank*8192,(bank+1)*8192),0x4000);
    const spec=compileAt(image,bank===3?0x5fff:0x5ffe,{banked:true});
    runners.set(bank,await generated([spec]));
  }
  const rows=[],witness=[];
  const add=(before,bank,epoch)=>{
    const seq=rows.length,pc=before.PC;
    rows.push({schema:'gng.r2.pre-instruction.v1',origin:'mame-native-tracelog',
      kind:'pre_instruction',seq,pc,before});
    witness.push({seq,pc,bank,epoch});
  };
  for(let i=0;i<cases.length;i++){
    const {bank,address=0,epoch=0}=cases[i];
    const before=cpu(bank>=2?0x5fff:0x5ffe,{X:address});
    add(before,bank,epoch);
    if(tail&&i===cases.length-1)continue;
    const after=bank===2?cpu(0x6000):
      runners.get(bank)(before,()=>{},()=>{});
    add(after,bank,epoch);
  }
  const counts=new Map();
  for(const w of witness){
    if(w.pc>=0x4000&&w.pc<=0x5fff){
      const key=w.bank+':'+w.pc;counts.set(key,(counts.get(key)??0)+1);
    }
  }
  const pairs=[...counts].map(([key,samples])=>{
    const [bank,pc]=key.split(':').map(Number);
    return {bank,pc:'0x'+pc.toString(16).padStart(4,'0'),samples};
  });
  const nativeBankReport={status:'BANK_IDENTITY_AT_EVERY_NATIVE_PRESTATE_VERIFIED',
    native_preinstruction_samples:rows.length,bank_window_pc_samples:cases.length,
    native_banked_prestate_bank_identified:cases.length,
    distinct_observed_bank_pc_pairs:counts.size,
    distinct_bank_window_pcs:new Set(pairs.map(p=>p.pc)).size,
    observed_bank_counts:Object.fromEntries(Array.from({length:5},(_,bank)=>
      [String(bank),pairs.filter(p=>p.bank===bank).reduce((n,p)=>n+p.samples,0)])),
    bank_pc_pairs:pairs,native_per_instruction_mapped_ROM_signature_verified:true};
  const compiled=compileNativeBankedPairs({fixed,packed,rows,witness,nativeBankReport});
  const compiledByBank=new Map();
  for(const [bank,specs] of compiled.byBank)compiledByBank.set(bank,await generated(specs));
  return {rows,witness,compiled,compiledByBank};
}

test('predicts store effects by allowlisted family/region and compares effectful registers',async()=>{
  const cases=[
    {bank:0,address:0x0000},{bank:0,address:0x1e00},
    {bank:0,address:0x2000},{bank:0,address:0x2800},
    {bank:0,address:0x3000},{bank:0,address:0x3800},
    {bank:0,address:0x3b08},{bank:1,address:0x3c00},
    {bank:1,address:0x3e00},{bank:1,address:0x3a00},
    {bank:1,address:0x4000},{bank:1,address:0xffff},
    {bank:2},{bank:3}
  ];
  const x=await fixture({cases});
  const originalRows=structuredClone(x.rows),originalWitness=structuredClone(x.witness);
  const result=profileNativeBankedEffects(x);
  assert.equal(result.native_bank_window_samples,14);
  assert.equal(result.native_samples_with_static_codegen,13);
  assert.equal(result.native_samples_without_static_codegen,1);
  assert.equal(result.matched_register_checkpoints,13);
  assert.equal(result.differing_register_checkpoints,0);
  assert.equal(result.effectful_register_checkpoints_compared,12);
  assert.equal(result.predicted_write_instructions,12);
  assert.equal(result.predicted_byte_writes,12);
  assert.equal(result.predicted_word_write_calls,0);
  assert.deepEqual(result.predicted_byte_writes_by_region,
    Object.fromEntries(EFFECT_PROFILE_REGIONS.map(name=>[name,1])));
  assert.deepEqual(result.families.map(f=>f.opcode_family),
    ['NOP','STA_INDEXED','STB_INDEXED','UNSUPPORTED_BANKED_OPCODE']);
  const sta=result.families.find(f=>f.opcode_family==='STA_INDEXED');
  assert.equal(sta.native_samples,7);
  assert.equal(sta.matched_register_checkpoints,7);
  assert.equal(result.predicted_writes_native_verified,false);
  assert.equal(result.bank_provenance_verified_by_this_diagnostic,false);
  assert.equal(result.autonomous_runtime_or_first_frame_verified,false);
  assert.deepEqual(x.rows,originalRows);assert.deepEqual(x.witness,originalWitness);
});

test('separates effectful register divergence from predicted bus effects',async()=>{
  const x=await fixture();
  x.rows[1].before.CC^=1;
  const result=profileNativeBankedEffects(x);
  assert.equal(result.status,'BANKED_EFFECT_PROFILE_REGISTER_DIVERGENCE');
  assert.equal(result.matched_register_checkpoints,0);
  assert.equal(result.differing_register_checkpoints,1);
  assert.equal(result.predicted_byte_writes,1);
  assert.equal(result.predicted_writes_native_verified,false);
});

test('executes stores for prediction but never compares across reset or past the trace',async()=>{
  const x=await fixture({cases:[{bank:0},{bank:1,epoch:1}],tail:true});
  // Make the first following row an explicit reset prestate; its differing
  // registers cannot be attributed to the preceding generated instruction.
  x.witness[1].epoch=1;
  x.rows[1].before=cpu(0x6000,{A:0xff});
  const result=profileNativeBankedEffects(x);
  assert.equal(result.explicit_epoch_count,2);
  assert.equal(result.cross_reset_checkpoint_boundaries,1);
  assert.equal(result.missing_next_native_checkpoint,1);
  assert.equal(result.matched_register_checkpoints,0);
  assert.equal(result.differing_register_checkpoints,0);
  assert.equal(result.effectful_register_checkpoints_compared,0);
  assert.equal(result.predicted_byte_writes,2);
});

test('unsupported samples are counted and their missing runners are never invoked',async()=>{
  const x=await fixture({cases:[{bank:2}],tail:true});
  const result=profileNativeBankedEffects(x);
  assert.equal(result.native_samples_without_static_codegen,1);
  assert.equal(result.native_samples_with_static_codegen,0);
  assert.equal(result.matched_register_checkpoints,0);
  assert.equal(result.predicted_byte_writes,0);
  assert.equal(result.families[0].executed_samples,0);
});

test('rejects witness gaps, bad epochs and invalid register data before any runner',async()=>{
  for(const mutate of [
    x=>x.witness.pop(),x=>{x.witness[0].seq=1;},
    x=>{x.witness[0].pc++;},x=>{x.witness[0].bank=5;},
    x=>{x.witness[0].epoch=1;},x=>{x.witness[1].epoch=2;},
    x=>{delete x.witness[1].epoch;},x=>{x.rows[1].seq=0;},
    x=>{x.rows[0].before.A=256;},x=>{x.rows[1].before.extra=1;}
  ]){
    const x=await fixture();let calls=0;
    x.compiledByBank.set(0,()=>{calls++;throw Error('PRIVATE CPU VALUE');});
    mutate(x);
    assert.throws(()=>profileNativeBankedEffects(x),/^Error: A064_EFFECT_PROFILE_/);
    assert.equal(calls,0);
  }
});

test('rejects histogram, codegen and runner coverage inflation',async()=>{
  for(const mutate of [
    x=>{x.compiled.bankedSamples++;},
    x=>{x.compiled.counts.set('0:24574',2);},
    x=>{x.compiled.counts.set('4:16384',1);},
    x=>{x.compiled.groups.push(x.compiled.groups[0]);},
    x=>{x.compiled.groups[0].classification='PRIVATE_OPCODE_123';},
    x=>{x.compiled.groups[0].spec.writesRamByte=false;},
    x=>{x.compiled.groups[0].spec.next++;},
    x=>{x.compiled.byBank.set(0,[]);},
    x=>{x.compiledByBank.clear();},
    x=>{x.compiledByBank.set(4,()=>{});}
  ]){
    const x=await fixture();mutate(x);
    assert.throws(()=>profileNativeBankedEffects(x),/^Error: A064_EFFECT_PROFILE_/);
  }
});

test('rejects absent, duplicate, malformed, wrong-width or nonstore runner effects',async()=>{
  const callbacks=[
    (r,w,b)=>r,
    (r,w,b)=>{b(0,1);b(1,2);return r;},
    (r,w,b)=>{b(-1,1);return r;},
    (r,w,b)=>{b(65536,1);return r;},
    (r,w,b)=>{b(0,256);return r;},
    (r,w,b)=>{b(0,1,'private');return r;},
    (r,w,b)=>{w(0x1e00,1);return r;},
    (r,w,b)=>{b(0,1);return {...r,CC:-1};},
    ()=>{throw Error('SECRET PC=0x5ffe A=49');}
  ];
  for(const runner of callbacks){
    const x=await fixture();x.compiledByBank.set(0,runner);
    assert.throws(()=>profileNativeBankedEffects(x),error=>{
      assert.match(error.message,/^A064_EFFECT_PROFILE_[A-Z_]+$/);
      assert.doesNotMatch(error.message,/SECRET|0x|PC=|49|private/);
      return true;
    });
  }
  const x=await fixture({cases:[{bank:3}]});
  x.compiledByBank.set(3,(r,w,b)=>{b(0,0);return r;});
  assert.throws(()=>profileNativeBankedEffects(x),/RUNNER_FAILED/);
  x.compiledByBank.set(3,(r,w,b)=>{
    try{b(0,0);}catch{}
    return {...r,PC:0x6000};
  });
  assert.throws(()=>profileNativeBankedEffects(x),/RUNNER_EFFECT_INVALID/);
});

test('handles word sink as two predicted bytes and one word callback',async()=>{
  // Current authentic banked corpus has no STD_X_POSTINC specialization.
  // This synthetic compile-result shape tests the sink contract for a future
  // verified word-emitting banked specialization without adding native proof.
  const x=await fixture();
  const spec=x.compiled.groups[0].spec;
  Object.assign(spec,{name:'STD_X_POSTINC',writesRamByte:false,writesSpriteWord:true});
  x.compiled.groups[0].classification=spec.name;
  x.rows[0].before.X=0x1e00;
  x.rows[1].before={...x.rows[0].before,PC:0x6000};
  x.compiledByBank.set(0,(r,writeWord)=>{
    writeWord(r.X,(r.A<<8)|r.B);return {...r,PC:0x6000};
  });
  const result=profileNativeBankedEffects(x);
  assert.equal(result.predicted_byte_writes,2);
  assert.equal(result.predicted_word_write_calls,1);
  assert.equal(result.predicted_byte_writes_by_region.SPRITE_RAM,2);
  assert.equal(result.matched_register_checkpoints,1);
  assert.equal(result.predicted_writes_native_verified,false);
});

test('exports only aggregate allowlisted families, regions, counts and booleans',async()=>{
  const x=await fixture({cases:[{bank:0,address:0x1e9f},{bank:1,address:0x3e00},
    {bank:2},{bank:3}]});
  const result=profileNativeBankedEffects(x);
  assert.doesNotMatch(JSON.stringify(result),
    /0x|24574|24575|7839|15872|"PC"|"A"|"B"|"X"|"bank"|"pc"|statement|compiledStep|writeRam/);
  const walk=value=>{
    if(Array.isArray(value)){value.forEach(walk);return;}
    if(value&&typeof value==='object'){
      for(const [key,item] of Object.entries(value)){
        if(key==='opcode_family')assert.ok(EFFECT_PROFILE_FAMILIES.includes(item));
        else if(key==='schema'||key==='status')assert.equal(typeof item,'string');
        else walk(item);
      }
      return;
    }
    assert.ok(typeof value==='boolean'||Number.isSafeInteger(value)&&value>=0);
  };
  walk(result);
});
