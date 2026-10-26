import {test} from 'node:test';
import assert from 'node:assert/strict';
import {blockKey as runtimeKey,RAM_KEY} from '../src/gngb_block_key.mjs';
import {blockKey as compilerKey} from '../src/mc6809_aot.mjs';
import {readFileSync} from 'node:fs';

test('AOT codegen and runtime agree on block identity',()=>{
  for(const b of [null,0,1,2,3,4])
    for(const p of [0,0x200,0x3fff,0x4000,0x5fff,0x6000,0xffff]){
      assert.equal(runtimeKey(b,p),compilerKey(b,p));
      assert.equal(runtimeKey(b,p,0),RAM_KEY+p);
      assert.equal(runtimeKey(b,p,2),RAM_KEY+2*0x10000+p);
    }
});
test('runtime dependency graph never statically imports compiler',()=>{
  const src=readFileSync(new URL('../src/gngb_runtime.mjs',import.meta.url),'utf8');
  const key=readFileSync(new URL('../src/gngb_block_key.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(src,/from\s+['"]\.\/mc6809_aot\.mjs['"]/);
  assert.doesNotMatch(key,/\bimport\s/);
  assert.match(src,/from '\.\/gngb_block_key\.mjs'/);
});
