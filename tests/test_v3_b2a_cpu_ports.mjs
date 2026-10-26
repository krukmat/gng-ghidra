import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {compileProgram} from '../src/mc6809_aot.mjs';
import {createBoard,PORT_DEFAULTS,CYCLES_PER_FRAME} from '../src/gngb_runtime.mjs';
import {defineInputSchedule,readScheduledPort} from '../src/gngb_input_contract.mjs';

const ROOT=resolve(fileURLToPath(import.meta.url),'../..');
const libUrl=pathToFileURL(join(ROOT,'src/mc6809_aot_lib.mjs')).href;
let counter=0;
async function synthetic(program,{frames=1,events=[],schedule=null,portRead,observer}={}){
  const fixed=new Uint8Array(0x10000);
  fixed.set(program,0x6000);
  fixed.set([0x3b],0x7000); // RTI IRQ
  fixed[0xfffe]=0x60;fixed[0xffff]=0;
  fixed[0xfff8]=0x70;fixed[0xfff9]=0;
  const code={fixed,banks:new Uint8Array(0xa000),ramOverlays:[]};
  const built=compileProgram(code,[{bank:null,pc:0x6000},{bank:null,pc:0x7000}],{libUrl});
  const tmp=mkdtempSync(join(tmpdir(),'v3b2a-'));
  const path=join(tmp,'program'+counter++ +'.mjs');
  writeFileSync(path,built.source);
  const {blocks}=await import(pathToFileURL(path).href);
  const trace=[];
  const opts={frames};
  if(portRead!==undefined)opts.portRead=portRead;
  else if(schedule!==null)opts.portRead=(a,cycle)=>readScheduledPort(schedule,a,cycle);
  if(observer)opts.onPortRead=r=>{trace.push(r);observer(r);};
  else if(schedule!==null||portRead!==undefined)
    opts.onPortRead=r=>{if(trace.length<200)trace.push(r);};
  const board=createBoard(code,blocks,opts);
  return {board,trace,compiled:built.source,cleanup:()=>rmSync(tmp,{recursive:true,force:true})};
}
const loadSystem=[0xb6,0x30,0x00,0xb7,0x01,0x00,0x20,0xfe];
const load16=[0xfc,0x30,0x00,0xfd,0x01,0x00,0x20,0xfe];

test('T2.1: MC6809 AOT emits the actual bus offset for LDA extended',async()=>{
  const run=await synthetic(loadSystem,{schedule:defineInputSchedule()});
  try{
    assert.match(run.compiled,/\$\.rd\(ea,4\)/);
    assert.equal(run.board.run().status,'FRAMES_DONE');
    assert.equal(run.trace.length,1);
    assert.deepEqual(run.trace[0],{addr:0x3000,cycle:8,pc:0x6000,value:0xff});
  }finally{run.cleanup();}
});
test('T2.1: two-byte read samples SYSTEM then P1 on adjacent bus cycles',async()=>{
  const schedule=defineInputSchedule([{cycle:9,control:'p1.right',pressed:true}]);
  const run=await synthetic(load16,{schedule});
  try{
    assert.equal(run.board.run().status,'FRAMES_DONE');
    assert.deepEqual(run.trace.map(r=>[r.addr,r.cycle,r.value]),
      [[0x3000,8,0xff],[0x3001,9,0xfe]]);
    assert.deepEqual([...run.board.state.ramBytes(0x100,2).bytes],[0xff,0xfe]);
  }finally{run.cleanup();}
});
test('T2.2: coin1 takes effect at exact first read, never at instruction fetch',async()=>{
  for(const [press,value] of [[8,0xbf],[9,0xff]]){
    const schedule=defineInputSchedule([{cycle:press,control:'coin1',pressed:true}]);
    const run=await synthetic(loadSystem,{schedule});
    try{
      assert.equal(run.board.run().status,'FRAMES_DONE');
      assert.equal(run.trace[0].cycle,8);
      assert.equal(run.trace[0].value,value);
      assert.equal(run.board.state.ramBytes(0x100,1).bytes[0],value);
    }finally{run.cleanup();}
  }
});
test('T2.2: no provider maintains original V2 default and no trace',async()=>{
  const run=await synthetic(loadSystem);
  try{
    assert.equal(run.board.run().status,'FRAMES_DONE');
    assert.equal(run.board.state.ramBytes(0x100,1).bytes[0],0xff);
    assert.deepEqual(run.trace,[]);
    assert.deepEqual(PORT_DEFAULTS,[0xff,0xff,0xff,0xdf,0xfb]);
  }finally{run.cleanup();}
});
test('T2.3: input port value and malformed callbacks fail closed',async()=>{
  for(const value of [null,-1,256,1.25,'255',NaN]){
    const run=await synthetic(loadSystem,{portRead:()=>value});
    try{assert.throws(()=>run.board.run(),/V3_B2A_PORT_VALUE_INVALID/);}
    finally{run.cleanup();}
  }
  const run=await synthetic(loadSystem,{portRead:()=>0xff});
  try{assert.throws(()=>run.board.state.rd(0x3000),/V3_B2A_READ_CYCLE_OFFSET_MISSING/);}
  finally{run.cleanup();}
  assert.throws(()=>createBoard({},new Map(),{frames:1,portRead:42}),/V3_B2A_INVALID_PORT_READER/);
  assert.throws(()=>createBoard({},new Map(),{frames:1,onPortRead:42}),/V3_B2A_INVALID_PORT_OBSERVER/);
});
test('T2.3: same-cycle order is canonical and event release persists across VBlank',()=>{
  const a=defineInputSchedule([
    {cycle:25150,control:'coin1',pressed:true},
    {cycle:25152,control:'coin1',pressed:false},
    {cycle:25152,control:'start1',pressed:true}]);
  assert.equal(readScheduledPort(a,0x3000,25151),0xbf);
  assert.equal(readScheduledPort(a,0x3000,25152),0xfe);
  assert.equal(readScheduledPort(a,0x3000,25153),0xfe);
  assert.equal(CYCLES_PER_FRAME,25152);
});
test('T2.3: DIP bytes remain fixed in the board even when input provider is injected',async()=>{
  // LDD $3003 -> stores original DSW1/DSW2, not gameplay events.
  const program=[0xfc,0x30,0x03,0xfd,0x01,0x00,0x20,0xfe];
  // CPU V3 DIPs remain legacy constants until separate configuration gate.
  const run=await synthetic(program,{schedule:defineInputSchedule([{cycle:0,control:'coin1',pressed:true}])});
  try{
    assert.equal(run.board.run().status,'FRAMES_DONE');
    assert.deepEqual([...run.board.state.ramBytes(0x100,2).bytes],[0xdf,0xfb]);
    assert.equal(run.trace.length,0);
  }finally{run.cleanup();}
});
