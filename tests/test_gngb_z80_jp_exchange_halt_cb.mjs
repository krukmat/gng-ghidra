import test from 'node:test';
import assert from 'node:assert/strict';
import {compileZ80Prefix,classifyZ80CbInstruction,Z80StaticError}
  from '../src/gngb_z80_static_codegen.mjs';
import {summarizeZ80Frontiers} from '../src/gngb_audio_frontier_report.mjs';
import {stepZ80AotAtBoundary,canAcceptZ80MaskableIrq,AudioZ80BoundaryStop}
  from '../src/gngb_z80_irq_boundary.mjs';

// Synthetic test ROMs only. CB BIT remains unsupported and terminates
// branches without ever loading or persisting private ROM-derived source.
const blocks=async(bytes,{dest=null}={})=>{
  const rom=new Uint8Array(0x8000);
  rom.set([...bytes,0xcb,0x40],0);
  if(dest!==null)rom.set([0xcb,0x40],dest);
  const compiled=compileZ80Prefix(rom);
  const module=await import('data:text/javascript,'+encodeURIComponent(compiled.source));
  return {compiled,map:module.z80AotBlocks};
};

test('B4.T2-B5 all JP cc,nn conditions take/skip at exactly 10 T with no side effects',async()=>{
  const opcodes=[0xc2,0xca,0xd2,0xda,0xe2,0xea,0xf2,0xfa];
  const masks=[0x40,0x40,1,1,4,4,0x80,0x80];
  for(let i=0;i<8;i++) {
    const {compiled,map}=await blocks([opcodes[i],0x00,0x01],{dest:0x100});
    assert.equal(compiled.compiled,1);
    assert.deepEqual(compiled.blockers.map(x=>x.pc),[3,256]);
    for(const flags of [0,1,4,0x40,0x80,0xff]) {
      const shouldTake=((flags&masks[i])!==0)===((i&1)===1);
      const state={pc:0,t:51,a:0x92,f:flags,bc:0x1234,hl:0xabcd};
      map.get(0)(state,{});
      assert.deepEqual([state.pc,state.t,state.a,state.f,state.bc,state.hl],
        [shouldTake?0x100:3,61,0x92,flags,0x1234,0xabcd]);
    }
  }
});

test('B4.T2-B5 EX DE,HL swaps values, preserves AF flags and charges 4T',async()=>{
  const {map}=await blocks([0xeb]);
  const s={pc:0,t:7,a:0x72,f:0x95,bc:0x4000,de:0xbeef,hl:0x1234};
  map.get(0)(s,{});
  assert.deepEqual(s,{pc:1,t:11,a:0x72,f:0x95,bc:0x4000,de:0x1234,hl:0xbeef});
});

test('B4.T2-B5 EX AF,AF shadow and EXX three shadow register pairs round-trip',async()=>{
  for(const opcode of [0x08,0xd9]) {
    const {map}=await blocks([opcode]);
    const state={pc:0,t:0,a:0x12,f:0x82,aAlt:0xab,fAlt:0x43,
      bc:0x1001,de:0x2002,hl:0x3003,
      bcAlt:0x4004,deAlt:0x5005,hlAlt:0x6006};
    const original={...state};
    map.get(0)(state,{});
    assert.equal(state.pc,1);
    assert.equal(state.t,4);
    if(opcode===0x08){
      assert.deepEqual([state.a,state.f,state.aAlt,state.fAlt],[0xab,0x43,0x12,0x82]);
      assert.equal(state.bc,original.bc);
    }else{
      assert.deepEqual([state.bc,state.de,state.hl],[0x4004,0x5005,0x6006]);
      assert.deepEqual([state.bcAlt,state.deAlt,state.hlAlt],[0x1001,0x2002,0x3003]);
      assert.equal(state.a,original.a);
    }
    state.pc=0;
    map.get(0)(state,{});
    for(const reg of ['a','f','aAlt','fAlt','bc','de','hl','bcAlt','deAlt','hlAlt'])
      assert.equal(state[reg],original[reg],reg);
    assert.equal(state.t,8);
  }
});

test('B4.T2-B5 EX AF and EXX reject absent alternate register banks rather than injecting undefined',async()=>{
  for(const [opcode,state] of [
    [0x08,{pc:0,t:0,a:1,f:0x40}],
    [0xd9,{pc:0,t:0,bc:1,de:2,hl:3}]
  ]) {
    const {map}=await blocks([opcode]);
    const before={...state};
    assert.throws(()=>map.get(0)(state,{}),/AUDIO_Z80_ALT_STATE_REQUIRED/);
    assert.deepEqual(state,before);
  }
});

test('B4.T2-B5 EX (SP),HL reads then writes stack in 19T, wraps SP and preserves flags',async()=>{
  const {map}=await blocks([0xe3]);
  for(const sp of [0xc100,0xffff]){
    const calls=[];
    const state={pc:0,t:19,sp,hl:0xabcd,f:0xd7,bc:0x1111};
    const other=(sp+1)&65535;
    const bus={
      read8(addr,t){calls.push(['read',addr,t]);return addr===sp?0x78:0x56;},
      write8(addr,v,t){calls.push(['write',addr,v,t]);}
    };
    map.get(0)(state,bus);
    assert.deepEqual(calls,[
      ['read',sp,23],['read',other,26],
      ['write',sp,0xcd,30],['write',other,0xab,33]
    ]);
    assert.deepEqual([state.pc,state.t,state.hl,state.sp,state.f,state.bc],
      [1,38,0x5678,sp,0xd7,0x1111]);
  }
});

test('B4.T2-B5 HALT marks CPU halted; boundary prevents next fetch before external service',async()=>{
  const {compiled,map}=await blocks([0x76,0x00]);
  assert.equal(compiled.compiled,2);
  const s={pc:0,t:100,iff1:true,iff2:true,eiDelay:0,halted:false,
    f:0x71,bc:0x5555};
  const first=stepZ80AotAtBoundary(map,s,{});
  assert.deepEqual([s.pc,s.t,s.halted,s.f,s.bc],[1,104,true,0x71,0x5555]);
  assert.equal(first.maskableIrqEligible,true);
  assert.equal(first.irqAcknowledged,false);
  assert.equal(canAcceptZ80MaskableIrq(s),true);
  assert.throws(()=>stepZ80AotAtBoundary(map,s,{}),
    e=>e instanceof AudioZ80BoundaryStop&&
       e.code==='AUDIO_Z80_IRQ_HALTED_AWAITING_SERVICE');
  assert.equal(s.t,104);
  // A separate IRQ/reset scheduler would clear HALT after servicing it;
  // this test only proves instruction-boundary execution stays gated.
  s.halted=false;
  stepZ80AotAtBoundary(map,s,{});
  assert.equal(s.pc,2);
  assert.equal(s.t,108);
});

test('B4.T2-B5 EI + HALT clears EI delay only after following instruction',async()=>{
  const {map}=await blocks([0xfb,0x76]);
  const s={pc:0,t:0,iff1:false,iff2:false,eiDelay:0,halted:false};
  stepZ80AotAtBoundary(map,s,{});
  assert.deepEqual([s.pc,s.t,s.eiDelay,s.halted],[1,4,1,false]);
  assert.equal(canAcceptZ80MaskableIrq(s),false);
  const out=stepZ80AotAtBoundary(map,s,{});
  assert.deepEqual([s.pc,s.t,s.eiDelay,s.halted],[2,8,0,true]);
  assert.equal(out.maskableIrqEligible,true);
  assert.equal(out.irqAcknowledged,false);
});

test('B4.T2-B5 CB trace diagnoses rotate/BIT/RES/SET with private-safe families only',()=>{
  for(const [second,kind] of [
  // CB rotate/shift now compiles, so only unsupported CB groups are blockers.
    [0x40,'CB_BIT_TEST'],[0x7e,'CB_BIT_TEST'],
    [0x80,'CB_RESET_BIT'],[0xbf,'CB_RESET_BIT'],
    [0xc0,'CB_SET_BIT'],[0xff,'CB_SET_BIT']
  ]) {
    const rom=new Uint8Array(32768);rom.set([0xcb,second],0);
    const decoded=compileZ80Prefix(rom);
    assert.equal(decoded.compiled,0);
    assert.equal(decoded.blockers[0].cb_instruction,kind);
    const report=summarizeZ80Frontiers(decoded);
    assert.equal(report.frontiers[0].cb_instruction,kind);
    assert.equal(report.static_generated_code_exported,false);
    assert.doesNotMatch(JSON.stringify(report),/operand_bytes|z80AotBlocks/);
  }
  for(const invalid of [-1,256,'0xcb',null,1.5])
    assert.throws(()=>classifyZ80CbInstruction(invalid),Z80StaticError);
});

test('B4.T2-B5 report CB metadata rejects unauthorized family and non-allowlisted labels',()=>{
  const rom=new Uint8Array(32768);rom.set([0xcb,0x40]);
  const decoded=compileZ80Prefix(rom);
  const r={...decoded,blockers:[{...decoded.blockers[0],family:'LD_R_R'}]};
  assert.throws(()=>summarizeZ80Frontiers(r),/AUDIO_REPORT_CB_FAMILY_MISMATCH/);
  r.blockers[0]={...decoded.blockers[0],cb_instruction:'ROM bytes private'};
  assert.throws(()=>summarizeZ80Frontiers(r),/AUDIO_REPORT_UNSAFE_TAG/);
});
