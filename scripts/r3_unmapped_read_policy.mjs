#!/usr/bin/env node
/**
 * R3.6.B4. Map-policy sourced static JS read for the *one* gngb 0x3c00
 * write-only register.  The value comes from MAME's native address-space
 * map.unmap_value property, not from choosing a convenient read sample nor
 * from the MAME destination register A.
 *
 * Map source: src/mame/capcom/gng.cpp gng_main_map:
 *   map(0x3c00, 0x3c00).w(m_spriteram, ...::write)
 * and MAME Lua space.map.unmap_value (docs/luascript/ref-mem.html).
 *
 * Distinct gates: map configuration, 100 actual tap reads, static LDA and
 * MAME register checkpoint.  These do NOT prove SYNC wake, IRQ, or full bus.
 */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,relative,isAbsolute} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {runNativeBootWriteGate} from './r3_compare_sprite_writes.mjs';
import {inspectNativeSyncPrestates} from './r3_sync_boundary.mjs';
import {compileLdaAt,emitLdaModule} from './r3_lda_extended_gate.mjs';
import {parseNativeTargetReads} from './r3_mmio_read_gate.mjs';
import {diagnoseNativeReadMultiplicity,classifyGngbReadMapping}
  from './r3_mmio_read_diagnostics.mjs';
import {checkedState,diffRegisters} from './r3_static_trace_probe.mjs';

const TARGET=0x3c00;
export function nativeUnmapPolicy(tsv){
  if(typeof tsv!=='string')throw Error('R36_B4_NATIVE_TSV_REQUIRED');
  let enabled=0,policy=null;
  for(const line of tsv.trimEnd().split('\n')){
    const [tag,...fields]=line.split('\t');
    if(tag==='R36_UNMAP_POLICY_ENABLED'){
      if(fields.length!==1||fields[0]!=='1'||enabled++)
        throw Error('R36_B4_NATIVE_POLICY_NOT_ENABLED');
    }else if(tag==='R36_UNMAP_POLICY'){
      if(fields.length!==1||policy!==null||
          !/^(0|[1-9][0-9]*)$/.test(fields[0]))
        throw Error('R36_B4_NATIVE_POLICY_MALFORMED');
      const v=Number(fields[0]);
      if(!Number.isInteger(v)||v<0||v>255)
        throw Error('R36_B4_NATIVE_POLICY_OUT_OF_BYTE_RANGE');
      policy=v;
    }
  }
  if(enabled!==1||policy===null)
    throw Error('R36_B4_NATIVE_MAP_POLICY_MISSING');
  return policy;
}
export function emitStaticGngbUnmappedRead(policy){
  if(!Number.isInteger(policy)||policy<0||policy>255)
    throw Error('R36_B4_INVALID_NATIVE_MAP_POLICY');
  return [
    '// Private generated gngb 8-bit program-bus configuration.',
    '// 0x3c00 has a write-only DMA trigger, but no CPU read handler.',
    '// The read response is MAME program-map unmap_value, independently',
    '// verified against the full native read tap sample distribution.',
    'export function readGngbUnmappedByte(address){',
    "  if(address!==0x3c00)throw Error('R36_B4_UNSUPPORTED_BUS_ADDRESS');",
    '  return '+policy+';',
    '}',
    ''
  ].join('\n');
}
export function verifyNativeUnmappedLda({
  rom,rows,bootProof,sync,tsv,executeLdaExt,readGngbUnmappedByte
}){
  const spec=compileLdaAt(rom);
  if(spec?.address!==TARGET||spec.region!=='PALETTE_OR_MMIO'||
      classifyGngbReadMapping(spec.address).driver_mapping!==
      'SPRITE_DMA_WRITE_HANDLER')
    throw Error('R36_B4_ROM_LDA_NOT_DMA_WRITE_ONLY_ADDR');
  const b3=diagnoseNativeReadMultiplicity({
    rom,rows,bootProof,sync,tsv,executeLdaExt
  });
  const policy=nativeUnmapPolicy(tsv);
  const tap=parseNativeTargetReads(tsv,spec.address);
  const events=tap.epochs[1];
  const mapMatchesSamples=events.length>0&&
    events.every(e=>e.mask===255&&e.data===policy);
  const seq=sync.epochs[1].sync_prestate_seq+1;
  const before=rows[seq],after=rows[seq+1];
  if(before?.pc!==0x6017||after?.pc!==0x601a)
    throw Error('R36_B4_NATIVE_CHECKPOINT_MISSING');
  checkedState(before.before);checkedState(after.before);
  if(typeof readGngbUnmappedByte!=='function')
    throw Error('R36_B4_STATIC_BUS_MODULE_MISSING');
  const report={
    schema:'gng.r3.unmapped-program-read-policy.v1',
    status:'BLOCKED_POLICY_OR_TAP_MISMATCH',
    instruction_pc:'0x6017',
    next_pc:'0x601a',
    address_mapping:'SPRITE_DMA_WRITE_HANDLER_NO_CPU_READ_HANDLER',
    map_policy_observed_independently_from_tap:true,
    native_tap_count:tap.total,
    native_second_epoch_tap_count:events.length,
    distinct_native_tap_values:b3.distinct_second_epoch_read_values,
    all_native_tap_values_equal_map_policy:mapMatchesSamples,
    read_policy_value_exported:false,
    static_bus_module_generated:true,
    static_bus_value_source:'NATIVE_MAME_PROGRAM_MAP_UNMAP_VALUE',
    generated_lda_checkpoint_compared:false,
    native_instruction_bus_event_correlated:false,
    native_irq_or_sync_wake_authenticated:false,
    autonomous_read_policy_for_exact_address_validated:false,
    full_bus_or_game_equivalence_verified:false,
    game_playable:false,
    next_task:'Verify native instruction-specific read causality and resume path, then identify the next ROM instruction',
  };
  if(!mapMatchesSamples ||
      b3.status!=='UNIFORM_NATIVE_READS_REGISTER_CONSISTENT_BUS_CAUSE_UNVERIFIED')
    return report;
  // This independent bus callback does not accept MAME A or a tap-sample
  // value. It is generated solely from the read-only MAME map policy.
  const predicted=executeLdaExt(before.before,address=>
    readGngbUnmappedByte(address));
  const divergence=diffRegisters(predicted,after.before);
  report.generated_lda_checkpoint_compared=true;
  report.first_divergence=divergence.length?{fields:divergence}:null;
  report.status=divergence.length?'BLOCKED_STATIC_LDA_CHECKPOINT_DIVERGENCE':
    'MAME_UNMAPPED_POLICY_MATCHES_NATIVE_TAPS_AND_STATIC_LDA';
  report.autonomous_read_policy_for_exact_address_validated=!divergence.length;
  return report;
}
async function main(){
  const argv=process.argv.slice(2);
  const arg=(flag,defaultValue)=>{
    const i=argv.indexOf(flag);return i<0?defaultValue:argv[i+1];
  };
  const target=resolve(arg('--out','out/r3/unmapped-read-policy'));
  const rel=relative(resolve('out/r3'),target);
  if(!rel||rel==='..'||rel.startsWith('../')||isAbsolute(rel))
    throw Error('R36_B4_OUTPUT_NOT_PRIVATE');
  const romPath=arg('--rom','out/gngb-flat.bin');
  const tracePath=arg('--trace','out/r2/mame-probe/pre-instruction.jsonl');
  const observationsPath=arg('--observations','out/r2/mame-probe/observations.tsv');
  const proof=await runNativeBootWriteGate({
    romPath,tracePath,observationsPath,
    capabilitiesPath:arg('--capabilities','out/r2/mame-probe/capabilities.json'),
    outDir:resolve(target,'same-run-proof')
  });
  const rom=new Uint8Array(await readFile(romPath));
  const rows=(await readFile(tracePath,'utf8')).trimEnd()
    .split('\n').map(JSON.parse);
  const tsv=await readFile(observationsPath,'utf8');
  const sync=inspectNativeSyncPrestates(rom,rows,proof);
  const spec=compileLdaAt(rom);
  if(spec?.address!==TARGET)
    throw Error('R36_B4_EXPECTED_NATIVE_LDA_DMA_ADDRESS');
  const policy=nativeUnmapPolicy(tsv);
  await mkdir(target,{recursive:true});
  const busPath=resolve(target,'generated-unmapped-bus.mjs');
  const ldaPath=resolve(target,'generated-lda.mjs');
  await writeFile(busPath,emitStaticGngbUnmappedRead(policy));
  await writeFile(ldaPath,emitLdaModule(spec));
  const {readGngbUnmappedByte}=await import(pathToFileURL(busPath).href);
  const {executeLdaExt}=await import(pathToFileURL(ldaPath).href);
  const result=verifyNativeUnmappedLda({
    rom,rows,bootProof:proof,sync,tsv,
    executeLdaExt,readGngbUnmappedByte
  });
  await writeFile(resolve(target,'report.json'),
    JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result,null,2));
  if(result.status!=='MAME_UNMAPPED_POLICY_MATCHES_NATIVE_TAPS_AND_STATIC_LDA')
    process.exitCode=2;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(err=>{
    console.error('GNG_R36_B4_UNMAPPED=BLOCKED '+err.message);
    process.exitCode=2;
  });
