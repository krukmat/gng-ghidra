import test from 'node:test';
import assert from 'node:assert/strict';
import {compileZ80Prefix,classifyZ80Family,classifyZ80EdInstruction,Z80StaticError} from '../src/gngb_z80_static_codegen.mjs';

test('compiled instructions are static JavaScript with private ROM provenance',()=>{
  const rom=new Uint8Array(0x8000);
  // JP 0100 ; LD SP,c7ff ; LD A,42 ; LD (e001),A ; RET.
  rom.set([0xc3,0x00,0x01],0);
  rom.set([0x31,0xff,0xc7,0x3e,0x42,0x32,0x01,0xe0,0xc9],0x100);
  const x=compileZ80Prefix(rom);
  assert.equal(x.status,'SUPPORTED_PREFIX_ONLY');
  assert.equal(x.compiled,5);
  assert.match(x.source,/bus.write8\(57345,\$\.a,\$\.t\+13\)/);
  assert.doesNotMatch(x.source,/decodeOpcode|eval\(/);
});
test('unsupported opcode is an explicit blocked frontier',()=>{
  const rom=new Uint8Array(0x8000);
  rom[0]=0xcb; // Z80 CB-prefixed family intentionally not yet implemented
  const x=compileZ80Prefix(rom);
  assert.equal(x.status,'PARTIAL_UNCERTIFIED');
  assert.equal(x.compiled,0);
  assert.equal(x.blockers[0].pc,0);
});
test('invalid ROM images or run limits fail closed',()=>{
  assert.throws(()=>compileZ80Prefix(new Uint8Array(10)),Z80StaticError);
  assert.throws(()=>compileZ80Prefix(new Uint8Array(0x8000),{limit:0}),Z80StaticError);
});

test('ROM-private frontier gives instruction family but never opcode bytes',()=>{
  const examples=new Map([
    [0xcb,'CB_BIT_ROTATE_PREFIX'],[0xed,'ED_EXTENDED_PREFIX'],
    [0xdd,'DD_IX_PREFIX'],[0xfd,'FD_IY_PREFIX'],
    [0x76,'HALT'],[0xfb,'EI'],[0xd3,'IO_PORT'],
    [0x41,'LD_R_R'],[0x06,'LD_R_IMMEDIATE'],
    [0xc5,'PUSH_RR'],[0xe1,'POP_RR'],[0x20,'JR_CONDITIONAL']
  ]);
  for(const [opcode,expected] of examples)
    assert.equal(classifyZ80Family(opcode),expected);
  const rom=new Uint8Array(0x8000);
  rom[0]=0xed;
  const result=compileZ80Prefix(rom);
  assert.deepEqual(result.blockers,[{pc:0,reason:'UNSUPPORTED_Z80_ED_INSTRUCTION',
    family:'ED_EXTENDED_PREFIX',ed_instruction:'ED_UNASSIGNED_OR_UNDOCUMENTED'}]);
  assert.doesNotMatch(JSON.stringify(result.blockers),/"opcode"|"bytes"/);
  assert.throws(()=>classifyZ80Family(-1),Z80StaticError);
  assert.throws(()=>classifyZ80Family(256),Z80StaticError);
});


test('ED interrupt modes (documented and alias) advance two bytes in eight T-states',async()=>{
  for(const [second,im] of [[0x46,0],[0x4e,0],[0x66,0],[0x6e,0],
                             [0x56,1],[0x76,1],[0x5e,2],[0x7e,2]]) {
    const rom=new Uint8Array(0x8000);
    rom.set([0xed,second,0xcb],0);
    const result=compileZ80Prefix(rom);
    assert.equal(result.compiled,1);
    assert.equal(result.blockers[0].pc,2);
    const module=await import('data:text/javascript,'+encodeURIComponent(result.source));
    const state={pc:0,im:null,t:0};
    module.z80AotBlocks.get(0)(state,{});
    assert.deepEqual([state.pc,state.im,state.t],[2,im,8]);
  }
});

test('ED NEG sign, halfcarry, parity-overflow and undocumented F5/F3 flags',async()=>{
  for(const second of [0x44,0x4c,0x54,0x5c,0x64,0x6c,0x74,0x7c]) {
    const rom=new Uint8Array(0x8000);
    rom.set([0xed,second,0xcb],0);
    const result=compileZ80Prefix(rom);
    assert.equal(result.compiled,1);
    const module=await import('data:text/javascript,'+encodeURIComponent(result.source));
    for(const [a,want,flags] of [[0x80,0x80,0x87],[1,255,0xbb],[0,0,0x42]]) {
      const state={pc:0,a,f:0,t:5};
      module.z80AotBlocks.get(0)(state,{});
      assert.deepEqual([state.pc,state.a,state.f,state.t],[2,want,flags,13]);
    }
  }
});

test('ED LD I,A has 9 T-states and preserves flags',async()=>{
  const rom=new Uint8Array(0x8000);
  rom.set([0xed,0x47,0xcb],0);
  const result=compileZ80Prefix(rom);
  assert.equal(result.compiled,1);
  const module=await import('data:text/javascript,'+encodeURIComponent(result.source));
  const state={pc:0,i:0,a:0x42,f:0x81,t:0};
  module.z80AotBlocks.get(0)(state,{});
  assert.deepEqual([state.pc,state.i,state.f,state.t],[2,0x42,0x81,9]);
});

test('unimplemented ED retains semantic label, no instruction bytes exported',()=>{
  const examples=[[0xb0,'ED_BLOCK_TRANSFER'],[0xb1,'ED_BLOCK_COMPARE'],
                  [0x4d,'ED_RETI'],[0x40,'ED_IN_PORT'],[0x41,'ED_OUT_PORT']];
  for(const [second,expected] of examples){
    assert.equal(classifyZ80EdInstruction(second),expected);
    const rom=new Uint8Array(0x8000);
    rom.set([0xed,second],0);
    const result=compileZ80Prefix(rom);
    assert.deepEqual(result.blockers,[{
      pc:0,reason:'UNSUPPORTED_Z80_ED_INSTRUCTION',
      family:'ED_EXTENDED_PREFIX',ed_instruction:expected
    }]);
    assert.equal(Object.keys(result.blockers[0]).includes('opcode'),false);
  }
});


test('ED 16-bit register-pair instruction classifier respects register selection',()=>{
  for(const [second,kind] of [
    [0x42,'ED_SBC_HL_RR'],[0x52,'ED_SBC_HL_RR'],
    [0x4a,'ED_ADC_HL_RR'],[0x7a,'ED_ADC_HL_RR'],
    [0x43,'ED_LD_DIRECT_RR'],[0x73,'ED_LD_DIRECT_RR'],
    [0x4b,'ED_LD_RR_DIRECT'],[0x7b,'ED_LD_RR_DIRECT']
  ]) assert.equal(classifyZ80EdInstruction(second),kind);
});

test('DJNZ branches on B after wrapping decrement and preserves C, flags and A', async()=>{
  const rom=new Uint8Array(0x8000);
  // LD BC, 0x0107 ; DJNZ +2 -> 0x0007 ; NOP fallthrough ; RET at target.
  rom.set([0x01,0x07,0x01,0x10,0x02,0x00,0x00,0xc9],0);
  const compiled=compileZ80Prefix(rom);
  assert.equal(compiled.blockers.length,0);
  const output=await import('data:text/javascript,'+encodeURIComponent(compiled.source));
  const jump=output.z80AotBlocks.get(3);
  assert.equal(typeof jump,'function');
  const options=[
    {bc:0x0207,expectedBC:0x0107,target:7,cycles:13},
    {bc:0x0107,expectedBC:0x0007,target:5,cycles:8},
    {bc:0x0007,expectedBC:0xff07,target:7,cycles:13}
  ];
  for(const x of options){
    const state={pc:3,bc:x.bc,f:0xd7,a:0x89,t:41};
    jump(state,{});
    assert.deepEqual(
      [state.pc,state.bc,state.f,state.a,state.t],
      [x.target,x.expectedBC,0xd7,0x89,41+x.cycles]
    );
  }
  assert.equal(output.z80AotBlocks.has(5),true);
  assert.equal(output.z80AotBlocks.has(7),true);
});

test('DJNZ negative displacement loops safely, including self-loop',async()=>{
  const rom=new Uint8Array(0x8000);
  rom.set([0x10,0xfe,0xc9],0); // DJNZ -2 (back to PC 0), or fallthrough at 2
  const result=compileZ80Prefix(rom);
  assert.equal(result.blockers.length,0);
  assert.equal(result.compiled,2);
  const module=await import('data:text/javascript,'+encodeURIComponent(result.source));
  const step=module.z80AotBlocks.get(0);
  const state={pc:0,bc:0x0201,t:0,f:0xa5};
  step(state,{});
  assert.deepEqual([state.pc,state.bc,state.t,state.f],[0,0x0101,13,0xa5]);
  step(state,{});
  assert.deepEqual([state.pc,state.bc,state.t,state.f],[2,0x0001,21,0xa5]);
});
