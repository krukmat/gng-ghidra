import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {GFX_LAYOUT,frozenCode,packGfx,unpackGfx} from '../src/ao_web_assets.mjs';
import {selectB3Bundle} from '../src/v3_b3_bundle.mjs';
import {loadFrozen} from '../src/v2_b1_frozen.mjs';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');

test('gfx.bin round-trips every region and rejects wrong sizes',()=>{
  const gfx=Object.fromEntries(GFX_LAYOUT.map(([name,size],k)=>
    [name,Uint8Array.from({length:size},(_,i)=>(i*7+k*31)&255)]));
  const packed=packGfx(gfx);
  assert.equal(packed.length,0x3c000);
  assert.deepEqual(unpackGfx(packed),gfx);
  assert.throws(()=>packGfx({...gfx,tiles:new Uint8Array(0x4000)}),/AO_GFX_REGION_INVALID/);
  assert.throws(()=>unpackGfx(packed.subarray(1)),/AO_GFX_LENGTH/);
});

test('frozenCode rejects a bad image and overlay layout',()=>{
  const bytes=new Uint8Array(0x1a000),blob=new Uint8Array(4);
  const manifest={overlays:[{start:0x100,length:4,offset:0}]};
  assert.equal(frozenCode(manifest,bytes,blob).ramOverlays[0].bytes.length,4);
  assert.throws(()=>frozenCode(manifest,bytes.subarray(1),blob),/AO_CODE_IMAGE_LENGTH/);
  assert.throws(()=>frozenCode({overlays:[{start:0x2fff,length:4,offset:0}]},bytes,blob),
    /AO_OVERLAY_MANIFEST_INVALID/);
  assert.throws(()=>frozenCode({overlays:[]},bytes,blob),/AO_OVERLAY_TRAILING_BYTES/);
});

// Private: needs the operator's certified B3 bundle.
const bundle=selectB3Bundle(ROOT);
test('frozenCode rebuilds loadFrozen code from the private bundle',
  {skip:bundle?false:'private B3 bundle missing'},()=>{
    const {manifest,code}=loadFrozen(bundle.dir);
    const read=name=>new Uint8Array(readFileSync(join(bundle.dir,name)));
    assert.deepEqual(frozenCode(manifest,read('code.bin'),read('overlays.bin')),code);
  });
