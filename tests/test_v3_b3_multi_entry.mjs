import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {compileProgram} from '../src/mc6809_aot.mjs';
import {createBoard} from '../src/gngb_runtime.mjs';

const ROOT=resolve(fileURLToPath(import.meta.url),'../..');
const libUrl=pathToFileURL(join(ROOT,'src/mc6809_aot_lib.mjs')).href;
let n=0;

// LDS #$1000; ANDCC #$EF; loop: 21 x NOP; BRA loop.   IRQ: RTI
// The frame slice ends inside the NOP run, so RTI resumes mid-block.
const LOOP=0x6006;
const program=[0x10,0xce,0x10,0x00,0x1c,0xef,...Array(21).fill(0x12),0x20,0xeb];
function image(){
  const fixed=new Uint8Array(0x10000);
  fixed.set(program,0x6000);
  fixed[0x7000]=0x3b;
  fixed[0xfffe]=0x60;fixed[0xffff]=0x00;
  fixed[0xfff8]=0x70;fixed[0xfff9]=0x00;
  return {fixed,banks:new Uint8Array(5*0x2000),ramOverlays:[]};
}
async function load(source){
  const file=join(mkdtempSync(join(tmpdir(),'v3b3me-')),`p${n++}.mjs`);
  writeFileSync(file,source);
  return (await import(pathToFileURL(file).href)).blocks;
}
async function run(seeds,opts){
  const code=image();
  const built=compileProgram(code,seeds,{libUrl,...opts});
  const board=createBoard(code,await load(built.source),{frames:6});
  return {built,board,result:board.run()};
}
const SEEDS=[{bank:null,pc:0x6000},{bank:null,pc:0x7000}];

test('without multi-entry, an IRQ return into a block body halts', async () => {
  const {result}=await run(SEEDS,{});
  assert.equal(result.status,'UNCOMPILED');
  assert.ok(result.pc>LOOP&&result.pc<LOOP+21,'resume point inside the NOP run');
});

test('multi-entry runs exactly like a fresh block at every resume point', async () => {
  const multi=await run(SEEDS,{entries:true});
  assert.equal(multi.result.status,'FRAMES_DONE');
  // Reference: a separately compiled block seeded at every boundary.
  const suffix=[...SEEDS,...Array.from({length:21},(_,i)=>({bank:null,pc:LOOP+i}))];
  const fresh=await run(suffix,{});
  assert.equal(fresh.result.status,'FRAMES_DONE');
  assert.deepEqual(multi.board.state.events,fresh.board.state.events);
  assert.equal(multi.board.state.C,fresh.board.state.C);
  // Every boundary is a key: 24 in 0x6000..0x601b plus the IRQ handler.
  assert.equal(multi.built.blockCount,25);
  assert.ok(multi.built.functions<fresh.built.functions,'aliases, not copies');
});

test('default compilation is unchanged by the option', async () => {
  const code=image();
  const a=compileProgram(code,SEEDS,{libUrl});
  const b=compileProgram(code,SEEDS,{libUrl,entries:false});
  assert.equal(a.source,b.source);
  assert.ok(!a.source.includes('switch('));
  assert.equal(a.blockCount,a.functions);
});
