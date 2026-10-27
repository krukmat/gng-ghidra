import test from 'node:test';
import assert from 'node:assert/strict';
import {compileZ80Prefix} from '../src/gngb_z80_static_codegen.mjs';
import {stepZ80AotAtBoundary,canAcceptZ80MaskableIrq,
  AudioZ80BoundaryStop} from '../src/gngb_z80_irq_boundary.mjs';

const compiled=async(bytes)=>{
  const rom=new Uint8Array(0x8000);
  rom.set(bytes,0);
  const result=compileZ80Prefix(rom);
  assert.equal(result.status,'SUPPORTED_PREFIX_ONLY');
  return (await import('data:text/javascript,'+encodeURIComponent(result.source))).z80AotBlocks;
};

test('B2 EI enables IFF1/IFF2 immediately but blocks INT until following NOP finishes',async()=>{
  const blocks=await compiled([0xfb,0x00,0xc9]); // EI; NOP; RET
  const state={pc:0,t:100,iff1:false,iff2:false,f:0x93};
  assert.equal(canAcceptZ80MaskableIrq(state),false);
  const afterEi=stepZ80AotAtBoundary(blocks,state,{});
  assert.deepEqual({pc:state.pc,t:state.t,iff1:state.iff1,
    iff2:state.iff2,eiDelay:state.eiDelay,f:state.f},
    {pc:1,t:104,iff1:true,iff2:true,eiDelay:1,f:0x93});
  assert.equal(afterEi.maskableIrqEligible,false);
  assert.equal(afterEi.irqAcknowledged,false);
  const afterNop=stepZ80AotAtBoundary(blocks,state,{});
  assert.deepEqual({pc:state.pc,t:state.t,eiDelay:state.eiDelay},
    {pc:2,t:108,eiDelay:0});
  assert.equal(afterNop.maskableIrqEligible,true);
  assert.equal(afterNop.nativeParityVerified,false);
});

test('B2 EI;RET suppresses IRQ until after return completes',async()=>{
  const blocks=await compiled([0xfb,0xc9]);
  const memory=new Map([[0xc000,0x34],[0xc001,0x12]]);
  const bus={
    read8(addr){return memory.get(addr)},
    write8(){throw Error('unexpected write')}
  };
  const s={pc:0,sp:0xc000,t:0,iff1:false,iff2:false};
  stepZ80AotAtBoundary(blocks,s,bus);
  assert.equal(canAcceptZ80MaskableIrq(s),false);
  const ret=stepZ80AotAtBoundary(blocks,s,bus);
  assert.deepEqual({pc:s.pc,sp:s.sp,t:s.t,eiDelay:s.eiDelay},
    {pc:0x1234,sp:0xc002,t:14,eiDelay:0});
  assert.equal(ret.maskableIrqEligible,true);
});

test('B2 EI;DI always stays IRQ-disabled and clears pending EI inhibition',async()=>{
  const blocks=await compiled([0xfb,0xf3,0xc9]);
  const s={pc:0,t:0,iff1:false,iff2:false,f:0xa5};
  stepZ80AotAtBoundary(blocks,s,{});
  assert.equal(s.eiDelay,1);
  const step=stepZ80AotAtBoundary(blocks,s,{});
  assert.deepEqual(
    [s.pc,s.t,s.iff1,s.iff2,s.eiDelay,s.f,step.maskableIrqEligible],
    [2,8,false,false,0,0xa5,false]);
});

test('B2 consecutive EI restarts one-instruction inhibition',async()=>{
  const blocks=await compiled([0xfb,0xfb,0x00,0xc9]);
  const s={pc:0,t:0,iff1:false,iff2:false};
  stepZ80AotAtBoundary(blocks,s,{});
  assert.equal(s.eiDelay,1);
  stepZ80AotAtBoundary(blocks,s,{});
  assert.deepEqual([s.pc,s.eiDelay,canAcceptZ80MaskableIrq(s)],[2,1,false]);
  stepZ80AotAtBoundary(blocks,s,{});
  assert.deepEqual([s.pc,s.eiDelay,canAcceptZ80MaskableIrq(s)],[3,0,true]);
});

test('B2 EI AOT block alone is not mistaken for scheduler IRQ eligibility',async()=>{
  const blocks=await compiled([0xfb,0xc9]);
  const s={pc:0,t:0,iff1:false,iff2:false};
  blocks.get(0)(s,{});
  assert.deepEqual([s.pc,s.t,s.iff1,s.iff2,s.eiDelay],
    [1,4,true,true,2]);
  assert.throws(()=>canAcceptZ80MaskableIrq(s),AudioZ80BoundaryStop);
  assert.throws(()=>stepZ80AotAtBoundary(blocks,s,{}),AudioZ80BoundaryStop);
});

test('B2 boundary helper rejects uncompiled paths and invalid/incomplete states',async()=>{
  const blocks=await compiled([0x00,0xc9]);
  assert.throws(()=>stepZ80AotAtBoundary(blocks,{pc:99,t:0},{}),
    e=>e instanceof AudioZ80BoundaryStop&&e.code==='AUDIO_Z80_IRQ_UNCOMPILED_PC');
  assert.throws(()=>stepZ80AotAtBoundary(blocks,{pc:0,t:NaN},{}),
    AudioZ80BoundaryStop);
  assert.throws(()=>canAcceptZ80MaskableIrq({pc:0,t:0,eiDelay:-1}),
    AudioZ80BoundaryStop);
  assert.throws(()=>stepZ80AotAtBoundary(new Map([[0,()=>{}]]),
    {pc:0,t:0},{}),AudioZ80BoundaryStop);
});
