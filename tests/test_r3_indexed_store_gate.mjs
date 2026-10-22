import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {compileAt,compileIndexedByteStore,emitStaticModule}
  from '../scripts/r3_static_trace_probe.mjs';
import {inspectIndexedStores,SITES}
  from '../scripts/r3_indexed_store_gate.mjs';

const regs=(PC,{A=0x8f,B=0,CC=0x20,X=0x2000,
  Y=0x2800,U=0,S=0x3000}={})=>
  ({PC,A,B,CC,X,Y,U,S,DP:0});
const row=(seq,before)=>({
  schema:'gng.r2.pre-instruction.v1',
  origin:'mame-native-tracelog',kind:'pre_instruction',
  seq,pc:before.PC,before
});
function rom(){
  const b=new Uint8Array(65536);
  b[0xfffe]=0x60;b[0xffff]=0;
  for(const s of SITES)b.set([s.op,0x80],s.pc);
  return b;
}
const sync=()=>({status:'SYNC_BYTE_AND_WAIT_BARRIER_PREPARED',
  epochs:[{}, {sync_prestate_seq:2,next_debugger_pc:'0x6017'}]});
function rows(){
  return [
    row(0,regs(0x6016)),row(1,regs(0x6000)),
    row(2,regs(0x6016)),row(3,regs(0x6017)),
    row(4,regs(0x6041)),
    row(5,regs(0x6043,{CC:0x28,X:0x2001})),
    row(6,regs(0x6045,{CC:0x24,X:0x2002})),
    row(7,regs(0x6055,{CC:0x21,B:0x41,A:0x20,X:0x2800})),
    row(8,regs(0x6057,{CC:0x21,B:0x41,A:0x20,X:0x2801})),
    row(9,regs(0x6059,{CC:0x21,B:0x41,A:0x20,X:0x2802})),
  ];
}
async function generated(romImage,fn){
  await mkdir('out/r3',{recursive:true});
  const dir=await mkdtemp(resolve('out/r3/a03-indexed-'));
  try{
    const specs=SITES.map(s=>compileAt(romImage,s.pc)).filter(Boolean);
    const src=emitStaticModule(specs);
    assert.doesNotMatch(src,/rom\[r.PC\]|decodeOpcode|opcodeTable/);
    const file=resolve(dir,'private-static-stores.mjs');
    await writeFile(file,src);
    const {compiledStep}=await import(pathToFileURL(file).href);
    return await fn(compiledStep,src);
  }finally{await rm(dir,{recursive:true,force:true});}
}
test('4 native-shape store sites: predicted VRAM writes and register checkpoints, no bus claim',async()=>{
  const image=rom();
  await generated(image,compiledStep=>{
    const report=inspectIndexedStores({
      rom:image,rows:rows(),sync:sync(),compiledStep
    });
    assert.equal(report.status,
      'INDEXED_REGISTER_CHECKPOINTS_MATCHED_BUS_UNVERIFIED');
    assert.equal(report.total_target_site_executions,4);
    assert.equal(report.matching_register_checkpoints,4);
    assert.equal(report.register_divergences,0);
    assert.equal(report.compiled_store_site_count,4);
    assert.deepEqual(report.store_sites.map(x=>x.indexing_mode),
      ['POSTINC1','POSTINC1','POSTINC1','POSTINC1']);
    assert.deepEqual(report.store_sites.map(x=>
      x.predicted_write_counts_by_region.VIDEO_RAM),[1,1,1,1]);
    assert.equal(report.native_cpu_bus_write_events_compared,false);
    assert.equal(report.runtime_memory_board_model_verified,false);
    assert.equal(report.native_irq_sync_or_banked_rom_verified,false);
    assert.equal(report.game_playable,false);
    assert.equal(report.generated_write_addresses_or_values_exported,false);
    assert.doesNotMatch(JSON.stringify(report),/0x2000|0x2800|0x3c00|"A":|"B":/);
  });
});
test('indexed postbyte variants specialize effective address without runtime decoder',async()=>{
  const cases=[
    {post:0x00,mode:'OFFSET5',addr:0x1000,x:0x1000},
    {post:0x1f,mode:'OFFSET5',addr:0x0fff,x:0x1000},
    {post:0x0f,mode:'OFFSET5',addr:0x100f,x:0x1000},
    {post:0x80,mode:'POSTINC1',addr:0x1000,x:0x1001},
    {post:0x81,mode:'POSTINC2',addr:0x1000,x:0x1002},
    {post:0x82,mode:'PREDEC1',addr:0x0fff,x:0x0fff},
    {post:0x83,mode:'PREDEC2',addr:0x0ffe,x:0x0ffe},
    {post:0x84,mode:'ZERO',addr:0x1000,x:0x1000},
    {post:0x85,mode:'B_OFFSET',addr:0x1002,x:0x1000},
    {post:0x86,mode:'A_OFFSET',addr:0x1007,x:0x1000},
    {post:0x8b,mode:'D_OFFSET',addr:0x1702,x:0x1000},
  ];
  for(const [i,mode] of cases.entries()){
    const romImage=rom(),pc=0x6800;
    romImage.set([0xa7,mode.post],pc);
    const spec=compileAt(romImage,pc);
    assert.equal(spec?.index_mode,mode.mode);
    assert.equal(spec?.index_register,'X');
    const bytes=[];
    await mkdir('out/r3',{recursive:true});
    const folder=await mkdtemp(resolve('out/r3/index-mode-'));
    try{
      const path=resolve(folder,'spec.mjs');
      await writeFile(path,emitStaticModule([spec]));
      const {compiledStep}=await import(pathToFileURL(path).href);
      const before=regs(pc,{A:7,B:2,CC:0x21,X:0x1000});
      const out=compiledStep(before,undefined,(address,value)=>{
        bytes.push({address,value});
      });
      assert.deepEqual(bytes,[{address:mode.addr,value:7}]);
      assert.equal(out.X,mode.x);
      assert.equal(out.PC,pc+2);
      assert.equal(out.CC,0x21);
      assert.equal(before.X,0x1000);
    }finally{await rm(folder,{recursive:true,force:true});}
  }
});
test('index register selector generates Y,U,S variants and rejects indirect/variable extra bytes',()=>{
  for(const [post,register] of [
    [0xa0,'Y'],[0xc0,'U'],[0xe0,'S'],
    [0x20,'Y'],[0x40,'U'],[0x60,'S']]){
    const spec=compileIndexedByteStore(0xe7,post);
    assert.equal(spec?.index_register,register);
  }
  for(const post of [0x87,0x88,0x89,0x8c,0x8d,0x8f,
    0x90,0x91,0x94,0x98,0x9f,0xff]){
    assert.equal(compileIndexedByteStore(0xa7,post),null);
  }
  assert.equal(compileIndexedByteStore(0xa6,0x80),null);
});
test('no external byte-write sink means no successful indexed instruction',async()=>{
  await generated(rom(),compiledStep=>{
    assert.throws(()=>compiledStep(regs(0x6041)),/MISSING_RAM_BYTE_SINK/);
    assert.throws(()=>compiledStep(regs(0x6043),()=>{}),/MISSING_RAM_BYTE_SINK/);
  });
});
test('one register mismatch blocks and does not present predicted writes as native',async()=>{
  const image=rom();
  await generated(image,compiledStep=>{
    const bad=rows();bad[9].before.X=0x2803;
    const report=inspectIndexedStores({rom:image,rows:bad,sync:sync(),compiledStep});
    assert.equal(report.status,'BLOCKED_GENERATED_INDEXED_REGISTER_DIVERGENCE');
    assert.equal(report.register_divergences,1);
    assert.equal(report.native_cpu_bus_write_events_compared,false);
  });
});
test('unknown genuine indexed postbyte blocks instead of guessing writes',async()=>{
  const image=rom();image[0x6041+1]=0x90;
  await generated(image,compiledStep=>{
    const report=inspectIndexedStores({rom:image,rows:rows(),
      sync:sync(),compiledStep});
    assert.equal(report.status,'BLOCKED_UNSUPPORTED_REAL_INDEXED_POSTBYTE');
    assert.equal(report.store_sites[0].compilable,false);
    assert.equal(report.native_cpu_bus_write_events_compared,false);
  });
});
test('no fabricated empty coverage or invalid trace can pass the four-site gate',async()=>{
  await generated(rom(),compiledStep=>{
    const only=rows().filter(x=>![0x6041,0x6043].includes(x.pc))
      .map((r,i)=>row(i,r.before));
    assert.throws(()=>inspectIndexedStores({rom:rom(),rows:only,
      sync:sync(),compiledStep}),/A03_NATIVE_FOUR_SITES_INCOMPLETE/);
  });
});
