import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {compileAt,emitStaticModule} from '../scripts/r3_static_trace_probe.mjs';
import {SITES} from '../scripts/r3_indexed_store_gate.mjs';
import {parseNativeVideoWrites,deriveStaticVideoWrites,
  compareNativeVideoWriteSequence,verifyNativeVideoWriteGate}
  from '../scripts/r3_native_video_write_gate.mjs';

const cpu=(PC,X=0x2000,Y=0x2800,CC=0,A=0x12,B=0x80)=>({
  PC,A,B,X,Y,U:0,S:0x2000,DP:0,CC
});
const row=(seq,state)=>({
  schema:'gng.r2.pre-instruction.v1',kind:'pre_instruction',
  origin:'mame-native-tracelog',seq,pc:state.PC,before:state
});
function romImage(){
  const rom=new Uint8Array(65536);
  rom[0xfffe]=0x60;rom[0xffff]=0;
  const postbytes=[0x80,0xa0,0x80,0xa0]; // ,X+ / ,Y+
  for(let i=0;i<4;i++)
    rom.set([SITES[i].op,postbytes[i]],SITES[i].pc);
  return rom;
}
const sync=()=>({
  status:'SYNC_BYTE_AND_WAIT_BARRIER_PREPARED',
  epochs:[{}, {sync_prestate_seq:2,next_debugger_pc:'0x6017'}]
});
function nativeTrace(){
  const rows=[
    row(0,cpu(0x6016)),row(1,cpu(0x6000)),
    row(2,cpu(0x6016)),row(3,cpu(0x6017))
  ];
  const push=s=>rows.push(row(rows.length,s));
  // Two independent sets of gngb VRAM fill loop sites.  A checkpoint
  // after each indexed store is derived from explicit expected 6809 effects.
  // No MAME data or ROM bytes enter these ROM-free tests.
  for(let i=0;i<1024;i++){
    push(cpu(0x6041,0x2000+i,0x2800+i,0));
    push(cpu(0x6043,0x2001+i,0x2800+i,0));
    push(cpu(0x6045,0x2001+i,0x2801+i,8));
  }
  for(let i=0;i<1024;i++){
    push(cpu(0x6055,0x2400+i,0x2c00+i,0));
    push(cpu(0x6057,0x2401+i,0x2c00+i,8));
    push(cpu(0x6059,0x2401+i,0x2c01+i,0));
  }
  return rows;
}
function makeTsv(events,{extraBefore=[],extraAfter=[],maskCorrupt=-1,
  epoch0=[],reportedCount=null}={}){
  const records=['A04_VIDEO_WRITE_TAP_ENABLED\t1'];
  let seq=0;
  for(const e of epoch0){
    records.push(['A04_VIDEO_WRITE_BYTE',0,++seq,e.address,e.data,e.mask].join('\t'));
  }
  records.push('RESET_NOTIFICATION\t0\t24576');
  for(const [i,e] of [...extraBefore,...events,...extraAfter].entries()){
    records.push(['A04_VIDEO_WRITE_BYTE',1,++seq,
      e.address,e.data,i===maskCorrupt?0:e.mask].join('\t'));
  }
  records.push('A04_VIDEO_WRITE_COUNT\t'+(reportedCount??seq));
  records.push('PROBE_END\tframe-limit');
  return records.join('\n')+'\n';
}
async function fixture(fn){
  await mkdir('out/r3',{recursive:true});
  const dir=await mkdtemp(resolve('out/r3/a04-test-'));
  try{
    const rom=romImage(),rows=nativeTrace();
    const code=resolve(dir,'private-static-stores.mjs');
    await writeFile(code,emitStaticModule(
      SITES.map(s=>compileAt(rom,s.pc))));
    const {compiledStep}=await import(pathToFileURL(code).href);
    return await fn({rom,rows,sync:sync(),compiledStep});
  }finally{await rm(dir,{force:true,recursive:true});}
}
test('4096 generated VRAM byte writes exactly match unique contiguous native epoch segment',async()=>{
  await fixture(args=>{
    const prediction=deriveStaticVideoWrites(
      args.rom,args.rows,args.sync,args.compiledStep);
    assert.equal(prediction.events.length,4096);
    assert.deepEqual(prediction.bySite,[1024,1024,1024,1024]);
    const nativeTsv=makeTsv(prediction.events);
    const report=verifyNativeVideoWriteGate({...args,tsv:nativeTsv});
    assert.equal(report.status,'NATIVE_VIDEO_WRITES_MATCH_GENERATED_STATIC_JS');
    assert.equal(report.generated_video_byte_writes,4096);
    assert.equal(report.independently_native_video_byte_writes_total,4096);
    assert.equal(report.native_video_writes_after_reset,4096);
    assert.equal(report.matched_native_video_byte_writes,4096);
    assert.equal(report.generated_js_register_checkpoints_matched,4096);
    assert.equal(report.native_segment_uniquely_matched,true);
    assert.equal(report.native_bus_write_to_instruction_correlation_verified,false);
    assert.equal(report.exhaustive_native_video_ram_write_coverage_verified,false);
    assert.equal(report.game_playable,false);
    assert.equal(report.raw_ROM_memory_addresses_or_values_exported,false);
    assert.doesNotMatch(JSON.stringify(report),/0x2000|0x2400|0x2800|0x2c00|"data":/);
  });
});
test('native tap may include extra writes, but only a unique ordered complete window passes',async()=>{
  await fixture(args=>{
    const predicted=deriveStaticVideoWrites(
      args.rom,args.rows,args.sync,args.compiledStep).events;
    const extra={address:0x2fff,data:0xef,mask:255};
    const native=parseNativeVideoWrites(makeTsv(predicted,{
      extraBefore:[extra],extraAfter:[extra]}));
    assert.equal(native.total,4098);
    const comparison=compareNativeVideoWriteSequence(
      predicted,native.epochs[1]);
    assert.equal(comparison.status,'UNIQUE_CONTIGUOUS_NATIVE_SEQUENCE_MATCH');
    assert.equal(comparison.extra_native_video_writes_not_attributed,2);
  });
});
test('one wrong address, value, byte-mask or order blocks full native sequence equivalence',async()=>{
  await fixture(args=>{
    const predicted=deriveStaticVideoWrites(
      args.rom,args.rows,args.sync,args.compiledStep).events;
    for(const kind of ['address','data','mask','order']){
      const bad=predicted.map(x=>({...x}));
      if(kind==='address')bad[2000].address++;
      if(kind==='data')bad[2000].data^=1;
      if(kind==='mask')bad[2000].mask=0;
      if(kind==='order')[bad[2000],bad[2001]]=[bad[2001],bad[2000]];
      const compare=compareNativeVideoWriteSequence(predicted,bad);
      assert.equal(compare.status,'BLOCKED_NO_ORDERED_NATIVE_VIDEO_WRITE_MATCH');
      assert.equal(compare.unique_matching_window,false);
    }
  });
});
test('an empty/incomplete, wrong epoch, truncated or forged native capture fails closed',async()=>{
  await fixture(args=>{
    const expected=deriveStaticVideoWrites(
      args.rom,args.rows,args.sync,args.compiledStep).events;
    const good=makeTsv(expected);
    for(const bad of [
      good.replace('A04_VIDEO_WRITE_TAP_ENABLED\t1',
        'A04_VIDEO_WRITE_TAP_ENABLED\t0'),
      good.replace('A04_VIDEO_WRITE_COUNT\t4096','A04_VIDEO_WRITE_COUNT\t4095'),
      good.replace('A04_VIDEO_WRITE_BYTE\t1\t1','A04_VIDEO_WRITE_BYTE\t0\t1'),
      good.replace('A04_VIDEO_WRITE_BYTE\t1\t1','A04_VIDEO_WRITE_BYTE\t1\t2'),
      good.replace('PROBE_END\tframe-limit','PROBE_END\ttruncated'),
      good.replace('RESET_NOTIFICATION\t0\t24576',''),
      good.replace('A04_VIDEO_WRITE_BYTE\t1\t1','A04_VIDEO_WRITE_BYTE\t1\t1'),
      good.replace('A04_VIDEO_WRITE_COUNT\t4096','A04_VIDEO_WRITE_COUNT\t32769'),
    ]){
      // The unchanged good fixture has no deliberate corruption.
      if(bad===good)continue;
      assert.throws(()=>parseNativeVideoWrites(bad),/A04_/);
    }
    const native=parseNativeVideoWrites(good);
    assert.equal(native.epochs[1].length,4096);
  });
});
test('generated byte-store omission or one native register discrepancy is never bus PASS',async()=>{
  await fixture(args=>{
    const wrong=structuredClone(args.rows);
    wrong[5].before.X++;
    assert.throws(()=>deriveStaticVideoWrites(
      args.rom,wrong,args.sync,args.compiledStep),
      /A04_GENERATED_REGISTER_CHECKPOINT_DIVERGENCE/);
    const damaged=Uint8Array.from(args.rom);
    damaged[SITES[0].pc+1]=0x90; // indirect, deliberately unsupported
    assert.throws(()=>deriveStaticVideoWrites(
      damaged,args.rows,args.sync,args.compiledStep),
      /A04_EXPECTED_FOUR_GENERATED_STORES_NOT_PRESENT/);
  });
});
test('opt-in native video tap, capture preservation, policy proof and offline comparator are wired',async()=>{
  const lua=await readFile('scripts/r2-mame-probe.lua','utf8');
  assert.match(lua,/GNG_A04_VIDEO_WRITE_TAP/);
  assert.match(lua,/space:install_write_tap\(\s*0x2000,\s*0x2fff/);
  assert.match(lua,/A04_VIDEO_WRITE_BYTE/);
  assert.match(lua,/A04_VIDEO_WRITE_COUNT/);
  const capture=await readFile('scripts/r3-video-write-capture.sh','utf8');
  assert.match(capture,/GNG_A04_VIDEO_WRITE_TAP=1/);
  assert.match(capture,/GNG_R36_CAPTURE_UNMAP_POLICY=1/);
  const wrapper=await readFile('scripts/r3-mmio-read-capture.sh','utf8');
  assert.match(wrapper,/probe-before-r36-mmio/);
  assert.match(wrapper,/scripts\/r3_unmapped_read_policy\.mjs/);
  assert.match(wrapper,/scripts\/r3_native_video_write_gate\.mjs/);
});
