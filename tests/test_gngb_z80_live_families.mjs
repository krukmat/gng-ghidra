import test from 'node:test';
import assert from 'node:assert/strict';
import {compileZ80Prefix,classifyZ80Family}
  from '../src/gngb_z80_static_codegen.mjs';

// Synthetic ROM only; every test intentionally stops at CB (unsupported).
const load=async(opcode)=>{
  const bytes=new Uint8Array(0x8000);
  bytes.set([opcode,0xcb],0);
  const build=compileZ80Prefix(bytes);
  assert.equal(build.compiled,1);
  const module=await import('data:text/javascript,'+encodeURIComponent(build.source));
  return module.z80AotBlocks.get(0);
};

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
  rom.set([0x76,0xcb,0x00],0);
  const r=compileZ80Prefix(rom);
  assert.equal(r.compiled,1);
  assert.equal(r.blockers[0].family,'CB_BIT_ROTATE_PREFIX');
  const generated=await import('data:text/javascript,'+encodeURIComponent(r.source));
  const s={pc:0,t:0,halted:false,f:0x93,hl:0xc100};
  generated.z80AotBlocks.get(0)(s,{});
  assert.deepEqual([s.pc,s.t,s.halted,s.f,s.hl],[1,4,true,0x93,0xc100]);
});
