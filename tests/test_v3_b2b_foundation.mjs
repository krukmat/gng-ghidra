import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {compileProgram} from '../src/mc6809_aot.mjs';
import {sha256,rewriteProgram} from '../src/v2_b1_frozen.mjs';
import {foundationSeedShape,attestFoundationSeeds}
  from '../src/v3_b2b_foundation.mjs';

const libUrl=pathToFileURL(resolve('src/mc6809_aot_lib.mjs')).href;
const source=()=>{
  const fixed=new Uint8Array(0x10000);
  fixed.set([0x12,0x20,0xfd],0x6000); // NOP/BRA $6000
  fixed[0x7000]=0x3b; // RTI
  fixed[0xfffe]=0x60; fixed[0xffff]=0;
  fixed[0xfff8]=0x70; fixed[0xfff9]=0;
  const code={fixed,banks:new Uint8Array(0xa000),ramOverlays:[]};
  const bases=[{bank:null,pc:0x6000},{bank:null,pc:0x7000}];
  const compiled=compileProgram(code,bases,{libUrl});
  const manifest={blocks:compiled.blockCount,
    files:{'program.mjs':sha256(rewriteProgram(compiled.source))}};
  return {code,manifest};
};
test('historic B2A fixed seeds may carry ignored bank metadata',()=>{
  const {code,manifest}=source();
  const raw=[{bank:2,pc:0x6000,overlay:null}];
  assert.equal(foundationSeedShape(raw[0],code),true);
  const proof=attestFoundationSeeds({raw,code,manifest,compileProgram,libUrl});
  assert.equal(proof.count,manifest.blocks);
  assert.equal(proof.seedCount,1);
  assert.equal(proof.sha256,manifest.files['program.mjs']);
});
test('ignored legacy tuples do not weaken equality to frozen AOT',()=>{
  const {code,manifest}=source();
  const raw=[{bank:null,pc:0x3500,overlay:null}];
  assert.equal(foundationSeedShape(raw[0],code),true);
  const proof=attestFoundationSeeds({raw,code,manifest,compileProgram,libUrl});
  assert.equal(proof.count,manifest.blocks);
});
test('a historical seed containing extra reachable code cannot forge B2A',()=>{
  const {code,manifest}=source();
  code.fixed.set([0x12,0x20,0xfd],0x8000);
  assert.throws(()=>attestFoundationSeeds({raw:[{bank:null,pc:0x8000}],
    code,manifest,compileProgram,libUrl}),/FOUNDATION_AOT_MISMATCH/);
});
test('frozen program digest is authoritative, not only block count',()=>{
  const {code,manifest}=source();
  manifest.files['program.mjs']='0'.repeat(64);
  assert.throws(()=>attestFoundationSeeds({raw:[{bank:null,pc:0x6000}],
    code,manifest,compileProgram,libUrl}),/FOUNDATION_AOT_MISMATCH/);
});
test('malformed, forged, out-of-range seeds remain rejected',()=>{
  const {code,manifest}=source();
  for(const raw of [
    [{bank:-1,pc:0x6000}], [{bank:5,pc:0x6000}],
    [{bank:null,pc:-1}], [{bank:null,pc:65536}],
    [{bank:null,pc:0x6000,overlay:0}],
    [{pc:0x6000}], [null],[42],[],{}]){
    assert.throws(()=>attestFoundationSeeds({raw,code,manifest,
      compileProgram,libUrl}),/FOUNDATION_SEEDS_SHAPE_INVALID/);
  }
});
test('RAM overlay reference validates local overlay extent',()=>{
  const {code,manifest}=source();
  code.ramOverlays=[{start:0x100,bytes:Uint8Array.from([0x12])}];
  assert.equal(foundationSeedShape({bank:null,pc:0x100,overlay:0},code),true);
  assert.equal(foundationSeedShape({bank:null,pc:0x100,overlay:1},code),false);
  assert.throws(()=>attestFoundationSeeds({raw:[{bank:null,pc:0x100,overlay:0}],
    code,manifest,compileProgram,libUrl}),/FOUNDATION_AOT_MISMATCH/);
});
