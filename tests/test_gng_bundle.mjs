import {test} from 'node:test';
import assert from 'node:assert/strict';
import {gngCode} from '../boards/gng/bundle.mjs';
import {createGngCodeView} from '../boards/gng/code-view.mjs';

// ROM-free: the GnG layout inside a rom-migration.bundle.v1 and the code
// view hooks the base discovery uses.
const manifest=overlays=>({schema:'rom-migration.bundle.v1',
  program:{architecture:'mc6809'},meta:{layout:'gng.code-image.v1',overlays}});
const bytes=Uint8Array.from({length:0x1a000},(_,i)=>i&0xff);

test('gngCode rebuilds the code image and its overlays',()=>{
  const code=gngCode(manifest([{start:0x1a00,length:3,offset:0}]),bytes,
    Uint8Array.from([1,2,3]));
  assert.equal(code.fixed.length,0x10000);assert.equal(code.banks.length,0xa000);
  assert.equal(code.banks[0],bytes[0x10000]);
  assert.deepEqual(code.ramOverlays,[{start:0x1a00,bytes:Uint8Array.from([1,2,3])}]);
  assert.throws(()=>gngCode(manifest([]),bytes.subarray(1),new Uint8Array()),/CODE_IMAGE_LENGTH/);
  assert.throws(()=>gngCode(manifest([]),bytes,new Uint8Array(1)),/TRAILING_BYTES/);
  assert.throws(()=>gngCode({...manifest([]),schema:'gng.v2.b1.frozen-aot.v1'},bytes,
    new Uint8Array()),/GNG_BUNDLE_MANIFEST/);
});

test('fixed code reaching the bank window may run in any bank',()=>{
  const view=createGngCodeView(gngCode(manifest([]),bytes,new Uint8Array()));
  const fixed=view.at(0x6000,null),bank=view.at(0x4000,2);
  assert.deepEqual(view.targets({from:fixed,pc:0x4100}).map(x=>x.context),
    ['bank_0','bank_1','bank_2','bank_3','bank_4']);
  assert.deepEqual(view.targets({from:bank,pc:0x4100}).map(x=>x.context),['bank_2']);
  assert.deepEqual(view.targets({from:bank,pc:0x7000}).map(x=>x.context),['main']);
  assert.deepEqual(view.targets({from:fixed,pc:0x2000}),[]);
  assert.deepEqual(view.scanRanges().map(r=>[r.from.context,r.start,r.end]),
    [['main',0x6000,0x10000],...[0,1,2,3,4].map(b=>['bank_'+b,0x4000,0x6000])]);
});
