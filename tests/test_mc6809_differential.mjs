import assert from 'node:assert/strict';
import {test} from 'node:test';
import {initialState,readRegisters,readNative,compareState}
  from '../scripts/compare-mc6809.mjs';

const entry='0x622c',spec={name:'synthetic',seed:0x13572468,stack:0x200};
const effects=[
 {kind:'read',pc:0x622c,addr:0x3003,size:1,value:0x68},
 {kind:'read',pc:0x6232,addr:0x3004,size:1,value:0x24},
];
function matchingFixture(){
  const input=initialState(entry,spec);
  const registers=input.registers.slice();
  const memory=input.memory.slice();
  // Contract comparison tests use a synthetic matching value set, not CPU
  // outputs. These fixtures are forbidden as equivalence evidence.
  const js={pc:0x6238,steps:7,registers,memory,
    ioTrace:structuredClone(effects)};
  const native={schema:'gng.mc6809-oracle.v1',provider:'elmerucr/mc6809',
    provider_commit:'5bad24375961418d6591491929aea1f4dc8cb90f',
    entry,seed:spec.seed,stack:spec.stack,
    return_address:0x7000,source_rts:0x6238,steps:7,
    registers:{...readRegisters(registers),PC:0x7000},
    ioTrace:structuredClone(effects),ramChanges:[]};
  return {input,js,native};
}
test('contract comparator recognizes matching synthetic JSON shapes',()=>{
  const {input,js,native}=matchingFixture();
  assert.deepEqual(compareState(entry,spec,input,js,native),[]);
});
test('native 6809 output parser ignores upstream diagnostics',()=>{
  const {native}=matchingFixture();
  const raw='[mc6809] resetting cpu\nGNG_NATIVE_BEGIN\n'+JSON.stringify(native)+
    '\nGNG_NATIVE_END\n[mc6809] cleaning up';
  assert.deepEqual(readNative(raw),native);
  assert.throws(()=>readNative('{}'),/markers/);
  assert.throws(()=>readNative(raw+'\nGNG_NATIVE_BEGIN\n{}'),/markers/);
});
test('register CC divergence never passes unnoticed',()=>{
  const {input,js,native}=matchingFixture();
  native.registers.CC^=1;
  const diff=compareState(entry,spec,input,js,native);
  assert.ok(diff.some(x=>x.field==='register.CC'));
});
test('native stack, return address and source RTS are verified',()=>{
  const {input,js,native}=matchingFixture();
  native.registers.S+=2;
  native.registers.PC=0x7010;
  native.source_rts=0x6239;
  const diff=compareState(entry,spec,input,js,native);
  for(const field of ['register.S','native PC','native source RTS'])
    assert.ok(diff.some(x=>x.field===field),field);
});
test('RAM changes and MMIO order are checked',()=>{
  const {input,js,native}=matchingFixture();
  js.memory[0x40]^=0xff;
  js.ioTrace.reverse();
  const diff=compareState(entry,spec,input,js,native);
  assert.ok(diff.some(x=>x.field==='RAM and stack mutations'));
  assert.ok(diff.some(x=>x.field==='ordered MMIO effects'));
});
test('untrusted CPU provider pin is rejected',()=>{
  const {input,js,native}=matchingFixture();
  native.provider_commit='untrusted';
  const diff=compareState(entry,spec,input,js,native);
  assert.ok(diff.some(x=>x.field==='provider pin'));
});
test('generated writes to MMIO buffer never compare successfully',()=>{
  const {input,js,native}=matchingFixture();
  js.memory[0x3003]=input.memory[0x3003]^0xff;
  const diff=compareState(entry,spec,input,js,native);
  assert.ok(diff.some(x=>x.field==='generated MMIO/ROM memory mutation'));
});
