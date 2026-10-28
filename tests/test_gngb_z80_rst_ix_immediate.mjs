import test from 'node:test';
import assert from 'node:assert/strict';
import {compileZ80Prefix,Z80StaticError,classifyZ80IndexedInstruction}
  from '../src/gngb_z80_static_codegen.mjs';

// ROM-free fixtures. Generated JS is run only from deterministic synthetic ROM.
async function compileSynthetic(rom,{entry=0}={}) {
  const result=compileZ80Prefix(rom,{entry});
  const generated=await import('data:text/javascript,'+encodeURIComponent(result.source));
  return {result,blocks:generated.z80AotBlocks};
}
test('B4 LD IX,nn and LD IY,nn compile 4-byte prefix with 14 T and preserve flags',async()=>{
  for(const [prefix,field,other] of [
    [0xdd,'ix','iy'],[0xfd,'iy','ix']
  ]) {
    const rom=new Uint8Array(0x8000);
    rom.set([prefix,0x21,0x34,0xc2,0xcb,0x40],0);
    const {result,blocks}=await compileSynthetic(rom);
    assert.equal(result.compiled,1);
    assert.equal(result.blockers[0].pc,4);
    const state={pc:0,ix:0x1122,iy:0x3344,t:60,f:0x95,sp:0xc700};
    blocks.get(0)(state,{});
    assert.equal(state[field],0xc234);
    assert.equal(state[other],prefix===0xdd?0x3344:0x1122);
    assert.deepEqual([state.pc,state.t,state.f,state.sp],[4,74,0x95,0xc700]);
    assert.equal(result.source.includes('decodeOpcode'),false);
  }
});

test('B4 DD/FD 21 immediate wrap-around and truncated ROM boundary fail closed',async()=>{
  const rom=new Uint8Array(0x8000);
  rom.set([0xdd,0x21,0xff,0xff,0xcb,0x40],0);
  const {result,blocks}=await compileSynthetic(rom);
  const state={pc:0,t:4,ix:0,f:0x00};
  blocks.get(0)(state,{});
  assert.deepEqual([state.ix,state.pc,state.t],[0xffff,4,18]);
  for(const entry of [0x7ffd,0x7ffe,0x7fff]){
    const broken=new Uint8Array(0x8000);
    broken[entry]=0xdd;
    if(entry<0x7fff)broken[entry+1]=0x21;
    assert.throws(()=>compileZ80Prefix(broken,{entry}),
      e=>e instanceof Z80StaticError&&e.code==='AUDIO_Z80_ROM_BOUNDARY');
  }
});

test('B4 all eight RST vectors push next PC high then low, 11T, no flags modified',async()=>{
  for(const opcode of [0xc7,0xcf,0xd7,0xdf,0xe7,0xef,0xf7,0xff]) {
    const rom=new Uint8Array(0x8000);
    const vector=opcode&0x38,pc=0x123;
    rom[pc]=opcode;rom[pc+1]=0xcb;rom[pc+2]=0x40;
    rom[vector]=0xcb;rom[vector+1]=0x40;
    const {result,blocks}=await compileSynthetic(rom,{entry:pc});
    assert.equal(result.compiled,1);
    const calls=[];
    const state={pc,sp:0xc100,t:30,a:0x55,f:0xa7};
    blocks.get(pc)(state,{
      write8:(addr,value,t)=>calls.push([addr,value,t])
    });
    assert.deepEqual([state.pc,state.sp,state.t,state.a,state.f],
      [vector,0xc0fe,41,0x55,0xa7]);
    assert.deepEqual(calls,[
      [0xc0ff,0x01,38],
      [0xc0fe,0x24,41]
    ]);
    assert.deepEqual(result.visitedPcs,[pc]);
  }
});

test('B4 RST stack decrements wrap from 0000 to FFFE',async()=>{
  const rom=new Uint8Array(0x8000);
  rom[0x100]=0xff;rom[0x101]=0xcb;rom[0x102]=0x40;
  rom[0x38]=0xcb;rom[0x39]=0x40;
  const {blocks}=await compileSynthetic(rom,{entry:0x100});
  const calls=[],state={pc:0x100,sp:0,t:0,f:0};
  blocks.get(0x100)(state,{write8:(...args)=>calls.push(args)});
  assert.deepEqual(calls,[[0xffff,1,8],[0xfffe,1,11]]);
  assert.deepEqual([state.pc,state.sp,state.t],[0x38,0xfffe,11]);
});

test('B4 unsupported DD indexed forms still stop with semantic family not raw bytes',()=>{
  for(const [second,want] of [[0x22,'INDEX_LD_RR_ABSOLUTE'],
    [0x23,'INDEX_INC_DEC_RR'],[0xcb,'INDEX_BIT_ROTATE_DISPLACEMENT']]){
    const rom=new Uint8Array(0x8000);rom.set([0xdd,second],0);
    const result=compileZ80Prefix(rom);
    assert.equal(result.compiled,0);
    assert.equal(result.blockers[0].indexed_instruction,want);
  }
  assert.equal(classifyZ80IndexedInstruction(0x21),'INDEX_LD_RR_IMMEDIATE');
});
