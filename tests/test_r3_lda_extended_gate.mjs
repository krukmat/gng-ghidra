import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {compileAt,emitStaticModule,checkedState}
  from '../scripts/r3_static_trace_probe.mjs';
import {classifyAddress,compileLdaAt,emitLdaModule,finalSpriteMemory,
  makeTrustedRead,evaluateLdaAgainstMame}
  from '../scripts/r3_lda_extended_gate.mjs';

const state=(PC,CC=0x50)=>({
  PC,A:0,B:0,X:0,Y:0,U:0,S:0x2000,DP:0,CC
});
function romFixture(address=0x6000){
  const rom=new Uint8Array(65536);
  rom[0xfffe]=0x60;rom[0xffff]=0;
  rom.set([
    0x1a,0x50,0x8e,0x1e,0x00,0x10,0x8e,0x00,0x60,
    0xcc,0x12,0x34,0xed,0x81,0xed,0x81,0x31,0x3f,0x26,0xf8,
    0x12,0x12,0x13,0xb6,address>>8,address&255,0x39
  ],0x6000);
  return rom;
}
async function fixture(address,fn){
  await mkdir('out/r3',{recursive:true});
  const folder=await mkdtemp(resolve('out/r3/lda-test-'));
  try{
    const rom=romFixture(address), specs=new Map();
    for(const pc of [0x6000,0x6002,0x6005,0x6009,0x600c,0x600e,
      0x6010,0x6012,0x6014,0x6015])
      specs.set(pc,compileAt(rom,pc));
    const boot=resolve(folder,'compiled-boot.mjs');
    const lda=resolve(folder,'compiled-lda.mjs');
    await writeFile(boot,emitStaticModule([...specs.values()]));
    await writeFile(lda,emitLdaModule(compileLdaAt(rom)));
    const {compiledStep}=await import(pathToFileURL(boot).href);
    const {executeLdaExt}=await import(pathToFileURL(lda).href);
    const rows=[];
    const append=s=>{
      const seq=rows.length;
      rows.push({schema:'gng.r2.pre-instruction.v1',
        kind:'pre_instruction',origin:'mame-native-tracelog',
        seq,pc:s.PC,before:s});
    };
    let secondSync=0;
    for(const start of [0x6002,0x6000]){
      let cpu=state(start);
      append(cpu);
      for(let i=0;i<500;i++){
        if(cpu.PC===0x6016)break;
        cpu=compiledStep(cpu,()=>{});
        append(cpu);
      }
      assert.equal(cpu.PC,0x6016);
      if(start===0x6002)continue; // synthetic soft reset between epochs
      secondSync=rows.length-1;
      cpu={...cpu,PC:0x6017};
      append(cpu); // synthetic masked wake; not native evidence
      const next={...cpu,PC:0x601a};
      if(address===0x6000){
        next.A=rom[0x6000];
        next.CC=(next.CC&~14)|(next.A&128?8:0)|(next.A===0?4:0);
      }else if(address===0x1e00){
        next.A=0x12;
        next.CC=(next.CC&~14)|(next.A&128?8:0)|(next.A===0?4:0);
      }
      append(next);
    }
    const sync={status:'SYNC_BYTE_AND_WAIT_BARRIER_PREPARED',
      epochs:[{},{
        sync_prestate_seq:secondSync,next_debugger_pc:'0x6017'
      }]};
    const proof={status:'PASS_BOOT_SPRITE_RAM_WRITE_BYTES',
      actual_mame_sprite_byte_writes_compared:true};
    await fn({rom,rows,sync,proof,compiledStep,executeLdaExt});
  }finally{await rm(folder,{recursive:true,force:true});}
}

test('ROM-specific LDA extended generated JS preserves C/H flags and sets NZV',async()=>{
  await fixture(0x6000,async({rom,executeLdaExt})=>{
    assert.equal(compileLdaAt(rom)?.region,'FIXED_ROM');
    const base=state(0x6017,0xd3),seen=[];
    const out=executeLdaExt(base,addr=>{seen.push(addr);return 0x80;});
    assert.deepEqual(seen,[0x6000]);
    assert.equal(out.PC,0x601a);
    assert.equal(out.A,0x80);
    assert.equal(out.CC,0xd9);
    assert.equal(base.PC,0x6017);
    assert.throws(()=>executeLdaExt(base),/READ_SOURCE_REQUIRED/);
    assert.throws(()=>executeLdaExt(base,()=>-1),/READ_VALUE_INVALID/);
    assert.throws(()=>executeLdaExt(state(0x6016),()=>0x42),/WRONG_PC/);
    const zero=executeLdaExt(base,()=>0);
    assert.equal(zero.CC,0xd5);
  });
});
test('fixed ROM load has a trusted read and matches a checkpoint under the synthetic fixture',async()=>{
  await fixture(0x6000,async(args)=>{
    const r=evaluateLdaAgainstMame(args);
    assert.equal(r.status,'MATCHED_LDA_REGISTER_CHECKPOINT_WITH_KNOWN_READ_SOURCE');
    assert.equal(r.operand_region,'FIXED_ROM');
    assert.equal(r.generated_js_step_compared,true);
    assert.equal(r.sync_wake_line_authenticated,false);
    assert.equal(r.independently_observed_bus_read,false);
    assert.equal(r.game_playable,false);
    assert.equal(r.first_divergence,null);
  });
});
test('sprite RAM was written by boot JS and is separately native-proven (synthetic stand-in)',async()=>{
  await fixture(0x1e00,async(args)=>{
    const r=evaluateLdaAgainstMame(args);
    assert.equal(r.status,'MATCHED_LDA_REGISTER_CHECKPOINT_WITH_KNOWN_READ_SOURCE');
    assert.equal(r.operand_region,'SPRITE_RAM');
    assert.equal(r.source_is_fixed_rom_or_verified_boot_sprite_ram,true);
  });
});
test('MMIO, banked and uninitialized RAM never use the MAME destination register as fake read',async()=>{
  for(const [addr,region] of [[0x3000,'INPUT_OR_MMIO'],
    [0x1000,'UNINITIALIZED_WORK_RAM'],
    [0x4000,'BANKED_ROM'],[0x2400,'VIDEO_RAM']]){
    await fixture(addr,async args=>{
      const result=evaluateLdaAgainstMame(args);
      assert.equal(result.status,'BLOCKED_UNVERIFIED_MEMORY_READ');
      assert.equal(result.operand_region,region);
      assert.equal(result.generated_js_step_compared,false);
      assert.equal(result.source_is_fixed_rom_or_verified_boot_sprite_ram,false);
    });
  }
});
test('ROM opcode must be B6 only at 0x6017; no generic binary decoder',()=>{
  const rom=romFixture();
  assert.equal(compileLdaAt(rom,0x6018),null);
  rom[0x6017]=0x86;
  assert.equal(compileLdaAt(rom),null);
  assert.throws(()=>emitLdaModule({pc:0x6017,name:'LDA_EXT',
    len:3,next:0x601a,address:0x1e00,region:'FIXED_ROM'}),
    /UNVERIFIED_SPEC/);
});
test('sprite image uses ordered events without assuming uninitialized values',()=>{
  const events=[{addr:0x1e00,data:12}];
  assert.throws(()=>finalSpriteMemory(events),
    /NEEDS_192_NATIVE_VERIFIED_WORD_WRITES/);
  assert.equal(classifyAddress(0x1e00),'SPRITE_RAM');
  assert.equal(classifyAddress(0x6000),'FIXED_ROM');
  assert.equal(classifyAddress(0x3e00),'PALETTE_OR_MMIO');
  assert.throws(()=>classifyAddress(0x10000),/BAD_ADDRESS/);
  const fake={address:0x3000,region:'INPUT_OR_MMIO'};
  assert.equal(makeTrustedRead(fake,romFixture(),new Map()),null);
});
