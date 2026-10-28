import test from 'node:test';
import assert from 'node:assert/strict';
import {compileZ80Prefix,classifyZ80Family}
  from '../src/gngb_z80_static_codegen.mjs';

// Synthetic ROM only; every test intentionally stops at CB (unsupported).
const load=async(opcode)=>{
  const bytes=new Uint8Array(0x8000);
  bytes.set([opcode,0xcb,0x40],0);
  const build=compileZ80Prefix(bytes);
  assert.equal(build.compiled,1);
  const module=await import('data:text/javascript,'+encodeURIComponent(build.source));
  return module.z80AotBlocks.get(0);
};

test('G5 observed RLCA rotates A circularly in 4T and preserves SZPV rather than recomputing parity',async()=>{
  const fn=await load(0x07);
  for(const [a,flags,value,want] of [[0x80,0,1,1],[0,0xff,0,0xc4],
    [0x14,0,0x28,0x28],[0xff,0,0xff,0x29],[1,0xc4,2,0xc4]]) {
    const s={pc:0,t:30,a,f:flags,hl:0xc100,bc:0x1234};
    fn(s,{});
    assert.deepEqual(s,{pc:1,t:34,a:value,f:want,hl:0xc100,bc:0x1234});
  }
});

test('T3 observed RRCA rotates bit zero into carry and bit seven in 4T',async()=>{
  const fn=await load(0x0f);
  for(const [a,flags,value,want] of [
    [0x01,0,0x80,0x01],[0x50,0xff,0x28,0xec],
    [0x81,0,0xc0,0x01],[0x00,0xc4,0,0xc4]]){
    const s={pc:0,t:30,a,f:flags};
    fn(s,{});
    assert.deepEqual([s.pc,s.t,s.a,s.f],[1,34,value,want]);
  }
});

test('T3 observed ED SBC HL,BC carries, half borrows and overflows in 15T',async()=>{
  const rom=new Uint8Array(0x8000);
  rom.set([0xed,0x42,0xcb,0x40]);
  const c=compileZ80Prefix(rom);
  assert.equal(c.compiled,1);
  const module=await import('data:text/javascript,'+encodeURIComponent(c.source));
  const fn=module.z80AotBlocks.get(0);
  for(const [hl,bc,carry,want,wantFlags] of [
    [0,1,0,0xffff,0xbb],
    [0x8000,1,0,0x7fff,0x3e],
    [1,1,0,0,0x42],
    [0x1234,0x1111,1,0x0122,0x02]]){
    const s={pc:0,t:20,hl,bc,f:carry};
    fn(s,{});
    assert.deepEqual([s.pc,s.t,s.hl,s.f],[2,35,want,wantFlags]);
  }
  const other=new Uint8Array(0x8000);
  other.set([0xed,0x52]);
  assert.equal(compileZ80Prefix(other,{limit:1}).compiled,0);
});

test('T3 observed RES b,(IX+d) clears memory only in 23T',async()=>{
  const rom=new Uint8Array(0x8000);
  rom.set([0xdd,0xcb,0xfe,0x86,0xcb,0x40]);
  const c=compileZ80Prefix(rom);
  assert.equal(c.compiled,1);
  const module=await import('data:text/javascript,'+encodeURIComponent(c.source));
  const fn=module.z80AotBlocks.get(0);
  const calls=[];
  const s={pc:0,t:10,ix:0xc001,f:0xd7};
  fn(s,{read8(a,t){calls.push(['read',a,t]);return 0xff;},
    write8(a,v,t){calls.push(['write',a,v,t]);}});
  assert.deepEqual(calls,[['read',0xbfff,29],['write',0xbfff,0xfe,33]]);
  assert.deepEqual([s.pc,s.t,s.f],[4,33,0xd7]);
  for(const bit of [1,7]){
    const candidate=new Uint8Array(0x8000);
    candidate.set([0xdd,0xcb,0,0x86+8*bit,0xcb,0x40]);
    const build=compileZ80Prefix(candidate);
    assert.equal(build.compiled,1);
    const generated=await import('data:text/javascript,'+
      encodeURIComponent(build.source));
    const writes=[];
    generated.z80AotBlocks.get(0)({pc:0,t:0,ix:0xc000,f:0},
      {read8(){return 255;},write8(_a,v){writes.push(v);}});
    assert.deepEqual(writes,[255^(1<<bit)]);
  }
  for(const bytes of [[0xfd,0xcb,0xfe,0x86],
    [0xdd,0xcb,0xfe,0x80]]){
    const other=new Uint8Array(0x8000);other.set(bytes);
    assert.equal(compileZ80Prefix(other,{limit:1}).compiled,0);
  }
});

test('T3 observed PUSH IY writes high then low across stack wrap in 15T',async()=>{
  const rom=new Uint8Array(0x8000);
  rom.set([0xfd,0xe5,0xcb,0x40]);
  const c=compileZ80Prefix(rom);
  assert.equal(c.compiled,1);
  const generated=await import('data:text/javascript,'+encodeURIComponent(c.source));
  const calls=[];
  const s={pc:0,t:100,sp:0,iy:0xabcd,f:0x83};
  generated.z80AotBlocks.get(0)(s,{write8(...args){calls.push(args);}});
  assert.deepEqual(calls,[[0xffff,0xab,112],[0xfffe,0xcd,115]]);
  assert.deepEqual([s.pc,s.t,s.sp,s.f],[2,115,0xfffe,0x83]);
  const other=new Uint8Array(0x8000);other.set([0xdd,0xe5]);
  assert.equal(compileZ80Prefix(other,{limit:1}).compiled,0);
});

test('T3 observed BIT 7,A preserves carry and sets S or Z/PV in 8T',async()=>{
  const rom=new Uint8Array(0x8000);rom.set([0xcb,0x7f,0xed,0x00]);
  const c=compileZ80Prefix(rom);
  assert.equal(c.compiled,1);
  const generated=await import('data:text/javascript,'+encodeURIComponent(c.source));
  const fn=generated.z80AotBlocks.get(0);
  for(const [a,flags,want] of [[0x80,1,0x91],[0x28,0xff,0x7d],
    [0,0,0x54]]){
    const s={pc:0,t:20,a,f:flags};fn(s,{});
    assert.deepEqual([s.pc,s.t,s.a,s.f],[2,28,a,want]);
  }
  const other=new Uint8Array(0x8000);other.set([0xcb,0x47]);
  assert.equal(compileZ80Prefix(other,{limit:1}).compiled,0);
});

test('T3 observed INC (IX/IY+d) has 23T, wrap and carry preservation',async()=>{
  for(const prefix of [0xdd,0xfd]){
    const rom=new Uint8Array(0x8000);rom.set([prefix,0x34,0xfe,0xcb,0x40]);
    const c=compileZ80Prefix(rom);
    assert.equal(c.compiled,1);
    const generated=await import('data:text/javascript,'+encodeURIComponent(c.source));
    const fn=generated.z80AotBlocks.get(0);
    for(const [old,want,flags] of [[0x7f,0x80,0x95],
      [0xff,0,0x51],[0x0e,0x0f,0x09]]){
      const writes=[],s={pc:0,t:10,ix:1,iy:1,f:1};
      fn(s,{read8(a,t){assert.deepEqual([a,t],[0xffff,29]);return old;},
        write8(...args){writes.push(args);}});
      assert.deepEqual(writes,[[0xffff,want,33]]);
      assert.deepEqual([s.pc,s.t,s.f],[3,33,flags]);
    }
  }
});

test('B4 LD r,r register/register and r/(HL) transfer without flag mutation',async()=>{
  const moves=[
    {opcode:0x78,bc:0x4268,hl:0xc041,expectA:0x42,clock:4}, // LD A,B
    {opcode:0x4f,bc:0x4268,a:0x91,expectBC:0x4291,clock:4}, // LD C,A
    {opcode:0x7e,bc:0x4268,hl:0xc041,expectA:0x54,clock:7}, // LD A,(HL)
    {opcode:0x70,bc:0x4268,hl:0xc041,a:0x91,write:0x42,clock:7} // LD (HL),B
  ];
  for(const entry of moves){
    const fn=await load(entry.opcode);
    const calls=[],bus={
      read8(addr,t){calls.push(['read',addr,t]);return 0x54;},
      write8(addr,v,t){calls.push(['write',addr,v,t]);}
    };
    const state={pc:0,t:20,bc:entry.bc,hl:entry.hl??0xc041,
      de:0x1111,a:entry.a??0x91,f:0x95};
    fn(state,bus);
    assert.equal(state.pc,1);
    assert.equal(state.t,20+entry.clock);
    assert.equal(state.f,0x95);
    if(entry.expectA!==undefined)assert.equal(state.a,entry.expectA);
    if(entry.expectBC!==undefined)assert.equal(state.bc,entry.expectBC);
    if(entry.write!==undefined)assert.deepEqual(calls,[['write',0xc041,entry.write,27]]);
    if(entry.opcode===0x7e)assert.deepEqual(calls,[['read',0xc041,27]]);
  }
});

test('B4 ALU register arithmetic has Z80 carry, overflow, halfborrow and CP F3/F5',async()=>{
  const examples=[
    [0x80,0x7f,0x01,0,0x80,0x94], // ADD A,B overflow
    [0x80,0xff,0x01,0,0x00,0x51], // ADD A,B wraps
    [0x88,0x7f,0x00,1,0x80,0x94], // ADC A,B
    [0x90,0x00,0x01,0,0xff,0xbb], // SUB B
    [0x98,0x80,0x00,1,0x7f,0x3e], // SBC A,B
    [0xa0,0xf0,0x0f,0,0x00,0x54], // AND B
    [0xa8,0xff,0xff,0,0x00,0x44], // XOR B
    [0xb0,0x01,0x80,0,0x81,0x84], // OR B, even parity
    [0xb8,0x10,0x21,0,0x10,0x33]  // CP B, F3/F5 from operand
  ];
  for(const [opcode,a,b,carry,wantA,wantF] of examples){
    const fn=await load(opcode);
    const state={pc:0,t:30,a,bc:b<<8,f:carry,hl:0xc001};
    fn(state,{});
    assert.deepEqual([state.pc,state.t,state.a,state.f],
      [1,34,wantA,wantF],opcode.toString(16));
  }
});

test('B4 ALU (HL) reads sound RAM at documented memory boundary and charges 7T',async()=>{
  const step=await load(0x86); // ADD A,(HL)
  const log=[];
  const state={pc:0,t:10,hl:0xc010,a:0x12,f:0};
  step(state,{read8(addr,t){log.push([addr,t]);return 0x10;}});
  assert.deepEqual(log,[[0xc010,17]]);
  assert.deepEqual([state.a,state.t,state.pc,state.f],[0x22,17,1,0x20]);
});

test('B4 RET conditions test both edges for NZ Z NC C PO PE P M',async()=>{
  const conditions=[0xc0,0xc8,0xd0,0xd8,0xe0,0xe8,0xf0,0xf8];
  const masks=[0x40,0x40,0x01,0x01,0x04,0x04,0x80,0x80];
  for(let i=0;i<conditions.length;i++){
    const fn=await load(conditions[i]);
    const wantSet=(i&1)===1;
    for(const triggered of [true,false]){
      const flags=triggered===wantSet?masks[i]:0;
      const log=[],s={pc:0,sp:0xc010,t:100,f:flags,a:0xab};
      fn(s,{read8(addr,t){log.push([addr,t]);return addr===0xc010?0x34:0x12;}});
      assert.deepEqual([s.pc,s.sp,s.t,s.a,s.f],
        triggered?[0x1234,0xc012,111,0xab,flags]:[1,0xc010,105,0xab,flags],
        'RET '+i+' triggered='+triggered);
      assert.deepEqual(log,triggered?[[0xc010,105],[0xc011,108]]:[]);
    }
  }
});

test('B4 classification refines the 22 generic OTHER frontiers safely',()=>{
  const samples=[
    [0x09,'ADD_HL_RR'],[0x39,'ADD_HL_RR'],
    [0x02,'LD_ACCUMULATOR_INDIRECT'],[0x1a,'LD_ACCUMULATOR_INDIRECT'],
    [0x07,'ROTATE_ACCUMULATOR'],[0x1f,'ROTATE_ACCUMULATOR'],
    [0xe9,'JP_INDIRECT'],[0xf9,'LD_SP_HL'],
    [0x76,'HALT']
  ];
  for(const [opcode,family] of samples)assert.equal(classifyZ80Family(opcode),family);
});

test('B4 HALT has a dedicated compiled terminal step, not disguised LD (HL),(HL)',async()=>{
  const rom=new Uint8Array(0x8000);
  rom.set([0x76,0xcb,0x40],0);
  const r=compileZ80Prefix(rom);
  assert.equal(r.compiled,1);
  assert.equal(r.blockers[0].family,'CB_BIT_ROTATE_PREFIX');
  const generated=await import('data:text/javascript,'+encodeURIComponent(r.source));
  const s={pc:0,t:0,halted:false,f:0x93,hl:0xc100};
  generated.z80AotBlocks.get(0)(s,{});
  assert.deepEqual([s.pc,s.t,s.halted,s.f,s.hl],[1,4,true,0x93,0xc100]);
});
