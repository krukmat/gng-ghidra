import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compileAt,emitStaticModule,diffRegisters}
  from '../scripts/r3_static_trace_probe.mjs';
import {deriveBootWrites,splitNativeSpriteObservations,
  compareNativeWithCompiledBoot} from '../scripts/r3_compare_sprite_writes.mjs';
import {mkdir,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const resetRom=()=>{
  const rom=new Uint8Array(65536);
  rom[0xfffe]=0x60;rom[0xffff]=0;
  rom.set([0x1a,0x50,0x8e,0x1e,0x00,0x10,0x8e,0x00,0x60,
    0xcc,0x12,0x34,0xed,0x81,0xed,0x81,0x31,0x3f,0x26,0xf8],0x6000);
  return rom;
};
function row(seq,before){return {schema:'gng.r2.pre-instruction.v1',
  kind:'pre_instruction',origin:'mame-native-tracelog',
  seq,pc:before.PC,before};}
function firstState(pc){return {PC:pc,A:0,B:0,X:0,Y:0,U:0,
  S:0x2000,DP:0,CC:0x80};}
const caps={status:'PARTIAL_NATIVE_INSTRUMENTATION',
  real_mame_execution_observed:true,capabilities:{
    controlled_soft_reset_observed:true}};
async function syntheticNativeFixture(body){
  await mkdir('out/r3',{recursive:true});
  const dir=await mkdtemp(resolve('out/r3/sprite-test-'));
  try{
    const rom=resetRom();
    const pcs=[0x6000,0x6002,0x6005,0x6009,0x600c,0x600e,0x6010,0x6012];
    const code=emitStaticModule(pcs.map(pc=>compileAt(rom,pc)));
    const file=resolve(dir,'fake-compiled.mjs');
    await writeFile(file,code);
    const {compiledStep}=await import(pathToFileURL(file).href);
    let seq=0;
    const rows=[];
    const events=[];
    for(const startingPc of [0x6002,0x6000]){
      let state=firstState(startingPc);
      rows.push(row(seq++,state));
      while(state.PC!==0x6014){
        const current=state;
        state=compiledStep(state,(addr,word)=>{
          events.push({addr,data:(word>>8)&255,mask:255});
          events.push({addr:addr+1,data:word&255,mask:255});
        });
        if(state.PC!==0x6014)rows.push(row(seq++,state));
        if(rows.length>2000)throw Error('bad fixture');
        assert.ok(!diffRegisters(current,current).length);
      }
      rows.push(row(seq++,state));
      // Separate reset runs by a fake sentinel row which remains outside boot.
      if(startingPc===0x6002){
        const sentinel={...state,PC:0x7000};
        rows.push(row(seq++,sentinel));
      }
    }
    const expectedBytes=192*2;
    assert.equal(events.length,expectedBytes*2);
    const one=events.slice(0,expectedBytes);
    const two=events.slice(expectedBytes);
    const samples=e=>e.map(x=>
      ['SPRITE_RAM_WRITE_BYTE',x.addr,x.data,x.mask].join('\t')).join('\n')+'\n';
    const tsv='SPRITE_RAM_TAP_ENABLED\t1\n'+samples(one)+
      'SOFT_RESET_REQUESTED\t1\t24576\nRESET_NOTIFICATION\t0\t24576\n'+
      samples(two)+
      'OBSERVED_SPRITE_RAM_WRITE_COUNT\t'+events.length+'\n';
    return await body({rows,compiledStep,one,two,tsv});
  } finally {await rm(dir,{recursive:true,force:true});}
}

test('real-structure two boot loops produce exactly 192 compiled words each',async()=>{
  await syntheticNativeFixture(({rows,compiledStep})=>{
    const r=deriveBootWrites(rows,compiledStep);
    assert.equal(r.length,2);
    assert.deepEqual(r.map(x=>x.wordWrites),[192,192]);
    assert.equal(r[0].startSeq,0);
    assert.ok(r[1].startSeq>r[0].startSeq);
    assert.equal(r[0].events[0].addr,0x1e00);
    assert.equal(r[0].events.at(-1).addr,0x1f7f);
  });
});
test('same-run native 8-bit writes match compiled JS byte order in both epochs',async()=>{
  await syntheticNativeFixture(({rows,compiledStep,tsv})=>{
    const result=compareNativeWithCompiledBoot(rows,tsv,compiledStep,caps);
    assert.equal(result.status,'PASS_BOOT_SPRITE_RAM_WRITE_BYTES');
    assert.equal(result.compiled_sprite_ram_word_writes,384);
    assert.equal(result.native_sprite_byte_samples,768);
    assert.ok(result.per_boot.every(x=>x.uniquely_matched));
    assert.equal(result.actual_mame_sprite_byte_writes_compared,true);
    assert.equal(result.full_game_equivalence_verified,false);
    assert.equal(result.all_ram_or_cpu_bus_operations_verified,false);
    assert.doesNotMatch(JSON.stringify(result),/4660|7680/);
  });
});
test('wrong native write byte or swapped order blocks comparison',async()=>{
  await syntheticNativeFixture(({rows,compiledStep,tsv})=>{
    const changed=tsv.replace('SPRITE_RAM_WRITE_BYTE\t7680\t18\t255',
      'SPRITE_RAM_WRITE_BYTE\t7680\t19\t255');
    const result=compareNativeWithCompiledBoot(rows,changed,compiledStep,caps);
    assert.equal(result.status,'BLOCKED_NATIVE_BOOT_SPRITE_RAM_DIFFERENTIAL');
    assert.equal(result.per_boot[0].reason,'NO_COMPLETE_ORDERED_BYTE_MATCH');
  });
});
test('extra native writes outside boot are not silently interpreted as bus equivalence',async()=>{
  await syntheticNativeFixture(({rows,compiledStep,tsv})=>{
    const expanded=tsv.replace('SOFT_RESET_REQUESTED\t',
      'SPRITE_RAM_WRITE_BYTE\t8000\t4\t255\nSOFT_RESET_REQUESTED\t')
      .replace('OBSERVED_SPRITE_RAM_WRITE_COUNT\t768',
        'OBSERVED_SPRITE_RAM_WRITE_COUNT\t769');
    const r=compareNativeWithCompiledBoot(rows,expanded,compiledStep,caps);
    assert.equal(r.status,'PASS_BOOT_SPRITE_RAM_WRITE_BYTES');
    assert.equal(r.per_boot[0].unverified_other_native_writes,1);
    assert.equal(r.all_ram_or_cpu_bus_operations_verified,false);
  });
});
test('partial native tap, disabled capture, ambiguous reset and wrong masks reject',async()=>{
  await syntheticNativeFixture(({rows,compiledStep,tsv})=>{
    const cases=[
      tsv.replace('OBSERVED_SPRITE_RAM_WRITE_COUNT\t768',
        'OBSERVED_SPRITE_RAM_WRITE_COUNT\t999'),
      tsv.replace('SPRITE_RAM_TAP_ENABLED\t1',
        'SPRITE_RAM_TAP_ENABLED\t0'),
      tsv.replace('RESET_NOTIFICATION\t0\t24576\n',''),
    ];
    for(const evidence of cases){
      assert.throws(()=>compareNativeWithCompiledBoot(
        rows,evidence,compiledStep,caps),/R3_/);
    }
    const corruptMask=tsv.replace('SPRITE_RAM_WRITE_BYTE\t7680\t18\t255',
      'SPRITE_RAM_WRITE_BYTE\t7680\t18\t0');
    assert.equal(compareNativeWithCompiledBoot(rows,corruptMask,
      compiledStep,caps).status,'BLOCKED_NATIVE_BOOT_SPRITE_RAM_DIFFERENTIAL');
    assert.throws(()=>compareNativeWithCompiledBoot(rows,tsv,compiledStep,
      {...caps,capabilities:{controlled_soft_reset_observed:false}}),
      /RESET_PROVENANCE/);
  });
});
test('false full RAM equivalence can never be inferred from native sprite writes',async()=>{
  await syntheticNativeFixture(({rows,compiledStep,tsv})=>{
    const r=compareNativeWithCompiledBoot(rows,tsv,compiledStep,caps);
    assert.equal(r.actual_mame_sprite_byte_writes_compared,true);
    assert.equal(r.irq_sync_bank_edges_verified,false);
    assert.equal(r.full_game_equivalence_verified,false);
  });
});
