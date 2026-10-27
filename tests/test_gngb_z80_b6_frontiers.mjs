import test from 'node:test';
import assert from 'node:assert/strict';
import {compileZ80Prefix,classifyZ80CbInstruction,Z80StaticError}
  from '../src/gngb_z80_static_codegen.mjs';
import {summarizeZ80Frontiers} from '../src/gngb_audio_frontier_report.mjs';

// Synthetic ROM only. CB BIT (40) intentionally terminates static discovery.
async function fixture(bytes,{dest=null}={}) {
  const rom=new Uint8Array(0x8000);
  rom.set([...bytes,0xcb,0x40],0);
  if(dest!==null)rom.set([0xcb,0x40],dest);
  const result=compileZ80Prefix(rom);
  const module=await import('data:text/javascript,'+encodeURIComponent(result.source));
  return {blocks:module.z80AotBlocks,result};
}

test('B4.T2-B6: PUSH BC/DE/HL/AF writes high then low at +8/+11 T and wraps SP',async()=>{
  for(const [opcode,high,low] of [
    [0xc5,0x12,0x34],[0xd5,0x56,0x78],
    [0xe5,0x9a,0xbc],[0xf5,0xfe,0x95]
  ]) {
    const {blocks,result}=await fixture([opcode]);
    assert.equal(result.compiled,1);
    const writes=[],s={pc:0,t:90,sp:0,bc:0x1234,de:0x5678,hl:0x9abc,
      a:0xfe,f:0x95};
    blocks.get(0)(s,{write8:(...args)=>writes.push(args)});
    assert.deepEqual(writes,[[0xffff,high,98],[0xfffe,low,101]]);
    assert.deepEqual([s.sp,s.pc,s.t,s.f,s.a],[0xfffe,1,101,0x95,0xfe]);
  }
});

test('B4.T2-B6: conditional CALL tests all eight conditions and both stack branches',async()=>{
  const ops=[0xc4,0xcc,0xd4,0xdc,0xe4,0xec,0xf4,0xfc];
  const masks=[64,64,1,1,4,4,128,128];
  for(let i=0;i<ops.length;i++){
    const {blocks,result}=await fixture([ops[i],0x00,0x01],{dest:0x100});
    assert.equal(result.compiled,1);
    assert.deepEqual(result.blockers.map(b=>b.pc),[3,0x100]);
    for(const flags of [0,1,4,64,128,255]){
      const take=((flags&masks[i])!==0)===((i&1)===1);
      const calls=[],s={pc:0,t:20,sp:0xc000,f:flags,a:0xee};
      blocks.get(0)(s,{write8:(...args)=>calls.push(args)});
      assert.deepEqual([s.pc,s.t,s.sp,s.f,s.a],
        take?[256,37,0xbffe,flags,0xee]:[3,30,0xc000,flags,0xee]);
      assert.deepEqual(calls,take?
        [[0xbfff,0,31],[0xbffe,3,34]]:[]);
    }
  }
});

test('B4.T2-B6: JP (HL) is 4T, jumps dynamic HL and has no invented CFG successor',async()=>{
  const {result,blocks}=await fixture([0xe9]);
  assert.equal(result.compiled,1);
  assert.deepEqual(result.visitedPcs,[0]);
  assert.deepEqual(result.blockers,[]);
  for(const hl of [0,0x1234,0xc100,0xf509]){
    const s={pc:0,hl,t:10,sp:0xc000,f:0xb1,a:0x10};
    blocks.get(0)(s,{});
    assert.deepEqual([s.pc,s.t,s.sp,s.f,s.a],[hl,14,0xc000,0xb1,0x10]);
  }
});

test('B4.T2-B6: DD/FD indexed stores accept seven register sources at 19T',async()=>{
  for(const prefix of [0xdd,0xfd])for(const [opcode,value] of [
    [0x70,0x12],[0x71,0x34],[0x72,0x56],[0x73,0x78],
    [0x74,0x9a],[0x75,0xbc],[0x77,0xde]
  ]){
    const {result,blocks}=await fixture([prefix,opcode,0xff]);
    assert.equal(result.compiled,1);
    const writes=[],s={pc:0,t:30,ix:0xc100,iy:0xc200,bc:0x1234,
      de:0x5678,hl:0x9abc,a:0xde,f:0xd5};
    blocks.get(0)(s,{write8:(...args)=>writes.push(args)});
    assert.deepEqual(writes,[[prefix===0xdd?0xc0ff:0xc1ff,value,49]]);
    assert.deepEqual([s.pc,s.t,s.f,s.hl,s.ix,s.iy],
      [3,49,0xd5,0x9abc,0xc100,0xc200]);
  }
});

test('B4.T2-B6: CB rotate/shift all eight operations produce Z80 flags and 8T',async()=>{
  const cases=[
    [0x00,0x80,0,0x01,0x01], // RLC B
    [0x08,0x01,0,0x80,0x81], // RRC B
    [0x10,0x80,1,0x01,0x01], // RL B
    [0x18,0x01,1,0x80,0x81], // RR B
    [0x20,0x80,0,0x00,0x45], // SLA B
    [0x28,0x81,0,0xc0,0x85], // SRA B
    [0x30,0x80,0,0x01,0x01], // SLL B (undocumented)
    [0x38,0x01,0,0x00,0x45]  // SRL B
  ];
  for(const [second,b,c,newB,newF] of cases){
    const {result,blocks}=await fixture([0xcb,second]);
    assert.equal(result.compiled,1);
    const s={pc:0,t:100,bc:b<<8,f:c,hl:0xc000,a:0x50};
    blocks.get(0)(s,{});
    assert.deepEqual([s.bc>>>8,s.f,s.pc,s.t,s.a],
      [newB,newF,2,108,0x50],second.toString(16));
  }
});

test('B4.T2-B6: CB rotate/shift (HL) reads at +8, writes at +15, costs 15T',async()=>{
  for(const [second,old,want,wantF] of [
    [0x06,0x80,1,1], // RLC (HL)
    [0x2e,0x81,0xc0,0x85], // SRA (HL)
    [0x3e,0x01,0,0x45] // SRL (HL)
  ]) {
    const {result,blocks}=await fixture([0xcb,second]);
    assert.equal(result.compiled,1);
    const ops=[],s={pc:0,t:20,hl:0xc012,bc:0x3456,a:0xd3,f:0};
    blocks.get(0)(s,{
      read8:(...args)=>{ops.push(['read',...args]);return old;},
      write8:(...args)=>ops.push(['write',...args])
    });
    assert.deepEqual(ops,[['read',0xc012,28],['write',0xc012,want,35]]);
    assert.deepEqual([s.pc,s.t,s.f,s.hl,s.bc,s.a],
      [2,35,wantF,0xc012,0x3456,0xd3]);
  }
});

test('B4.T2-B6: CB BIT,RES,SET remain blocked; family metadata contains no ROM bytes',()=>{
  for(const [second,kind] of [[0x40,'CB_BIT_TEST'],[0x80,'CB_RESET_BIT'],
    [0xc0,'CB_SET_BIT']]){
    const rom=new Uint8Array(0x8000);
    rom.set([0xcb,second],0);
    const r=compileZ80Prefix(rom);
    assert.equal(r.compiled,0);
    const safe=summarizeZ80Frontiers(r);
    assert.equal(safe.frontiers[0].cb_instruction,kind);
    assert.equal(classifyZ80CbInstruction(second),kind);
    assert.equal(safe.static_generated_code_exported,false);
  }
  for(const value of [-1,256,'0xff',1.5])
    assert.throws(()=>classifyZ80CbInstruction(value),Z80StaticError);
});
