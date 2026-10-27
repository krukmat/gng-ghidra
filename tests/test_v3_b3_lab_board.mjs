import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {compileProgram} from '../src/mc6809_aot.mjs';
import {labCreateBoard} from '../src/v3_b3_lab_board.mjs';
import {CYCLES_PER_FRAME} from '../src/gngb_runtime.mjs';

const ROOT=resolve(fileURLToPath(import.meta.url),'../..');
const runtimePath=join(ROOT,'src/gngb_runtime.mjs');
const runtimeSha=createHash('sha256').update(readFileSync(runtimePath)).digest('hex');
const libUrl=pathToFileURL(join(ROOT,'src/mc6809_aot_lib.mjs')).href;

async function fixture(onFrame){
  const fixed=new Uint8Array(0x10000);
  // LDS #$1000; LDA #$12; STA $0100; STA palette; STA scroll;
  // STA soundlatch; STA sprite DMA; LDA SYSTEM; STA $0101; INCA;
  // STA $0100; SYNC; BRA back to LDA SYSTEM.
  const program=[0x10,0xce,0x10,0x00,0x86,0x12,0xb7,0x01,0x00,
    0xb7,0x38,0x00,0xb7,0x3b,0x08,0xb7,0x3a,0x00,0xb7,0x3c,0x00,
    0xb6,0x30,0x00,0xb7,0x01,0x01,0x4c,0xb7,0x01,0x00,0x13,
    0x20,0xf3];
  fixed.set(program,0x6000);fixed[0x7000]=0x3b;
  fixed[0xfffe]=0x60;fixed[0xffff]=0x00;
  fixed[0xfff8]=0x70;fixed[0xfff9]=0x00;
  const code={fixed,banks:new Uint8Array(0xa000)};
  const {source}=compileProgram(code,[{bank:null,pc:0x6000},
    {bank:null,pc:0x7000}],{libUrl,entries:true});
  const dir=mkdtempSync(join(tmpdir(),'gng-lab-test-'));
  const programPath=join(dir,'program.mjs');writeFileSync(programPath,source);
  const {blocks}=await import(pathToFileURL(programPath).href);
  let input=0xff;
  const board=await labCreateBoard(runtimePath,runtimeSha,code,blocks,{
    frames:12,portRead:(_addr,cycle)=>cycle>=3*CYCLES_PER_FRAME?input:0xff,
    onFrame:r=>{onFrame(r);
      board.state.records[board.state.records.length-1]=null;}
  });
  return {board,setInput:v=>{input=v;}};
}

const frameHash=r=>createHash('sha256').update(r.record).update(r.known)
  .update(JSON.stringify([r.scroll,r.bank,r.latch,r.sprite_buffer_valid,r.writes]))
  .digest('hex');

test('lab snapshot resumes identical records at several frame boundaries',async()=>{
  const baseline=[];
  const b=await fixture(r=>baseline.push(frameHash(r)));
  assert.equal(b.board.lab.advanceTo(12).status,'FRAMES_DONE');
  assert.equal(baseline.length,12);
  for(const n of [1,2,5,9]){
    const got=[];
    const f=await fixture(r=>got.push(frameHash(r)));
    assert.equal(f.board.lab.advanceTo(n).status,'FRAMES_DONE');
    const checkpoint=f.board.lab.save();
    f.setInput(0xbf);
    assert.equal(f.board.lab.advanceTo(12).status,'FRAMES_DONE');
    f.board.lab.restore(checkpoint);
    f.setInput(0xff);
    got.length=n;
    assert.equal(f.board.lab.advanceTo(12).status,'FRAMES_DONE');
    assert.deepEqual(got,baseline,`snapshot at frame ${n}`);
  }
});

test('lab runtime rejects an unexpected runtime digest',async()=>{
  await assert.rejects(()=>labCreateBoard(runtimePath,'0'.repeat(64),{},new Map()),
    /V3_B3_LAB_RUNTIME_HASH_MISMATCH/);
});
