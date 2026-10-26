import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createBoard,CYCLES_PER_FRAME} from '../src/gngb_runtime.mjs';
import {compileProgram} from '../src/mc6809_aot.mjs';
import {writeFileSync,mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';

async function board(period){
 const fixed=new Uint8Array(0x10000);
 fixed.set([0x12,0x13,0x20,0xfe],0x6000);fixed[0x7000]=0x3b;
 fixed[0xfffe]=0x60;fixed[0xffff]=0;
 fixed[0xfff8]=0x70;fixed[0xfff9]=0;
 const code={fixed,banks:new Uint8Array(0xa000),ramOverlays:[]};
 const libUrl=new URL('../src/mc6809_aot_lib.mjs',import.meta.url).href;
 const {source}=compileProgram(code,[{bank:null,pc:0x6000},{bank:null,pc:0x7000}],{libUrl});
 const dir=mkdtempSync(join(tmpdir(),'v2b1-irq-'));
 const file=join(dir,'generated.mjs');writeFileSync(file,source);
 const {blocks}=await import(pathToFileURL(file).href);
 return createBoard(code,blocks,{frames:2,cyclesPerFrame:period});
}
test('IRQ period is fail-closed for invalid values',async()=>{
 const b=await board(CYCLES_PER_FRAME);
 assert.equal(b.run().status,'FRAMES_DONE');
 assert.throws(()=>createBoard({},new Map(),{cyclesPerFrame:0}),/V2_B1_INVALID_IRQ_PERIOD/);
});
test('negative control: +1 cycle IRQ perturbation diverges observably',async()=>{
 const a=await board(CYCLES_PER_FRAME);
 const b=await board(CYCLES_PER_FRAME+1);
 a.run();b.run();
 const relevant=s=>s.events.filter(e=>e[0]==='LINE_DELIVERED').map(e=>e.at(-1));
 assert.notDeepEqual(relevant(a.state),relevant(b.state));
 assert.deepEqual(relevant(a.state).slice(0,1),[25151]);
 assert.deepEqual(relevant(b.state).slice(0,1),[25152]);
});
