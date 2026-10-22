import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {compileLdaAt,emitLdaModule} from '../scripts/r3_lda_extended_gate.mjs';
import {nativeUnmapPolicy,emitStaticGngbUnmappedRead,
  verifyNativeUnmappedLda} from '../scripts/r3_unmapped_read_policy.mjs';

const cpu=(PC,A=0,CC=0x50)=>({
  PC,A,B:0,X:0,Y:0,U:0,S:0x2000,DP:0,CC
});
const snapshot=(seq,r)=>({
  schema:'gng.r2.pre-instruction.v1',kind:'pre_instruction',
  origin:'mame-native-tracelog',seq,pc:r.PC,before:r
});
function romFixture(addr=0x3c00){
  const rom=new Uint8Array(65536);
  rom[0xfffe]=0x60;rom[0xffff]=0;
  rom.set([0xb6,addr>>8,addr&255],0x6017);
  return rom;
}
function observed(policy=128,data=128,count=100){
  const lines=[
    'PROBE\tr2-mame-capability-v1',
    'R36_TARGETED_READ_ENABLED\t1',
    'R36_TARGETED_READ_ADDR\t15360',
    'R36_UNMAP_POLICY_ENABLED\t1',
    'R36_UNMAP_POLICY\t'+policy,
    'SOFT_RESET_REQUESTED\t1\t24598',
    'RESET_NOTIFICATION\t0\t24576',
  ];
  for(let i=0;i<count;i++){
    lines.push(['R36_TARGETED_READ_BYTE',1,i+1,2,24599,15360,data,255]
      .join('\t'));
  }
  lines.push('R36_TARGETED_READ_COUNT\t'+count);
  lines.push('PROBE_END\tframe-limit');
  return lines.join('\n')+'\n';
}
const proof=()=>({
  status:'PASS_BOOT_SPRITE_RAM_WRITE_BYTES',
  actual_mame_sprite_byte_writes_compared:true,
  per_boot:[{uniquely_matched:true},{uniquely_matched:true}]
});
const sync=()=>({
  status:'SYNC_BYTE_AND_WAIT_BARRIER_PREPARED',epochs:[
    {},{sync_prestate_seq:0,next_debugger_pc:'0x6017',
      irq_masked_in_sync_prestate:true,firq_masked_in_sync_prestate:true}]
});
async function fixture(fn,policy=128){
  await mkdir('out/r3',{recursive:true});
  const dir=await mkdtemp(resolve('out/r3/r36-policy-test-'));
  try{
    const rom=romFixture();
    const ldaPath=resolve(dir,'lda.mjs');
    const busPath=resolve(dir,'bus.mjs');
    await writeFile(ldaPath,emitLdaModule(compileLdaAt(rom)));
    await writeFile(busPath,emitStaticGngbUnmappedRead(policy));
    const {executeLdaExt}=await import(pathToFileURL(ldaPath).href);
    const {readGngbUnmappedByte}=await import(pathToFileURL(busPath).href);
    return await fn({
      rom,tsv:observed(policy),rows:[
        snapshot(0,cpu(0x6016)),snapshot(1,cpu(0x6017)),
        snapshot(2,cpu(0x601a,128,0x58))],
      bootProof:proof(),sync:sync(),
      executeLdaExt,readGngbUnmappedByte
    });
  }finally{await rm(dir,{recursive:true,force:true});}
}
test('native map policy is independent of all 100 taps and matches LDA through static bus rule',async()=>{
  await fixture(args=>{
    const report=verifyNativeUnmappedLda(args);
    assert.equal(report.status,
      'MAME_UNMAPPED_POLICY_MATCHES_NATIVE_TAPS_AND_STATIC_LDA');
    assert.equal(report.address_mapping,
      'SPRITE_DMA_WRITE_HANDLER_NO_CPU_READ_HANDLER');
    assert.equal(report.map_policy_observed_independently_from_tap,true);
    assert.equal(report.native_tap_count,100);
    assert.equal(report.distinct_native_tap_values,1);
    assert.equal(report.all_native_tap_values_equal_map_policy,true);
    assert.equal(report.generated_lda_checkpoint_compared,true);
    assert.equal(report.first_divergence,null);
    assert.equal(report.autonomous_read_policy_for_exact_address_validated,true);
    assert.equal(report.native_instruction_bus_event_correlated,false);
    assert.equal(report.native_irq_or_sync_wake_authenticated,false);
    assert.equal(report.game_playable,false);
    assert.equal(report.read_policy_value_exported,false);
    assert.doesNotMatch(JSON.stringify(report),/15360|0x3c00|"data":128/);
  });
});
test('MAME map policy differs from observed data: NEVER select tap value as bus policy',async()=>{
  await fixture(args=>{
    const r=verifyNativeUnmappedLda({...args,tsv:observed(127,128)});
    assert.equal(r.status,'BLOCKED_POLICY_OR_TAP_MISMATCH');
    assert.equal(r.all_native_tap_values_equal_map_policy,false);
    assert.equal(r.autonomous_read_policy_for_exact_address_validated,false);
    assert.equal(r.generated_lda_checkpoint_compared,false);
  });
});
test('bad native policy, absence, duplicate and wrong enabled flag reject',()=>{
  for(const sample of [
    observed().replace('R36_UNMAP_POLICY_ENABLED\t1','R36_UNMAP_POLICY_ENABLED\t0'),
    observed().replace('R36_UNMAP_POLICY\t128\n',''),
    observed().replace('R36_UNMAP_POLICY\t128','R36_UNMAP_POLICY\t256'),
    observed().replace('R36_UNMAP_POLICY\t128','R36_UNMAP_POLICY\tbogus'),
    observed().replace('R36_UNMAP_POLICY\t128',
      'R36_UNMAP_POLICY\t128\nR36_UNMAP_POLICY\t128'),
  ]){
    assert.throws(()=>nativeUnmapPolicy(sample),/R36_B4_/);
  }
  assert.equal(nativeUnmapPolicy(observed(0,0)),0);
  assert.equal(nativeUnmapPolicy(observed(255,255)),255);
});
test('generated JS bus handles READ of only DMA write-trigger register',async()=>{
  await fixture(args=>{
    const result=args.readGngbUnmappedByte(0x3c00);
    assert.equal(result,128);
    assert.throws(()=>args.readGngbUnmappedByte(0x3c01),
      /UNSUPPORTED_BUS_ADDRESS/);
    assert.throws(()=>args.readGngbUnmappedByte(0x3000),
      /UNSUPPORTED_BUS_ADDRESS/);
    assert.equal(args.readGngbUnmappedByte(0x3c00),result);
    assert.throws(()=>emitStaticGngbUnmappedRead(256),/INVALID_NATIVE_MAP_POLICY/);
    assert.throws(()=>emitStaticGngbUnmappedRead(-1),/INVALID_NATIVE_MAP_POLICY/);
  });
});
test('cannot use the same inferred policy for a different fixed-ROM operand',async()=>{
  await fixture(args=>{
    const rom=romFixture(0x3e00);
    assert.throws(()=>verifyNativeUnmappedLda({...args,rom}),
      /ROM_LDA_NOT_DMA_WRITE_ONLY_ADDR/);
    const noProof={...args.bootProof,actual_mame_sprite_byte_writes_compared:false};
    assert.throws(()=>verifyNativeUnmappedLda({...args,bootProof:noProof}),
      /SAME_RUN_NATIVE_BOOT_PROOF_MISSING/);
  });
});
test('native capture mode is opt-in and preserves baseline before launching MAME',async()=>{
  const lua=await readFile('scripts/r2-mame-probe.lua','utf8');
  assert.match(lua,/space\.map/);
  assert.match(lua,/map\.unmap_value/);
  assert.match(lua,/R36_UNMAP_POLICY_ENABLED/);
  const capture=await readFile('scripts/r3-mmio-read-capture.sh','utf8');
  assert.match(capture,/GNG_R36_CAPTURE_UNMAP_POLICY/);
  assert.match(capture,/probe-before-r36-mmio/);
  const one=await readFile('scripts/r3-unmapped-policy-capture.sh','utf8');
  assert.match(one,/GNG_R36_CAPTURE_UNMAP_POLICY=1/);
  assert.match(one,/scripts\/r3-mmio-read-capture\.sh/);
});
