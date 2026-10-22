import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {compileLdaAt,emitLdaModule} from '../scripts/r3_lda_extended_gate.mjs';
import {parseNativeTargetReads,analyzeNativeMmioLda}
  from '../scripts/r3_mmio_read_gate.mjs';

const address=0x3800;
function image(){
  const rom=new Uint8Array(65536);
  rom[0xfffe]=0x60;rom[0xffff]=0;
  rom.set([0xb6,0x38,0x00],0x6017);
  return rom;
}
const registers=(PC,A=0,CC=0x50)=>({
  PC,A,B:0,X:0,Y:0,U:0,S:0x2000,DP:0,CC
});
const row=(seq,r)=>({
  schema:'gng.r2.pre-instruction.v1',
  kind:'pre_instruction',origin:'mame-native-tracelog',
  seq,pc:r.PC,before:r
});
function fixtureTsv({data=128,mask=255,second=1,extraEpoch0=0}={}){
  const records=[
    'R36_TARGETED_READ_ENABLED\t1',
    'R36_TARGETED_READ_ADDR\t14336'
  ];
  let count=0;
  for(let i=0;i<extraEpoch0;i++)
    records.push(['R36_TARGETED_READ_BYTE',0,++count,0,24594,14336,data,mask].join('\t'));
  records.push('SOFT_RESET_REQUESTED\t1\t24598');
  records.push('RESET_NOTIFICATION\t0\t24576');
  for(let i=0;i<second;i++)
    records.push(['R36_TARGETED_READ_BYTE',1,++count,2,24599,14336,data,mask].join('\t'));
  records.push('R36_TARGETED_READ_COUNT\t'+count);
  records.push('PROBE_END\tframe-limit');
  return records.join('\n')+'\n';
}
async function buildModule(fn){
  await mkdir('out/r3',{recursive:true});
  const dir=await mkdtemp(resolve('out/r3/mmio-test-'));
  try{
    const file=resolve(dir,'generated-lda.mjs');
    await writeFile(file,emitLdaModule(compileLdaAt(image())));
    return await fn((await import(pathToFileURL(file).href)).executeLdaExt);
  }finally{await rm(dir,{recursive:true,force:true});}
}
const evidence=()=>{
  const before=registers(0x6017);
  const after=registers(0x601a,0x80,0x58);
  return {
    rom:image(),rows:[row(0,registers(0x6016)),row(1,before),row(2,after)],
    bootProof:{status:'PASS_BOOT_SPRITE_RAM_WRITE_BYTES',
      actual_mame_sprite_byte_writes_compared:true,
      per_boot:[{uniquely_matched:true},{uniquely_matched:true}]},
    sync:{status:'SYNC_BYTE_AND_WAIT_BARRIER_PREPARED',
      epochs:[{},{
        sync_prestate_seq:0,
        next_debugger_pc:'0x6017',
        irq_masked_in_sync_prestate:true,
        firq_masked_in_sync_prestate:true
      }]}
  };
};
test('single second-epoch native MMIO sample can agree with compiled LDA, but never proves instruction correlation',async()=>{
  await buildModule(executeLdaExt=>{
    const out=analyzeNativeMmioLda({...evidence(),
      tsv:fixtureTsv(),executeLdaExt});
    assert.equal(out.status,'SINGLE_NATIVE_READ_CONSISTENT_NOT_INSTRUCTION_CORRELATED');
    assert.equal(out.operand_region,'PALETTE_OR_MMIO');
    assert.equal(out.native_read_samples_total,1);
    assert.equal(out.native_samples_after_reset,1);
    assert.equal(out.generated_js_checkpoints_compared,true);
    assert.equal(out.first_divergence,null);
    assert.equal(out.exact_instruction_bus_correlation_verified,false);
    assert.equal(out.irq_wake_cause_authenticated,false);
    assert.equal(out.mmio_device_behavior_modeled,false);
    assert.equal(out.full_cpu_or_game_equivalence_verified,false);
    assert.equal(out.game_playable,false);
    assert.doesNotMatch(JSON.stringify(out),/14336|0x3800/);
  });
});
test('absence, duplicates, wrong masks or conflicting native data fail closed',async()=>{
  await buildModule(executeLdaExt=>{
    for(const [tsv,expected] of [
      [fixtureTsv({second:0}),'BLOCKED_NO_NATIVE_READ_SAMPLE'],
      [fixtureTsv({second:2}),'BLOCKED_AMBIGUOUS_NATIVE_MMIO_READ_SAMPLES'],
      [fixtureTsv({mask:0}),'BLOCKED_MMIO_READ_MASK_NOT_FULL_BYTE'],
      [fixtureTsv({data:127}),'FIRST_DIVERGENCE']
    ]){
      const report=analyzeNativeMmioLda({...evidence(),tsv,executeLdaExt});
      assert.equal(report.status,expected);
    }
  });
});
test('TSV enabled flag, exact address, reset epoch, count, truncation and final marker are required',()=>{
  const s=fixtureTsv();
  for(const damaged of [
    s.replace('R36_TARGETED_READ_ENABLED\t1','R36_TARGETED_READ_ENABLED\t0'),
    s.replace('R36_TARGETED_READ_ADDR\t14336','R36_TARGETED_READ_ADDR\t14337'),
    s.replace('R36_TARGETED_READ_COUNT\t1','R36_TARGETED_READ_COUNT\t2'),
    s.replace('R36_TARGETED_READ_BYTE\t1\t1','R36_TARGETED_READ_BYTE\t0\t1'),
    s.replace('R36_TARGETED_READ_BYTE\t1\t1','R36_TARGETED_READ_BYTE\t1\t2'),
    s.replace('PROBE_END\tframe-limit','PROBE_END\tcorrupted'),
    s.replace('RESET_NOTIFICATION\t0\t24576',''),
    s.replace('\t14336\t128\t255','\t14400\t128\t255'),
  ]){
    assert.throws(()=>parseNativeTargetReads(damaged,address),/R36_/);
  }
  assert.equal(parseNativeTargetReads(fixtureTsv({extraEpoch0:1}),address).total,2);
});
test('wrong opcode, unverified native sprite writes and missing MAME checkpoint are rejected',async()=>{
  await buildModule(executeLdaExt=>{
    const a=evidence();a.rom[0x6017]=0x86;
    assert.throws(()=>analyzeNativeMmioLda({...a,tsv:fixtureTsv(),executeLdaExt}),
      /NOT_ORIGINAL_MMIO_LDA/);
    const b=evidence();b.bootProof.per_boot[0].uniquely_matched=false;
    assert.throws(()=>analyzeNativeMmioLda({...b,tsv:fixtureTsv(),executeLdaExt}),
      /SAME_CAPTURE_BOOT_PROOF_MISSING/);
    const c=evidence();c.rows[2]=row(2,registers(0x601b));
    assert.throws(()=>analyzeNativeMmioLda({...c,tsv:fixtureTsv(),executeLdaExt}),
      /CHECKPOINTS_MISSING/);
  });
});
test('wrapper derives target from validated private ROM and backs up previous evidence',async()=>{
  const shell=await readFile('scripts/r3-mmio-read-capture.sh','utf8');
  assert.match(shell,/GNG_R36_TARGET_READ_ADDRESS="\$ADDR"/);
  assert.match(shell,/probe-before-r36-mmio/);
  assert.match(shell,/r3_mmio_read_gate\.mjs/);
  const lua=await readFile('scripts/r2-mame-probe.lua','utf8');
  assert.match(lua,/R36_TARGETED_READ_BYTE/);
  assert.match(lua,/R36_TARGETED_READ_COUNT/);
  assert.match(lua,/addr == target_read_address/);
});
