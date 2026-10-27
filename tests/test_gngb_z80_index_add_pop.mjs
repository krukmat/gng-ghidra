import test from 'node:test';
import assert from 'node:assert/strict';
import {compileZ80Prefix,classifyZ80IndexedInstruction,Z80StaticError}
  from '../src/gngb_z80_static_codegen.mjs';

async function compileOne(bytes,{pc=0}={}) {
  const rom=new Uint8Array(0x8000);
  rom.set(bytes,pc);
  rom.set([0xcb,0x40],pc+bytes.length); // deliberately unsupported CB BIT
  const compiled=compileZ80Prefix(rom,{entry:pc});
  assert.equal(compiled.compiled,1);
  assert.deepEqual(compiled.visitedPcs,[pc]);
  const module=await import('data:text/javascript,'+encodeURIComponent(compiled.source));
  return module.z80AotBlocks.get(pc);
}

test('B4.T2-B4: DD/FD LD r,(IX/IY+d) all 7 legal destinations, negative displacement and 19 T',async()=>{
  for(const prefix of [0xdd,0xfd])for(const [opcode,dest] of [
    [0x46,'b'],[0x4e,'c'],[0x56,'d'],[0x5e,'e'],
    [0x66,'h'],[0x6e,'l'],[0x7e,'a']
  ]){
    const fn=await compileOne([prefix,opcode,0xfe]);
    const reads=[];
    const state={pc:0,ix:0xc001,iy:0xc101,bc:0x1234,de:0x5678,
      hl:0x9abc,a:0xee,sp:0xc7ff,f:0xd5,t:100};
    const addr=prefix===0xdd?0xbfff:0xc0ff;
    fn(state,{read8:(a,t)=>{reads.push([a,t]);return 0x42;}});
    const reg=dest==='a'?state.a:
      dest==='b'?(state.bc>>>8):dest==='c'?(state.bc&255):
      dest==='d'?(state.de>>>8):dest==='e'?(state.de&255):
      dest==='h'?(state.hl>>>8):(state.hl&255);
    assert.equal(reg,0x42, 'destination '+dest);
    assert.deepEqual(reads,[[addr,119]]);
    assert.deepEqual([state.pc,state.t,state.f,state.ix,state.iy],
      [3,119,0xd5,0xc001,0xc101]);
  }
});

test('B4.T2-B4: indexed effective address wraps 16 bits for signed displacement',async()=>{
  for(const [prefix,idx,d,expected] of [
    [0xdd,0,0xff,0xffff],[0xfd,0xffff,1,0],
    [0xdd,0xffff,0x80,0xff7f],[0xfd,0xfffe,0x7f,0x007d]
  ]) {
    const fn=await compileOne([prefix,0x7e,d]);
    const reads=[];
    const state={pc:0,ix:idx,iy:idx,a:0,f:0x13,t:0};
    fn(state,{read8:(addr,time)=>{reads.push([addr,time]);return 0xb4;}});
    assert.deepEqual(reads,[[expected,19]]);
    assert.deepEqual([state.a,state.f,state.pc,state.t],[0xb4,0x13,3,19]);
  }
});

test('B4.T2-B4: indexed load requires full displacement byte and unsupported IX updates remain gated',()=>{
  for(const prefix of [0xdd,0xfd]){
    const rom=new Uint8Array(0x8000);
    rom.set([prefix,0x36,0x03,0x42],0);
    const blocked=compileZ80Prefix(rom);
    assert.equal(blocked.compiled,0);
    assert.equal(blocked.blockers[0].indexed_instruction,'INDEX_DISPLACEMENT_UPDATE');
    // Can't synthesize a displacement from outside a ROM boundary.
    const edge=new Uint8Array(0x8000);
    edge.set([prefix,0x46],0x7ffe);
    assert.throws(()=>compileZ80Prefix(edge,{entry:0x7ffe}),
      e=>e instanceof Z80StaticError&&e.code==='AUDIO_Z80_ROM_BOUNDARY');
  }
  assert.equal(classifyZ80IndexedInstruction(0x46),'INDEX_DISPLACEMENT_LOAD');
});

test('B4.T2-B4: ADD HL,rr preserves SZPV, computes H/C/F3/F5 and 11 T',async()=>{
  const cases=[
    [0x09,0x0fff,0x0001,0xc5,0x1000,0xd4,'bc'],
    [0x19,0xffff,0x0001,0x00,0x0000,0x11,'de'],
    [0x29,0x8ffe,0x8ffe,0x00,0x1ffc,0x19,'hl'],
    [0x39,0x8123,0x7edd,0x00,0x0000,0x11,'sp'],
    [0x09,0x1234,0x2222,0x01,0x3456,0x20,'bc']
  ];
  for(const [opcode,hl,operand,flags,wantHL,wantF,reg] of cases) {
    const fn=await compileOne([opcode]);
    const s={pc:0,hl,bc:0xaaaa,de:0xbbbb,sp:0xcccc,
      f:flags,t:20,a:0x7f};
    if(reg!=='hl')s[reg]=operand;
    const previous={...s};
    fn(s,{});
    assert.deepEqual([s.hl,s.f,s.pc,s.t,s.a],[wantHL,wantF,1,31,0x7f],
      'ADD HL '+reg);
    if(reg==='bc')assert.equal(s.bc,previous.bc);
    if(reg==='de')assert.equal(s.de,previous.de);
    if(reg==='sp')assert.equal(s.sp,previous.sp);
  }
});

test('B4.T2-B4: POP BC/DE/HL/AF reads little-endian stack, wraps SP and charges 10T',async()=>{
  for(const [opcode,target] of [[0xc1,'bc'],[0xd1,'de'],[0xe1,'hl'],[0xf1,'af']]){
    const fn=await compileOne([opcode]);
    const reads=[];
    const s={pc:0,sp:0xffff,t:40,a:0x11,f:0x22,
      bc:0x3344,de:0x5566,hl:0x7788};
    fn(s,{read8:(addr,t)=>{
      reads.push([addr,t]);return addr===0xffff?0x3a:0xb4;
    }});
    assert.deepEqual(reads,[[0xffff,47],[0,50]]);
    assert.deepEqual([s.pc,s.sp,s.t],[1,1,50]);
    if(target==='af') {
      assert.deepEqual([s.a,s.f],[0xb4,0x3a]);
      assert.deepEqual([s.bc,s.de,s.hl],[0x3344,0x5566,0x7788]);
    } else {
      assert.equal(s[target],0xb43a);
      assert.deepEqual([s.a,s.f],[0x11,0x22]);
    }
  }
});

test('B4.T2-B4: POP AF followed by conditional RET honors popped flags',async()=>{
  const rom=new Uint8Array(0x8000);rom.set([0xf1,0xc8,0xcb,0x40],0);
  const compiled=compileZ80Prefix(rom);
  assert.equal(compiled.compiled,2);
  const module=await import('data:text/javascript,'+encodeURIComponent(compiled.source));
  const bus={read8:(addr)=>addr===0xc000?0x40:
    addr===0xc001?0x55:addr===0xc002?0x10:0x02};
  const state={pc:0,sp:0xc000,t:0,a:0,f:0};
  module.z80AotBlocks.get(0)(state,bus);
  assert.deepEqual([state.pc,state.a,state.f,state.sp,state.t],
    [1,0x55,0x40,0xc002,10]);
  module.z80AotBlocks.get(1)(state,bus);
  assert.deepEqual([state.pc,state.sp,state.t],[0x0210,0xc004,21]);
});
