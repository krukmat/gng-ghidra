import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {compileProgram} from '../src/mc6809_aot.mjs';
import {freezeBundle,loadFrozen,runFrozen,rewriteProgram} from '../src/v2_b1_frozen.mjs';

const ROOT=new URL('../src/',import.meta.url);
const modules=Object.fromEntries(['mc6809_aot_lib.mjs','gngb_runtime.mjs','gngb_block_key.mjs']
  .map(n=>[n,readFileSync(new URL(n,ROOT),'utf8')]));
const origin=pathToFileURL(new URL('mc6809_aot_lib.mjs',ROOT).pathname).href;
async function synthetic(program=[0x12,0x13,0x20,0xfe],frames=2){
  const fixed=new Uint8Array(0x10000);
  fixed.set(program,0x6000);
  fixed[0x7000]=0x3b;
  fixed[0xfffe]=0x60;fixed[0xffff]=0;
  fixed[0xfff8]=0x70;fixed[0xfff9]=0;
  const code={fixed,banks:new Uint8Array(0xa000),ramOverlays:[]};
  const generated=compileProgram(code,[{bank:null,pc:0x6000},{bank:null,pc:0x7000}],
                                 {libUrl:origin});
  const dir=join(mkdtempSync(join(tmpdir(),'gng-v2b1-')),'frozen');
  freezeBundle(dir,{generated:generated.source,code,modules,overlays:[],
    provenance:{frames,blocks:generated.blockCount}});
  return {dir,generated};
}

test('frozen bundle runs without zip, ROM loader or AOT compiler',async()=>{
  const {dir,generated}=await synthetic();
  const manifest=loadFrozen(dir).manifest;
  assert.equal(manifest.blocks,generated.blockCount);
  assert.equal(manifest.frames,2);
  const src=readFileSync(join(dir,'program.mjs'),'utf8');
  assert.match(src,/from "\.\/mc6809_aot_lib\.mjs"/);
  assert.doesNotMatch(src,/file:\/\/|compileProgram|gngbCodeImage/);
  const run=await runFrozen(dir);
  assert.equal(run.status,'FRAMES_DONE');
  assert.equal(run.frames,2);
  assert.equal(run.frame_hashes.length,2);
  assert.equal(run.first_fully_known,null);
  assert.equal(run.first_renderer_known,null);
  assert.deepEqual(run.frame_hashes,(await runFrozen(dir)).frame_hashes);
});

test('bundle integrity fails closed on binary tampering',async()=>{
  const {dir}=await synthetic();
  const {writeFileSync}=await import('node:fs');
  const p=join(dir,'code.bin');const raw=readFileSync(p);
  raw[0x6000]^=1;writeFileSync(p,raw);
  assert.throws(()=>loadFrozen(dir),/V2_B1_ASSET_HASH_MISMATCH/);
});

test('frozen runtime refuses uncompiled jump without discovering new seed',async()=>{
  const {dir}=await synthetic([0x8e,0x61,0x23,0x6e,0x84]); // LDX #$6123; JMP ,X (dynamic)
  await assert.rejects(()=>runFrozen(dir),/V2_B1_INCOMPLETE_OR_UNCOMPILED_UNCOMPILED/);
});
test('build parser refuses generated source without exact library import',()=>{
  assert.throws(()=>rewriteProgram('export const blocks=new Map();'),
                /V2_B1_GENERATED_SOURCE_REQUIRED/);
});
