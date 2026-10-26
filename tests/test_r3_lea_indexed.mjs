import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compileAt,compileIndexedLea,emitStaticModule}
  from '../scripts/r3_static_trace_probe.mjs';
import {compileNativeBankedPairs} from '../scripts/r3_banked_static_gate.mjs';
import {profileNativeBankedEffects} from '../scripts/r3_banked_effect_profile.mjs';

// Synthetic encodings from the public MC6809 datasheet; no ROM-derived data.
const OPS=[[0x30,'X'],[0x31,'Y'],[0x32,'S'],[0x33,'U']];
const BASES=[[0x84,'X'],[0xa4,'Y'],[0xc4,'U'],[0xe4,'S']];
const generated=async specs=>(await import('data:text/javascript;base64,'+
  Buffer.from(emitStaticModule(specs)).toString('base64'))).compiledStep;
const refuse=()=>{throw Error('UNEXPECTED_MEMORY_EFFECT');};
const regs=(PC,overrides={})=>({PC,A:0x5a,B:0xa5,X:0x1111,Y:0x2222,
  U:0x3333,S:0x4444,DP:0x12,CC:0,...overrides});

test('LEA accepts only the zero-offset non-indirect ,R postbyte',()=>{
  for(const [op,target] of OPS){
    const accepted=[];
    for(let post=0;post<256;post++)if(compileIndexedLea(op,post))accepted.push(post);
    assert.deepEqual(accepted,BASES.map(([post])=>post));
    for(const [post,base] of BASES){
      const spec=compileIndexedLea(op,post);
      assert.equal(spec.len,2);
      assert.equal(spec.name,'LEA'+target+'_INDEXED');
      assert.equal(spec.index_register,base);
      assert.equal(spec.index_mode,'ZERO');
    }
  }
  // Documented auto-increment/decrement, offset, PC-relative, indirect and
  // illegal forms have no LEA evidence yet and must stay rejected.
  for(const post of [0x80,0x81,0x82,0x83,0x85,0x86,0x88,0x89,0x8b,0x8c,0x8d,
      0x91,0x93,0x94,0x98,0x9f,0x00,0x0f,0x10,0x1f,0x87,0x8a,0x8e,0x8f,0x90,0x92])
    assert.equal(compileIndexedLea(0x30,post),null);
  for(const [op,post] of [[0x2f,0x84],[0x34,0x84],[0x30,-1],[0x30,256],
      [0x30,1.5],['0x30',0x84],[0x31,null],[undefined,0xc4]])
    assert.equal(compileIndexedLea(op,post),null);
});

test('LEAX/LEAY load the address and change only Z; LEAS/LEAU change no flags',async()=>{
  const rom=new Uint8Array(65536),specs=[],sites=[];
  let pc=0x6000;
  for(const [op,target] of OPS)for(const [post,base] of BASES){
    rom.set([op,post],pc);
    const spec=compileAt(rom,pc);
    assert.equal(spec.name,'LEA'+target+'_INDEXED');
    assert.equal(spec.writesRamByte,false);
    assert.equal(spec.writesSpriteWord,false);
    assert.equal(spec.index_register,base);
    assert.equal(spec.index_mode,'ZERO');
    specs.push(spec);sites.push({pc,target,base});pc+=2;
  }
  const step=await generated(specs);
  for(const {pc,target,base} of sites)
    for(const value of [0,1,0x7fff,0x8000,0xffff])
      for(const CC of [0x00,0x04,0xfb,0xff]){
        const before=Object.freeze(regs(pc,{[base]:value,CC}));
        const expected={...before,PC:pc+2,[target]:value};
        if(target==='X'||target==='Y')expected.CC=(CC&~4)|(value===0?4:0);
        assert.deepEqual(step(before,refuse,refuse),expected);
      }
});

test('LEA ,R has no indexing side effect, including base equal to destination',async()=>{
  const rom=new Uint8Array(65536);
  // LEAX ,U; LEAX ,X; LEAS ,S; LEAU ,U
  rom.set([0x30,0xc4,0x30,0x84,0x32,0xe4,0x33,0xc4],0x6100);
  const step=await generated([0x6100,0x6102,0x6104,0x6106].map(pc=>compileAt(rom,pc)));
  const leaxU=step(regs(0x6100,{U:0,X:0x9999,CC:0xf0}),refuse,refuse);
  assert.equal(leaxU.U,0);assert.equal(leaxU.X,0);assert.equal(leaxU.CC,0xf4);
  const leaxX=step(regs(0x6102,{X:0x8000,CC:0x04}),refuse,refuse);
  assert.equal(leaxX.X,0x8000);assert.equal(leaxX.CC,0);
  for(const pc of [0x6104,0x6106]){
    const before=regs(pc,{CC:0xaf});
    assert.deepEqual(step(before,refuse,refuse),{...before,PC:pc+2});
  }
});

test('compileAt keeps rejected LEA forms, the bank boundary and the attested LEAY -1,Y site',()=>{
  const rom=new Uint8Array(65536);
  rom.set([0x31,0x3f],0x6010);rom.set([0x31,0x3f],0x6020);
  rom.set([0x30,0x80],0x6030);         // LEAX ,X+
  rom.set([0x30,0xd4],0x6032);         // LEAX [,U]
  rom.set([0x30,0xc8,0x10],0x6034);    // LEAX 16,U
  assert.equal(compileAt(rom,0x6010)?.name,'LEAY_MINUS_1');
  for(const pc of [0x6020,0x6030,0x6032,0x6034])assert.equal(compileAt(rom,pc),null);
  const view=new Uint8Array(65536);
  view.set([0x30,0xc4],0x4000);view[0x5fff]=0x30;view[0x6000]=0xc4;
  assert.equal(compileAt(view,0x4000),null);
  assert.equal(compileAt(view,0x4000,{banked:false}),null);
  const spec=compileAt(view,0x4000,{banked:true});
  assert.equal(spec.name,'LEAX_INDEXED');
  assert.equal(spec.next,0x4002);
  assert.equal(spec.index_register,'U');
  // An LEA whose postbyte lies in fixed ROM straddles the mapping boundary.
  assert.equal(compileAt(view,0x5fff,{banked:true}),null);
});

async function profileLeaSteps(steps){
  const fixed=new Uint8Array(65536),packed=new Uint8Array(5*8192);
  packed.set([0x30,0xc4],8190);        // bank 0 at 0x5ffe: LEAX ,U
  const rows=[],witness=[];
  for(const before of steps.flat()){
    const seq=rows.length;
    rows.push({schema:'gng.r2.pre-instruction.v1',origin:'mame-native-tracelog',
      kind:'pre_instruction',seq,pc:before.PC,before});
    witness.push({seq,pc:before.PC,bank:0,epoch:0});
  }
  const nativeBankReport={status:'BANK_IDENTITY_AT_EVERY_NATIVE_PRESTATE_VERIFIED',
    native_preinstruction_samples:rows.length,bank_window_pc_samples:steps.length,
    native_banked_prestate_bank_identified:steps.length,
    distinct_observed_bank_pc_pairs:1,distinct_bank_window_pcs:1,
    observed_bank_counts:{0:steps.length,1:0,2:0,3:0,4:0},
    bank_pc_pairs:[{bank:0,pc:'0x5ffe',samples:steps.length}],
    native_per_instruction_mapped_ROM_signature_verified:true};
  const compiled=compileNativeBankedPairs({fixed,packed,rows,witness,nativeBankReport});
  const compiledByBank=new Map();
  for(const [bank,specs] of compiled.byBank)compiledByBank.set(bank,await generated(specs));
  return profileNativeBankedEffects({rows,witness,compiled,compiledByBank});
}

test('banked effect profile executes LEA ,R without writes and reports divergences',async()=>{
  // Following checkpoints are independent synthetic expectations.
  const first=regs(0x5ffe,{U:0x1234,X:0,CC:0x54});
  const second=regs(0x5ffe,{U:0,X:0x00ff,CC:0x50});
  const steps=[[first,{...first,PC:0x6000,X:0x1234,CC:0x50}],
    [second,{...second,PC:0x6000,X:0,CC:0x54}]];
  const report=await profileLeaSteps(steps);
  assert.equal(report.status,'BANKED_EFFECT_PROFILE_PREDICTED_WRITES_ONLY');
  assert.equal(report.native_samples_with_static_codegen,2);
  assert.equal(report.native_samples_without_static_codegen,0);
  assert.equal(report.matched_register_checkpoints,2);
  assert.equal(report.predicted_byte_writes,0);
  assert.deepEqual(report.families.map(f=>[f.opcode_family,f.executed_samples,
    f.predicted_write_instructions]),[['LEAX_INDEXED',2,0]]);
  steps[0][1]={...steps[0][1],X:0x1235};
  const divergent=await profileLeaSteps(steps);
  assert.equal(divergent.status,'BANKED_EFFECT_PROFILE_REGISTER_DIVERGENCE');
  assert.equal(divergent.differing_register_checkpoints,1);
  assert.equal(divergent.matched_register_checkpoints,1);
});
