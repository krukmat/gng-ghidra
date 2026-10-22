#!/usr/bin/env node
/**
 * R3.6.B3: offline analysis of all native exact-target MMIO reads captured
 * in R3.6.B2. Does NOT select a convenient sample, synthesize a bus value,
 * or certify which CPU instruction issued any tap callback.
 *
 * Native gngb memory map source:
 * https://github.com/mamedev/mame/blob/master/src/mame/capcom/gng.cpp
 * gng_state::gng_main_map has write-only mappings in 0x3800..0x3fff,
 * and no explicit read handlers there. The default bus read response
 * is NOT derived from that fact and is NOT modeled in the runtime here.
 */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,relative,isAbsolute} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {compileLdaAt,emitLdaModule} from './r3_lda_extended_gate.mjs';
import {parseNativeTargetReads} from './r3_mmio_read_gate.mjs';
import {runNativeBootWriteGate} from './r3_compare_sprite_writes.mjs';
import {inspectNativeSyncPrestates} from './r3_sync_boundary.mjs';
import {checkedState,diffRegisters} from './r3_static_trace_probe.mjs';

export function classifyGngbReadMapping(addr){
  if(!Number.isInteger(addr)||addr<0x3800||addr>0x3fff)
    throw Error('R36_B3_ADDRESS_OUTSIDE_GNGB_MMIO');
  let driver_mapping='NO_EXPLICIT_READ_HANDLER';
  if(addr<=0x38ff)driver_mapping='PALETTE_EXT_WRITE_HANDLER';
  else if(addr<=0x39ff)driver_mapping='PALETTE_BASE_WRITE_HANDLER';
  else if(addr===0x3a00)driver_mapping='SOUND_LATCH_WRITE_HANDLER';
  else if(addr===0x3b08||addr===0x3b09)
    driver_mapping='BG_SCROLL_X_WRITE_HANDLER';
  else if(addr===0x3b0a||addr===0x3b0b)
    driver_mapping='BG_SCROLL_Y_WRITE_HANDLER';
  else if(addr===0x3c00)driver_mapping='SPRITE_DMA_WRITE_HANDLER';
  else if(addr>=0x3d00&&addr<=0x3d07)
    driver_mapping='MAIN_LATCH_WRITE_HANDLER';
  else if(addr===0x3e00)driver_mapping='BANK_SELECT_WRITE_HANDLER';
  return {driver_mapping,
    explicit_cpu_read_handler_in_gng_main_map:false,
    default_unmapped_read_value_verified:false};
}
export function diagnoseNativeReadMultiplicity({
  rom,rows,bootProof,sync,tsv,executeLdaExt
}){
  const spec=compileLdaAt(rom);
  if(spec?.region!=='PALETTE_OR_MMIO')
    throw Error('R36_B3_NOT_FIXED_ROM_MMIO_LDA');
  if(bootProof?.status!=='PASS_BOOT_SPRITE_RAM_WRITE_BYTES'||
      bootProof.actual_mame_sprite_byte_writes_compared!==true||
      !Array.isArray(bootProof.per_boot)||bootProof.per_boot.length!==2||
      bootProof.per_boot.some(x=>x.uniquely_matched!==true))
    throw Error('R36_B3_SAME_RUN_NATIVE_BOOT_PROOF_MISSING');
  if(sync?.status!=='SYNC_BYTE_AND_WAIT_BARRIER_PREPARED'||
      sync.epochs?.length!==2||
      sync.epochs[1]?.next_debugger_pc!=='0x6017'||
      !sync.epochs[1]?.irq_masked_in_sync_prestate||
      !sync.epochs[1]?.firq_masked_in_sync_prestate)
    throw Error('R36_B3_POST_SYNC_PROVENANCE_MISSING');
  const seq=sync.epochs[1].sync_prestate_seq+1;
  const before=rows[seq],after=rows[seq+1];
  if(before?.seq!==seq||before?.pc!==0x6017||
      after?.seq!==seq+1||after?.pc!==0x601a)
    throw Error('R36_B3_NATIVE_INSTRUCTION_BOUNDARY_MISSING');
  checkedState(before.before);checkedState(after.before);
  if(typeof executeLdaExt!=='function')
    throw Error('R36_B3_GENERATED_STATIC_JS_REQUIRED');
  const sampled=parseNativeTargetReads(tsv,spec.address);
  const events=sampled.epochs[1];
  const uniqueValues=[...new Set(events.map(x=>x.data))];
  const fullByteMasks=events.every(x=>x.mask===255);
  const mapping=classifyGngbReadMapping(spec.address);
  let consistentValues=0,consistentSamples=0;
  let mismatchedFields=[];
  if(fullByteMasks){
    for(const value of uniqueValues){
      const output=executeLdaExt(before.before,addr=>{
        if(addr!==spec.address)throw Error('R36_B3_LDA_OPERAND_ADDRESS_DRIFT');
        return value;
      });
      const diff=diffRegisters(output,after.before);
      if(diff.length===0){
        consistentValues++;
        consistentSamples+=events.filter(e=>e.data===value).length;
      }else{
        mismatchedFields=[...new Set([...mismatchedFields,...diff])];
      }
    }
  }
  const uniform=events.length>0&&uniqueValues.length===1;
  let status='BLOCKED_NO_POST_RESET_TARGET_READS';
  if(events.length>0&&!fullByteMasks)
    status='BLOCKED_NON_FULL_BYTE_NATIVE_READ_MASK';
  else if(events.length>0&&uniform&&consistentValues===1)
    status='UNIFORM_NATIVE_READS_REGISTER_CONSISTENT_BUS_CAUSE_UNVERIFIED';
  else if(events.length>0&&uniform)
    status='UNIFORM_NATIVE_READS_REGISTER_DISAGREEMENT_CAUSE_UNVERIFIED';
  else if(events.length>0&&consistentValues>0)
    status='VARIABLE_NATIVE_READS_SOME_CHECKPOINT_CONSISTENT_NOT_CAUSAL';
  else if(events.length>0)
    status='VARIABLE_NATIVE_READS_NONE_CHECKPOINT_CONSISTENT';
  return {
    schema:'gng.r3.lda-mmio-multiplicity-diagnostic.v1',
    status,
    instruction_pc:'0x6017',
    native_next_pc:'0x601a',
    native_checkpoint_seq:seq,
    region:'PALETTE_OR_MMIO',
    driver_mapping:mapping.driver_mapping,
    explicit_cpu_read_handler_in_gng_main_map:false,
    default_unmapped_read_value_verified:false,
    native_exact_target_read_count:sampled.total,
    reads_before_reset:sampled.epochs[0].length,
    reads_after_reset:events.length,
    all_second_epoch_masks_full_byte:fullByteMasks,
    distinct_second_epoch_read_values:uniqueValues.length,
    all_second_epoch_read_values_same:uniform,
    distinct_values_consistent_with_next_register_checkpoint:consistentValues,
    sample_count_consistent_with_next_register_checkpoint:consistentSamples,
    mismatched_register_fields_redacted:mismatchedFields,
    generated_static_lda_evaluated_for_all_distinct_values:fullByteMasks,
    raw_values_or_operand_address_exported:false,
    native_bus_read_to_instruction_provenance_verified:false,
    autonomous_device_read_model_implemented:false,
    wake_irq_line_verified:false,
    game_playable:false,
    next_task:uniform&&consistentValues===1?
      'Determine native memory-space unmapped-read policy and bind actual bus read to PC 0x6017 before implementing an autonomous device rule':
      'Instrument instruction-scoped bus provenance; never select a matching read from a variable or invalid sample set',
  };
}
async function main(){
  const argv=process.argv.slice(2);
  const arg=(name,def)=>{const i=argv.indexOf(name);return i<0?def:argv[i+1];};
  const target=resolve(arg('--out','out/r3/mmio-read-diagnostics'));
  const rel=relative(resolve('out/r3'),target);
  if(!rel||rel==='..'||rel.startsWith('../')||isAbsolute(rel))
    throw Error('R36_B3_PRIVATE_OUTPUT_REQUIRED');
  const romPath=arg('--rom','out/gngb-flat.bin');
  const tracePath=arg('--trace','out/r2/mame-probe/pre-instruction.jsonl');
  const observationsPath=arg('--observations','out/r2/mame-probe/observations.tsv');
  const bootProof=await runNativeBootWriteGate({
    romPath,tracePath,observationsPath,
    capabilitiesPath:arg('--capabilities','out/r2/mame-probe/capabilities.json'),
    outDir:resolve(target,'same-run-verified-boot')});
  const rom=new Uint8Array(await readFile(romPath));
  const rows=(await readFile(tracePath,'utf8')).trimEnd().split('\n')
    .map(JSON.parse);
  const sync=inspectNativeSyncPrestates(rom,rows,bootProof);
  const spec=compileLdaAt(rom);
  if(!spec||spec.region!=='PALETTE_OR_MMIO')
    throw Error('R36_B3_FIXED_ROM_OPCODE_OR_MMIO_OPERAND_NOT_VERIFIED');
  await mkdir(target,{recursive:true});
  const modulePath=resolve(target,'static-lda.mjs');
  await writeFile(modulePath,emitLdaModule(spec));
  const {executeLdaExt}=await import(pathToFileURL(modulePath).href);
  const report=diagnoseNativeReadMultiplicity({
    rom,rows,bootProof,sync,
    tsv:await readFile(observationsPath,'utf8'),
    executeLdaExt});
  await writeFile(resolve(target,'report.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
  // A uniform-consistent sample is a useful DIAGNOSTIC, not a game PASS.
  if(!report.status.startsWith('UNIFORM_NATIVE_READS_REGISTER_CONSISTENT'))
    process.exitCode=2;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(error=>{
    console.error('GNG_R36_B3_DIAGNOSTIC=BLOCKED '+error.message);
    process.exitCode=2;
  });
}
