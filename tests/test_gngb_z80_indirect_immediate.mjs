import test from 'node:test';
import assert from 'node:assert/strict';
import {compileZ80Prefix,classifyZ80IndexedInstruction,Z80StaticError}
  from '../src/gngb_z80_static_codegen.mjs';
import {summarizeZ80Frontiers} from '../src/gngb_audio_frontier_report.mjs';

const compileOne=async(bytes)=>{
  const rom=new Uint8Array(0x8000);
  rom.set([...bytes,0xcb,0x40],0);
  const result=compileZ80Prefix(rom);
  assert.equal(result.compiled,1);
  assert.equal(result.blockers[0].pc,bytes.length);
  const module=await import('data:text/javascript,'+encodeURIComponent(result.source));
  return module.z80AotBlocks.get(0);
};

test('B4.T2-B2 LD (BC)/(DE),A and LD A,(BC)/(DE) preserve flags, exact 7T bus read/write',async()=>{
  for(const [opcode,addr,isRead] of [
    [0x02,0xc031,false],[0x0a,0xc031,true],
    [0x12,0xc052,false],[0x1a,0xc052,true]
  ]){
    const fn=await compileOne([opcode]);
    const log=[],state={pc:0,t:31,bc:0xc031,de:0xc052,a:0x4b,f:0xe5};
    const bus={
      read8(a,t){log.push(['read',a,t]);return 0x72;},
      write8(a,v,t){log.push(['write',a,v,t]);}
    };
    fn(state,bus);
    assert.deepEqual([state.pc,state.t,state.f,state.bc,state.de],
      [1,38,0xe5,0xc031,0xc052]);
    assert.equal(state.a,isRead?0x72:0x4b);
    assert.deepEqual(log,isRead?[['read',addr,38]]:[['write',addr,0x4b,38]]);
  }
});

test('B4.T2-B2 eight immediate ALU families preserve Z80 flags and A/CP semantics',async()=>{
  const inputs=[
    [0xc6,0x7f,0x01,0,0x80,0x94], // ADD
    [0xce,0x7f,0x00,1,0x80,0x94], // ADC
    [0xd6,0x00,0x01,0,0xff,0xbb], // SUB
    [0xde,0x80,0x00,1,0x7f,0x3e], // SBC
    [0xe6,0xf0,0x0f,0,0x00,0x54], // AND
    [0xee,0xff,0xff,0,0x00,0x44], // XOR
    [0xf6,0x01,0x80,0,0x81,0x84], // OR
    [0xfe,0x10,0x21,0,0x10,0x33]  // CP (A unchanged)
  ];
  for(const [opcode,a,operand,carry,wantA,wantF] of inputs){
    const fn=await compileOne([opcode,operand]);
    const state={pc:0,t:43,a,f:carry,sp:0xc7ff};
    fn(state,{});
    assert.deepEqual([state.pc,state.t,state.a,state.f,state.sp],
      [2,50,wantA,wantF,0xc7ff],opcode.toString(16));
  }
});

test('B4.T2-B2 immediate ALU includes halfcarry, zero, borrow and parity extremes',async()=>{
  const cases=[
    [0xc6,0x0f,0x01,0,0x10,0x10],
    [0xc6,0xff,0x01,0,0x00,0x51],
    [0xd6,0x10,0x01,0,0x0f,0x1a],
    [0xfe,0x00,0x00,0,0x00,0x42],
    [0xee,0x01,0x01,0,0x00,0x44]
  ];
  for(const [opcode,a,operand,carry,wantA,wantF] of cases){
    const fn=await compileOne([opcode,operand]);
    const state={pc:0,t:0,a,f:carry};
    fn(state,{});
    assert.deepEqual([state.a,state.f,state.pc,state.t],[wantA,wantF,2,7],
      'opcode '+opcode.toString(16));
  }
});

test('B4.T2-B2 remaining DD/FD index instructions are classified and fail closed',()=>{
  const patterns=[
    [0x22,'INDEX_LD_RR_ABSOLUTE'],
    [0x23,'INDEX_INC_DEC_RR'],
    [0x09,'INDEX_ADD_RR'],
    [0x24,'INDEX_HIGH_LOW_REGISTER'],
    [0x34,'INDEX_DISPLACEMENT_UPDATE'], // indexed INC still fails closed
    [0x86,'INDEX_DISPLACEMENT_ALU'],
    [0xcb,'INDEX_BIT_ROTATE_DISPLACEMENT'],
    [0xe5,'INDEX_STACK_JUMP_TRANSFER'],
    [0xfd,'INDEX_PREFIX_CHAIN'],
    [0x00,'INDEX_UNHANDLED_SECOND_OPCODE']
  ];
  for(const [ext,want] of patterns){
    assert.equal(classifyZ80IndexedInstruction(ext),want);
    for(const prefix of [0xdd,0xfd]){
      const rom=new Uint8Array(0x8000);rom.set([prefix,ext],0);
      const result=compileZ80Prefix(rom);
      assert.equal(result.compiled,0);
      assert.equal(result.blockers[0].indexed_instruction,want);
      const report=summarizeZ80Frontiers(result);
      assert.equal(report.frontiers[0].indexed_instruction,want);
      assert.equal(report.executed_pc_coverage_verified,false);
    }
  }
  for(const v of [-1,256,'33',1.5])
    assert.throws(()=>classifyZ80IndexedInstruction(v),Z80StaticError);
});

test('B4.T2-B2 index tag safety rejects malicious marker or unrelated family',()=>{
  const rom=new Uint8Array(0x8000);rom.set([0xdd,0x22],0);
  const original=compileZ80Prefix(rom);
  const changed={...original,blockers:[{...original.blockers[0],
    indexed_instruction:'SENSITIVE RAW PC: e000'}]};
  assert.throws(()=>summarizeZ80Frontiers(changed),/AUDIO_REPORT_UNSAFE_TAG/);
  const changedFamily={...original,blockers:[{...original.blockers[0],
    family:'LD_R_R'}]};
  assert.throws(()=>summarizeZ80Frontiers(changedFamily),/AUDIO_REPORT_INDEX_FAMILY_MISMATCH/);
  assert.doesNotMatch(JSON.stringify(summarizeZ80Frontiers(original)),
    /z80AotBlocks|operand_bytes|ROM_DUMP/);
});
