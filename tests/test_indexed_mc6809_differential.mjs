import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {VECTORS,checkManifest,compareIndexed}
  from '../scripts/compare-indexed-mc6809.mjs';
import {initialState,readRegisters} from '../scripts/compare-mc6809.mjs';

const PIN='5bad24375961418d6591491929aea1f4dc8cb90f';
const seed=0x13572468,stack=0x1000,index=0x200,sourceRts=0x623b;
function fixture(){
  const input=initialState('0x6239',{seed,stack});
  for(const offset of [18,20,22]){
    input.registers[offset]=index>>>8;
    input.registers[offset+1]=index&255;
  }
  const generated={pc:sourceRts,steps:3,memory:input.memory.slice(),
    registers:input.registers.slice(),ioTrace:[]};
  const native={schema:'gng.mc6809-oracle.v1',provider:'elmerucr/mc6809',
    provider_commit:PIN,entry:'0x6239',seed,stack,index_initial:index,
    return_address:0x7000,source_rts:sourceRts,steps:3,
    registers:{...readRegisters(generated.registers),PC:0x7000},
    ramChanges:[],ioTrace:[]};
  return {input,generated,native,spec:{seed,stack,index}};
}
test('indexed suite supplies 54 distinct experimental contract states',()=>{
  assert.equal(VECTORS.length,54);
  assert.equal(new Set(VECTORS.map(x=>x.name)).size,54);
  assert.deepEqual(new Set(VECTORS.map(x=>x.stack)),
    new Set([0x100,0x1000,0x2ffc]));
  assert.deepEqual(new Set(VECTORS.map(x=>x.index)),
    new Set([0x100,0x200,0x2ffc]));
  assert.ok(VECTORS.some(x=>x.seed===0));
  assert.ok(VECTORS.some(x=>x.seed===0xffffffff));
});
test('independent native comparison shape accepts matching synthetic fields',()=>{
  const f=fixture();
  assert.deepEqual(compareIndexed(f.spec,f.input,f.generated,f.native,sourceRts),[]);
});
test('CC, X, S, RTS, native PC and native trace mismatches are detected',()=>{
  const f=fixture();
  f.native.registers.CC^=1;
  f.native.registers.X++;
  f.native.registers.S+=2;
  f.native.registers.PC=0x7011;
  f.native.source_rts=0x623c;
  f.native.ioTrace=[{kind:'write',addr:0x3000}];
  const changed=compareIndexed(f.spec,f.input,f.generated,f.native,sourceRts)
    .map(x=>x.field);
  for(const key of ['register.CC','register.X','register.S',
    'oracle.registers.PC','oracle.source_rts','MMIO trace'])
    assert.ok(changed.includes(key),key);
});
test('unexpected RAM write or forbidden output ROM mutation is detected',()=>{
  const f=fixture();
  f.generated.memory[0x80]^=255;
  f.generated.memory[0x6000]^=255;
  const changed=compareIndexed(f.spec,f.input,f.generated,f.native,sourceRts)
    .map(x=>x.field);
  assert.ok(changed.includes('RAM or stack delta'));
  assert.ok(changed.includes('Unexpected MMIO/ROM output memory mutation'));
});
test('manifest must match ROM, generated contract, index count and verified RTS',()=>{
  const image=Buffer.alloc(65536);
  image[sourceRts]=0x39;
  const sha=createHash('sha256').update(image).digest('hex');
  const folder='/tmp/indexed-fixture';
  const m={schema:'gng.indexed-pcode-experiment.v1',
    status:'EXPERIMENTAL_INDEXED_JS_NOT_NATIVE_EQUIVALENCE',
    native_equivalence_verified:false,
    actual_game_entry_conditions_proven:false,
    pure_unconditional_codegen_eligibility_changed:false,
    rom_sha256:sha,blocked:[],
    generated:[{entry:'0x6239',
      javascript:folder+'/indexed_6239.mjs',
      sha256:'a'.repeat(64),native_equivalence_verified:false,
      runtime_per_memory_access_guards:true,input_state_copied:true,
      memory_sites:12,conditionally_bounded:10,
      index_registers:['X'],
      indexed_memory_sites:[
        {pc:'0x6239',op:'LOAD',register:'X',width:1},
        {pc:'0x623a',op:'LOAD',register:'X',width:1}],
      source_rts:'0x623b'}]};
  assert.equal(checkManifest(m,image,folder).sourceRts,sourceRts);
  const modified=Buffer.from(image);
  modified[sourceRts]=0x12;
  assert.throws(()=>checkManifest(m,modified,folder));
  assert.throws(()=>checkManifest({...m,rom_sha256:'0'.repeat(64)},image,folder),
    /ROM digest/);
  assert.throws(()=>checkManifest({...m,generated:[{
    ...m.generated[0],indexed_memory_sites:[m.generated[0].indexed_memory_sites[0]]
  }]},image,folder));
  assert.throws(()=>checkManifest({...m,generated:[{
    ...m.generated[0],index_registers:['DP']
  }]},image,folder));
});
