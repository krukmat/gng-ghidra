import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {compileProgram} from '../src/mc6809_aot.mjs';
import {createBoard,GngbRuntimeError} from '../src/gngb_runtime.mjs';
import * as L from '../src/mc6809_aot_lib.mjs';

const ROOT=resolve(fileURLToPath(import.meta.url),'../..');
const libUrl=pathToFileURL(join(ROOT,'src/mc6809_aot_lib.mjs')).href;
let n=0;

// Synthetic ROM-free program: bytes at 0x6000, reset and IRQ vectors.
async function boot(program,{irq=[0x3b],frames=2,overlays=[]}={}){
  const fixed=new Uint8Array(0x10000);
  fixed.set(program,0x6000);
  fixed.set(irq,0x7000);
  fixed[0xfffe]=0x60;fixed[0xffff]=0x00;
  fixed[0xfff8]=0x70;fixed[0xfff9]=0x00;
  const code={fixed,banks:new Uint8Array(5*0x2000),ramOverlays:overlays};
  const seeds=[{bank:null,pc:0x6000},{bank:null,pc:0x7000},
    ...overlays.map((o,i)=>({bank:null,pc:o.start,overlay:i}))];
  const {source}=compileProgram(code,seeds,{libUrl});
  const dir=mkdtempSync(join(tmpdir(),'r35t5-'));
  const file=join(dir,`p${n++}.mjs`);
  writeFileSync(file,source);
  const {blocks}=await import(pathToFileURL(file).href);
  const board=createBoard(code,blocks,{frames});
  return board;
}

test('reset vector fetch at cycle 3 and first instruction at cycle 4', async () => {
  // NOP; SYNC (line not asserted: waits until the first VBLANK)
  const b=await boot([0x12,0x13,0x20,0xfe],{frames:1});
  assert.equal(b.run().status,'FRAMES_DONE');
  const ev=b.state.events;
  assert.deepEqual(ev[0],['CPU_RESET',0]);
  assert.deepEqual(ev[1],['VECTOR_FETCH',0xfffe,0x6000,3]);
  assert.deepEqual(ev[2],['SYNC_ENTER',0x6001,0x50,4+2+2]);
  assert.deepEqual(ev[3],['LINE_DELIVERED','IRQ',1,25151]);
});

test('masked SYNC with the line held exits at once and costs 3 cycles', async () => {
  // SYNC; SYNC; BRA * : the second SYNC sees the held line.
  const b=await boot([0x13,0x13,0x20,0xfe],{frames:2});
  b.run();
  const ev=b.state.events.filter(e=>e[0].startsWith('SYNC'));
  assert.deepEqual(ev[1],['SYNC_EXIT',0x6001,0x50,1,0,0,25151]);
  assert.deepEqual(ev[2],['SYNC_ENTER',0x6001,0x50,25152+2]);
  assert.deepEqual(ev[3],['SYNC_EXIT',0x6002,0x50,1,0,0,25154]);
});

test('IRQ entry takes 19 cycles, pushes 12 bytes and clears HOLD_LINE', async () => {
  // LDS #$1000; ANDCC #$EF; BRA *   IRQ: RTI
  const prog=[0x10,0xce,0x10,0x00,0x1c,0xef,0x20,0xfe];
  const b=await boot(prog,{frames:2});
  // The IRQ pushes A,B,X,Y,U never set by the program: unknown, not zero.
  b.run();
  const $=b.state;
  const entry=$.events.find(e=>e[0]==='IRQ_ENTRY');
  const clear=$.events.find(e=>e[0]==='LINE_DELIVERED'&&e[2]===0);
  const vec=$.events.filter(e=>e[0]==='VECTOR_FETCH')[1];
  assert.equal(clear[3]-entry[4],15);
  assert.equal(vec[3]-entry[4],18);
  assert.equal($.s,0x1000); // RTI with E restored the full frame
});

test('reading RAM never written fails closed instead of reading zero', async () => {
  // LDA $0100
  const b=await boot([0xb6,0x01,0x00,0x20,0xfe]);
  assert.throws(()=>b.run(),e=>e instanceof GngbRuntimeError&&e.code==='R35_T5_UNKNOWN_READ');
});

test('registers MAME reset leaves untouched are unknown', async () => {
  // TFR A,B then STB $0100: B carries A's unknown value; STB fails.
  const b=await boot([0x1f,0x89,0xf7,0x01,0x00,0x20,0xfe]);
  assert.throws(()=>b.run(),e=>e.code==='R35_T5_UNKNOWN_VALUE'&&e.detail.what==='B');
});

test('undocumented opcodes fail closed', async () => {
  const b=await boot([0x3e]);
  assert.throws(()=>b.run(),e=>e.code==='R35_T5_UNSUPPORTED');
});

test('instruction cycles follow the MAME microcode', async () => {
  // LDA #1 (2) STA $0100 (5) LDX #$0100 (3) LDB ,X (4) LEAX 1,X (5)
  // PSHS A,B (7) PULS A,B (7) JSR $6020 (8) ... RTS (5); then SYNC
  const prog=new Array(0x30).fill(0x12);
  prog.splice(0,22,0x10,0xce,0x10,0x00, 0x86,0x01, 0xb7,0x01,0x00, 0x8e,0x01,0x00,
    0xe6,0x84, 0x30,0x01, 0x34,0x06, 0x35,0x06, 0xbd,0x60);
  prog[22]=0x20; prog.splice(23,2,0x13,0x20); prog[25]=0xfe;
  prog[0x20]=0x39;
  const b=await boot(prog,{frames:1});
  b.run();
  const sync=b.state.events.find(e=>e[0]==='SYNC_ENTER');
  // 4 (reset) + LDS 4 + 2+5+3+4+5+7+7+8 + RTS 5 + SYNC fetch+dummy 2
  assert.equal(sync[3],4+4+2+5+3+4+5+7+7+8+5+2);
  assert.equal(b.state.b,1);
});

test('RAM code runs only while RAM holds its ROM bytes', async () => {
  // Copy "BRA *" (20 FE) into RAM at $0200, then JMP $0200.
  const prog=[0x10,0xce,0x10,0x00, 0xcc,0x20,0xfe, 0xfd,0x02,0x00, 0x7e,0x02,0x00];
  const ok=await boot(prog,{frames:1,overlays:[{start:0x200,bytes:Uint8Array.of(0x20,0xfe)}]});
  assert.equal(ok.run().status,'FRAMES_DONE');
  const bad=await boot(prog,{frames:1,overlays:[{start:0x200,bytes:Uint8Array.of(0x20,0xfd)}]});
  assert.equal(bad.run().status,'RAM_CODE_UNMAPPED');
});

test('flag helpers match MAME set_flags', () => {
  const $={cc:0,kcc:0xff,unknown(){throw Error('unknown');}};
  assert.equal(L.add8($,0x7f,0x01),0x80);
  assert.equal($.cc&(L.CC_N|L.CC_V|L.CC_H|L.CC_C|L.CC_Z),L.CC_N|L.CC_V|L.CC_H);
  $.cc=0;assert.equal(L.sub8($,0x00,0x01),0xff);
  assert.equal($.cc&(L.CC_N|L.CC_C|L.CC_V),L.CC_N|L.CC_C);
  $.cc=0;assert.equal(L.daa($,0x0a),0x10);
  $.cc=0;assert.equal(L.neg8($,0x80),0x80);
  assert.equal($.cc&(L.CC_V|L.CC_C),L.CC_V|L.CC_C);
  $.cc=L.CC_C;assert.equal(L.rol8($,0x80),0x01);
  assert.equal($.cc&L.CC_C,L.CC_C);
  const u={cc:0,kcc:0,unknown(w){throw Error('unknown '+w);}};
  assert.throws(()=>L.adc8(u,1,1),/unknown CC/);
});
