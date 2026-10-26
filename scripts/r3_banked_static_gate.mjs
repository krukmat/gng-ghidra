#!/usr/bin/env node
/**
 * A0.6.4: batch compile each (native BANK, PC) pair using *the existing*
 * static MC6809 compiler. No opcode interpreter, no bank guessing, and no
 * ROM or native CPU register data in the exported summary.
 *
 * Native A0.6.3 fingerprints must be independently validated with the
 * same-run source hash manifest. RAM/MMIO stores and possible external IRQ
 * boundaries are NOT reported as confirmed register+bus equivalence.
 */
import {readFile,mkdir,writeFile,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {resolve,relative,isAbsolute} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {compileAt,emitStaticModule,checkedState,diffRegisters}
  from './r3_static_trace_probe.mjs';
import {runNativeBootWriteGate} from './r3_compare_sprite_writes.mjs';
import {validateNativeBankReportDetail} from './r3_banked_report_integrity.mjs';
import {inspectNativeSyncPrestates} from './r3_sync_boundary.mjs';

export const BANK_START=0x4000,BANK_END=0x5fff,BANK_SIZE=8192;
const BANK_COUNT=5;
const HASH_REGEX=/^[0-9a-f]{64}$/;
const HEX=n=>'0x'+n.toString(16).padStart(4,'0');
export function validateFullOracleEvidence({report,oracle,rows,witness}){
  if(report?.full_oracle_status!=='A063_FULL_NATIVE_BANK_PROVENANCE_PASS'||
      report.native_bank_per_instruction_full_run_proven!==true||
      report.full_oracle_same_run_postflight_verified!==true||
      oracle?.status!=='A063_FULL_NATIVE_BANK_PROVENANCE_PASS'||
      oracle.native_bank_per_instruction_full_run_proven!==true||
      !Array.isArray(rows)||rows.length<2||!Array.isArray(witness)||
      witness.length!==rows.length)
    throw Error('A064_FULL_NATIVE_ORACLE_REQUIRED');
  let epoch=0,changes=0;
  const counts={'0':0,'1':0};
  for(const mark of witness){
    if(!Number.isSafeInteger(mark?.epoch)||mark.epoch<epoch||mark.epoch>epoch+1)
      throw Error('A064_FULL_NATIVE_EPOCH_INVALID');
    if(mark.epoch!==epoch){epoch=mark.epoch;changes++;}
    counts[String(epoch)]++;
  }
  if(witness[0].epoch!==0||epoch!==1||changes!==1)
    throw Error('A064_FULL_NATIVE_TWO_EPOCHS_REQUIRED');
  for(const evidence of [report,oracle]){
    if(evidence.rom_pair_vs_live_bank_comparisons!==rows.length||
        evidence.rom_pair_vs_live_bank_mismatch_count!==0||
        evidence.explicit_reset_epoch_count!==2||
        evidence.all_epochs_compared_without_frame_inference!==true||
        !Number.isSafeInteger(evidence.verified_post_selector_bank_transitions)||
        evidence.verified_post_selector_bank_transitions<1||
        Object.keys(evidence.native_prestate_count_by_epoch??{}).length!==2||
        Object.entries(counts).some(([e,n])=>evidence.native_prestate_count_by_epoch[e]!==n))
      throw Error('A064_FULL_NATIVE_COVERAGE_MISMATCH');
  }
  return true;
}
export function validateFullOraclePaths(locations,manifest,target='out/r3/banked-codegen'){
  const canonical={flat:'out/gngb-flat.bin',banks:'out/r3/banked-rom/private-banked-rom.bin',
    trace:'out/r2/mame-probe/pre-instruction.jsonl',rawtrace:'out/r2/mame-probe/cpu.trace',
    observations:'out/r2/mame-probe/observations.tsv',
    witness:'out/r3/banked-provenance/private-bank-per-prestate.jsonl',
    capabilities:'out/r2/mame-probe/capabilities.json',
    preflight:'out/r3/banked-provenance/private-a063-preflight.json',
    postflight:'out/r2/mame-probe/private-a063-postflight.json',
    full_oracle:'out/r2/mame-probe/private-a063-full-oracle-check.json',
    bank_report:'out/r3/banked-provenance/report.json'};
  if(resolve(target)!==resolve('out/r3/banked-codegen')||
      resolve(manifest)!==resolve('out/r3/banked-provenance/private-source-manifest.json')||
      Object.keys(locations).length!==Object.keys(canonical).length||
      Object.entries(canonical).some(([key,path])=>
        typeof locations[key]!=='string'||resolve(locations[key])!==resolve(path)))
    throw Error('A064_FULL_ORACLE_EXACT_SAME_RUN_PATHS_REQUIRED');
  return true;
}
export function compileNativeBankedPairs({
  fixed,packed,rows,witness,nativeBankReport
}){
  if(!(fixed instanceof Uint8Array)||fixed.length!==65536||
      !(packed instanceof Uint8Array)||packed.length!==BANK_COUNT*BANK_SIZE||
      !Array.isArray(rows)||!Array.isArray(witness)||rows.length!==witness.length||
      nativeBankReport?.status!=='BANK_IDENTITY_AT_EVERY_NATIVE_PRESTATE_VERIFIED'||
      nativeBankReport.native_preinstruction_samples!==rows.length||
      !nativeBankReport.native_per_instruction_mapped_ROM_signature_verified)
    throw Error('A064_SAME_RUN_NATIVE_BANK_PROVENANCE_REQUIRED');
  const sources=new Map();
  const grouped=new Map();
  const counts=new Map();
  let bankedSamples=0;
  for(let i=0;i<rows.length;i++){
    const row=rows[i],mark=witness[i];
    if(row?.schema!=='gng.r2.pre-instruction.v1'||
        row.kind!=='pre_instruction'||
        row.origin!=='mame-native-tracelog'||
        row.seq!==i||!Number.isInteger(row.pc)||
        row.pc<0||row.pc>65535||row.before?.PC!==row.pc||
        mark?.seq!==i||mark?.pc!==row.pc||
        !Number.isInteger(mark.bank)||mark.bank<0||mark.bank>=BANK_COUNT)
      throw Error('A064_NATIVE_WITNESS_SEQUENCE_OR_BANK_INVALID');
    checkedState(row.before);
    if(row.pc<BANK_START||row.pc>BANK_END)continue;
    bankedSamples++;
    let image=sources.get(mark.bank);
    if(!image){
      image=Uint8Array.from(fixed);
      image.set(packed.subarray(mark.bank*BANK_SIZE,(mark.bank+1)*BANK_SIZE),
        BANK_START);
      sources.set(mark.bank,image);
    }
    const key=mark.bank+':'+row.pc;
    if(!grouped.has(key)){
      const spec=compileAt(image,row.pc,{banked:true});
      grouped.set(key,{
        bank:mark.bank,pc:row.pc,spec,
        classification:spec?.name??'UNSUPPORTED_BANKED_OPCODE',
        source:'AUTHENTIC_BANKED_ROM_IMAGE'
      });
    }
    counts.set(key,(counts.get(key)??0)+1);
  }
  if(bankedSamples<1||
      bankedSamples!==nativeBankReport.bank_window_pc_samples||
      bankedSamples!==nativeBankReport.native_banked_prestate_bank_identified||
      grouped.size!==nativeBankReport.distinct_observed_bank_pc_pairs)
    throw Error('A064_BANKED_NATIVE_COVERAGE_REPORT_MISMATCH');
  const groups=[...grouped.values()]
    .sort((a,b)=>a.bank-b.bank||a.pc-b.pc);
  // Totals alone can conceal a swapped bank/PC attribution. Require
  // the full A0.6.3 histogram to match this same-run witness.
  validateNativeBankReportDetail({report:nativeBankReport,groups,counts,bankedSamples});
  const byBank=new Map();
  for(const g of groups){
    if(!g.spec)continue;
    const collection=byBank.get(g.bank)??[];
    collection.push(g.spec);byBank.set(g.bank,collection);
  }
  return {groups,counts,byBank,bankedSamples};
}
export function verifyNativeBankedStaticSteps({
  rows,witness,compiled,compiledByBank
}){
  if(!Array.isArray(rows)||!Array.isArray(witness)||
      !Array.isArray(compiled?.groups)||!(compiledByBank instanceof Map))
    throw Error('A064_INVALID_NATIVE_BANKED_COMPARISON');
  const compiledPairs=new Map(compiled.groups.map(g=>[g.bank+':'+g.pc,g]));
  let supported=0,matching=0,divergent=0,uncompiled=0,effectful=0,
    needsNextBoundary=0;
  let firstDivergence=null;
  for(let i=0;i<rows.length;i++){
    const row=rows[i],entry=witness[i];
    if(row.pc<BANK_START||row.pc>BANK_END)continue;
    const g=compiledPairs.get(entry.bank+':'+row.pc);
    if(!g?.spec){uncompiled++;continue;}
    supported++;
    if(g.spec.writesSpriteWord||g.spec.writesRamByte){
      effectful++;continue;
    }
    // Last row has no independent following prestate.
    if(i+1>=rows.length||
        (entry.epoch!==undefined&&entry.epoch!==witness[i+1]?.epoch)){
      needsNextBoundary++;continue;
    }
    const runner=compiledByBank.get(entry.bank);
    if(typeof runner!=='function')
      throw Error('A064_BANK_STATIC_MODULE_NOT_GENERATED');
    let result;
    try{
      result=runner(row.before,()=>{
        throw Error('A064_MEMORY_EFFECT_REQUIRES_NATIVE_GATE');
      },()=>{
        throw Error('A064_MEMORY_EFFECT_REQUIRES_NATIVE_GATE');
      });
    }catch(err){
      throw Error('A064_STATIC_BANKED_CODE_FAILED '+err.message);
    }
    const diff=diffRegisters(result,rows[i+1].before);
    if(diff.length){
      divergent++;
      firstDivergence??={
        bank:entry.bank,pc:HEX(row.pc),
        mismatched_register_fields:diff,
        external_cpu_event_or_unmodeled_effect_possible:true
      };
    }else matching++;
  }
  const all=compiled.bankedSamples;
  if(supported+uncompiled!==all)
    throw Error('A064_SAMPLE_PARTITION_INVALID');
  return {
    schema:'gng.a06.static-banked-pc-codegen.v1',
    status:divergent?'BANKED_STATIC_CPU_OR_EXTERNAL_EVENT_DIVERGENCE':
      supported===0?'BANKED_OPCODE_FAMILIES_UNSUPPORTED':
      'BANKED_CODEGEN_WITH_NATIVE_CHECKPOINT_PREFIX_ONLY',
    native_bank_window_samples:all,
    native_bank_pc_pairs:compiled.groups.length,
    bank_pc_pairs_with_static_codegen:compiled.groups.filter(g=>g.spec).length,
    native_samples_with_static_codegen:supported,
    native_samples_without_static_codegen:uncompiled,
    native_samples_with_unverified_memory_effects:effectful,
    independently_matched_register_checkpoints:matching,
    differing_register_checkpoints:divergent,
    missing_next_native_checkpoint:needsNextBoundary,
    first_divergence:firstDivergence,
    candidate_families:compiled.groups.map(g=>({
      bank:g.bank,pc:HEX(g.pc),opcode_family:g.classification,
      native_samples:compiled.counts.get(g.bank+':'+g.pc),
      static_codegen_available:!!g.spec,
      memory_effect_not_independently_verified:
        !!(g.spec?.writesRamByte||g.spec?.writesSpriteWord)
    })),
    cpu_starts_each_individual_step_from_native_prestate:true,
    bank_per_instruction_mapped_rom_verified:true,
    native_cpu_fetch_transaction_correlated:false,
    native_irq_sync_resume_verified:false,
    autonomous_runtime_or_first_frame_verified:false,
    raw_banked_rom_opcodes_values_exported:false,
    game_playable:false,
    next_task:'Extend unsupported frequent banked opcode families and certify RAM/MMIO or IRQ effects before continuous AOT CPU execution'
  };
}
async function main(){
  const argv=process.argv.slice(2);
  const arg=(flag,fallback)=>{const i=argv.indexOf(flag);return i<0?fallback:argv[i+1];};
  const target=resolve(arg('--out','out/r3/banked-codegen'));
  const rel=relative(resolve('out/r3'),target);
  if(!rel||rel==='..'||rel.startsWith('../')||isAbsolute(rel))
    throw Error('A064_PRIVATE_OUTPUT_REQUIRED');
  try{
    await lstat(target);
    throw Error('A064_OUTPUT_EXISTS_PRESERVE_PRIOR_EVIDENCE');
  }catch(error){if(error.code!=='ENOENT')throw error;}
  const locations={
    flat:arg('--flat','out/gngb-flat.bin'),
    banks:arg('--banks','out/r3/banked-rom/private-banked-rom.bin'),
    trace:arg('--trace','out/r2/mame-probe/pre-instruction.jsonl'),
    rawtrace:arg('--rawtrace','out/r2/mame-probe/cpu.trace'),
    observations:arg('--observations','out/r2/mame-probe/observations.tsv'),
    witness:arg('--witness','out/r3/banked-provenance/private-bank-per-prestate.jsonl'),
    capabilities:arg('--capabilities','out/r2/mame-probe/capabilities.json'),
    preflight:arg('--preflight','out/r3/banked-provenance/private-a063-preflight.json'),
    postflight:arg('--postflight','out/r2/mame-probe/private-a063-postflight.json'),
    full_oracle:arg('--full-oracle-check','out/r2/mame-probe/private-a063-full-oracle-check.json'),
    bank_report:arg('--bank-report','out/r3/banked-provenance/report.json')
  };
  const manifestPath=arg('--manifest',
    'out/r3/banked-provenance/private-source-manifest.json');
  validateFullOraclePaths(locations,manifestPath,target);
  if(!(await lstat(manifestPath)).isFile())
    throw Error('A064_PRIVATE_REGULAR_FILE_REQUIRED');
  const manifest=JSON.parse(await readFile(manifestPath,'utf8'));
  if(manifest.schema!=='gng.a06.private-bank-evidence-manifest.v1'||
      manifest.full_oracle_same_run_postflight_verified!==true)
    throw Error('A064_PRIVATE_NATIVE_SOURCE_MANIFEST_REQUIRED');
  const buffers={};
  for(const [key,path] of Object.entries(locations)){
    const expected=manifest.sha256?.[key];
    if(typeof expected!=='string'||!HASH_REGEX.test(expected))
      throw Error('A064_PRIVATE_SOURCE_HASH_MISSING');
    if(!(await lstat(path)).isFile())throw Error('A064_PRIVATE_REGULAR_FILE_REQUIRED');
    const bytes=await readFile(path);
    if(createHash('sha256').update(bytes).digest('hex')!==expected)
      throw Error('A064_STALE_OR_REPLACED_NATIVE_EVIDENCE_'+key);
    buffers[key]=bytes;
  }
  const binary=arg('--mame-bin',process.env.GNG_R3_MAME_BIN);
  if(typeof binary!=='string'||!binary.includes('/'))
    throw Error('A064_FULL_ORACLE_BINARY_REQUIRED');
  const chain=spawnSync('python3',['scripts/a063_capture_integrity.py','--verify',
    '--output',resolve('out/r2/mame-probe'),'--preflight',locations.preflight,
    '--mame-bin',binary],{encoding:'utf8',timeout:30000});
  if(chain.status!==0)throw Error('A064_FULL_ORACLE_POSTFLIGHT_INVALID');
  const report=JSON.parse(buffers.bank_report.toString('utf8'));
  const rows=buffers.trace.toString('utf8').trimEnd()
    .split('\n').map(JSON.parse);
  const witness=buffers.witness.toString('utf8').trimEnd()
    .split('\n').map(JSON.parse);
  validateFullOracleEvidence({report,oracle:JSON.parse(buffers.full_oracle),rows,witness});
  const boot=await runNativeBootWriteGate({
    romPath:locations.flat,tracePath:locations.trace,
    observationsPath:locations.observations,
    capabilitiesPath:locations.capabilities,
    outDir:resolve(target,'same-run-native-boot')
  });
  if(boot.status!=='PASS_BOOT_SPRITE_RAM_WRITE_BYTES'||
      boot.actual_mame_sprite_byte_writes_compared!==true)
    throw Error('A064_NATIVE_BOOT_GATE_BLOCKED');
  inspectNativeSyncPrestates(new Uint8Array(buffers.flat),rows,boot);
  const compiled=compileNativeBankedPairs({
    fixed:new Uint8Array(buffers.flat),
    packed:new Uint8Array(buffers.banks),rows,witness,nativeBankReport:report
  });
  await mkdir(target,{recursive:true});
  const compiledByBank=new Map();
  for(const [bank,specs] of compiled.byBank){
    const file=resolve(target,'private-generated-bank-'+bank+'.mjs');
    await writeFile(file,emitStaticModule(specs));
    const {compiledStep}=await import(pathToFileURL(file).href);
    compiledByBank.set(bank,compiledStep);
  }
  const result=verifyNativeBankedStaticSteps({
    rows,witness,compiled,compiledByBank
  });
  result.full_native_bank_oracle_same_run_verified=true;
  await writeFile(resolve(target,'report.json'),JSON.stringify(result,null,2)+'\n');
  console.log('A064_BANKED_STATIC='+result.status);
  console.log('A064_MATCHED_REGISTER_CHECKPOINTS='+result.independently_matched_register_checkpoints);
  console.log('A064_DIFFERING_REGISTER_CHECKPOINTS='+result.differing_register_checkpoints);
  if(result.status==='BANKED_STATIC_CPU_OR_EXTERNAL_EVENT_DIVERGENCE')
    process.exitCode=2;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(error=>{
    console.error('A064_BANKED_STATIC=BLOCKED '+error.message);
    process.exitCode=2;
  });
