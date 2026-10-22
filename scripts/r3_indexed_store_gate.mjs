#!/usr/bin/env node
/**
 * A0.3: execute FOUR observed gngb ROM STA/STB-indexed sites with generated
 * static JS and a strict, sandboxed byte-write sink. Compare register
 * effects with existing native prestates.  The byte-write stream is
 * PREDICTED, not authenticated against MAME memory taps.
 *
 * Requires the independently revalidated SAME capture R3.3 sprite boot and
 * SYNC boundary. Does not run or embed an MC6809 opcode interpreter.
 */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,relative,isAbsolute} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {compileAt,emitStaticModule,diffRegisters,checkedState}
  from './r3_static_trace_probe.mjs';
import {runNativeBootWriteGate}
  from './r3_compare_sprite_writes.mjs';
import {inspectNativeSyncPrestates} from './r3_sync_boundary.mjs';

export const SITES=Object.freeze([
  {pc:0x6041,op:0xa7},
  {pc:0x6043,op:0xe7},
  {pc:0x6055,op:0xe7},
  {pc:0x6057,op:0xa7}
]);
const hx=x=>'0x'+x.toString(16).padStart(4,'0');
function region(address){
  if(address<0x1e00)return 'MAIN_RAM';
  if(address<0x2000)return 'SPRITE_RAM';
  if(address<0x3000)return 'VIDEO_RAM';
  if(address<0x4000)return 'MMIO_OR_INPUT';
  if(address<0x6000)return 'BANKED_ROM_WINDOW';
  return 'FIXED_ROM_WINDOW';
}
export function inspectIndexedStores({rom,rows,sync,compiledStep}){
  if(!(rom instanceof Uint8Array)||rom.length!==65536||
      rom[0xfffe]!==0x60||rom[0xffff]!==0||
      !Array.isArray(rows)||typeof compiledStep!=='function')
    throw Error('A03_INVALID_NATIVE_INPUT');
  if(sync?.status!=='SYNC_BYTE_AND_WAIT_BARRIER_PREPARED'||
      sync.epochs?.length!==2||
      sync.epochs[1]?.next_debugger_pc!=='0x6017')
    throw Error('A03_UNVERIFIED_TWO_EPOCH_SYNC');
  const after=sync.epochs[1].sync_prestate_seq+1;
  if(rows[after]?.pc!==0x6017)
    throw Error('A03_SYNC_NATIVE_FIRST_CPU_BOUNDARY_MISSING');
  const counts=new Map(),summaries=[];
  const specs=SITES.map(site=>{
    const spec=compileAt(rom,site.pc);
    if(rom[site.pc]!==site.op)
      throw Error('A03_ROM_OPCODE_MISMATCH');
    const item={
      pc:hx(site.pc),family:site.op===0xa7?'STA_INDEXED':'STB_INDEXED',
      compilable:!!spec?.writesRamByte,
      indexing_mode:spec?.index_mode??'UNSUPPORTED_TWO_BYTE_MODE',
      index_register:spec?.index_register??null,
      execution_samples:0,register_checkpoints_compared:0,
      register_divergences:0,
      predicted_write_counts_by_region:{},
      first_divergent_fields:null,
    };
    summaries.push(item);
    counts.set(site.pc,item);
    return spec;
  });
  const used=new Map();
  let errors=0,total=0,verified=0;
  for(let i=after;i+1<rows.length;i++){
    const row=rows[i],next=rows[i+1];
    const item=counts.get(row.pc);
    if(!item)continue;
    if(row.seq!==i||next.seq!==i+1||
        row.before?.PC!==row.pc||next.before?.PC!==next.pc)
      throw Error('A03_NATIVE_TRACE_SEQUENCE_INVALID');
    checkedState(row.before);checkedState(next.before);
    item.execution_samples++;total++;
    const spec=specs[SITES.findIndex(s=>s.pc===row.pc)];
    if(!spec?.writesRamByte)continue;
    // A single observed indexed instruction emits EXACTLY one byte write.
    const writes=[];
    const state=compiledStep(row.before,undefined,(address,value)=>{
      if(!Number.isInteger(address)||address<0||address>65535||
          !Number.isInteger(value)||value<0||value>255)
        throw Error('A03_STATIC_INDEXED_WRITE_MALFORMED');
      if(writes.length!==0)throw Error('A03_MULTIPLE_BYTE_WRITES_PER_STORE');
      writes.push({address,value});
    });
    if(writes.length!==1)
      throw Error('A03_NO_GENERATED_BYTE_WRITE');
    const r=region(writes[0].address);
    item.predicted_write_counts_by_region[r]=
      (item.predicted_write_counts_by_region[r]??0)+1;
    // The native next prestate is an independent CPU register checkpoint,
    // NOT an authenticated bus write observation.
    const diff=diffRegisters(state,next.before);
    if(diff.length){
      errors++;item.register_divergences++;
      item.first_divergent_fields??=diff;
    }else{
      verified++;item.register_checkpoints_compared++;
    }
  }
  const uncompiled=summaries.filter(x=>!x.compilable);
  const actualCount=summaries.reduce((n,x)=>n+x.execution_samples,0);
  if(total===0||actualCount!==total||
      summaries.some(x=>x.execution_samples===0))
    throw Error('A03_NATIVE_FOUR_SITES_INCOMPLETE');
  // Never label bus read/write observations equivalent without direct taps.
  const status=uncompiled.length?
    'BLOCKED_UNSUPPORTED_REAL_INDEXED_POSTBYTE':
    errors?'BLOCKED_GENERATED_INDEXED_REGISTER_DIVERGENCE':
    'INDEXED_REGISTER_CHECKPOINTS_MATCHED_BUS_UNVERIFIED';
  return {
    schema:'gng.a0.indexed-store-register-gate.v1',status,
    native_prestate_sample_count:rows.length,
    native_four_rom_store_sites_observed:true,
    compiled_store_site_count:summaries.length-uncompiled.length,
    total_target_site_executions:total,
    compared_register_checkpoints:verified+errors,
    matching_register_checkpoints:verified,
    register_divergences:errors,
    store_sites:summaries,
    generated_js_opcode_interpreter:false,
    ROM_postbytes_raw_exported:false,
    generated_write_addresses_or_values_exported:false,
    native_cpu_bus_write_events_compared:false,
    runtime_memory_board_model_verified:false,
    native_irq_sync_or_banked_rom_verified:false,
    game_playable:false,
    next_task:uncompiled.length?
      'Extend ONLY the required genuine 6809 indexed postbyte modes; then compare registers':
      errors?
      'Investigate first register divergence before treating stores as compiled':
      'Capture independent native write taps for affected RAM regions and compare ordered address/value/mask to generated writes'
  };
}
async function main(){
  const args=process.argv.slice(2);
  const arg=(key,def)=>{const i=args.indexOf(key);return i<0?def:args[i+1];};
  const out=resolve(arg('--out','out/r3/indexed-store-gate'));
  const rel=relative(resolve('out/r3'),out);
  if(!rel||rel==='..'||rel.startsWith('../')||isAbsolute(rel))
    throw Error('A03_PRIVATE_OUT_REQUIRED');
  const romPath=arg('--rom','out/gngb-flat.bin');
  const tracePath=arg('--trace','out/r2/mame-probe/pre-instruction.jsonl');
  const proof=await runNativeBootWriteGate({
    romPath,tracePath,
    observationsPath:arg('--observations','out/r2/mame-probe/observations.tsv'),
    capabilitiesPath:arg('--capabilities','out/r2/mame-probe/capabilities.json'),
    outDir:resolve(out,'same-run-proof')
  });
  const rom=new Uint8Array(await readFile(romPath));
  const rows=(await readFile(tracePath,'utf8')).trimEnd()
    .split('\n').map(JSON.parse);
  const sync=inspectNativeSyncPrestates(rom,rows,proof);
  const specs=SITES.map(site=>compileAt(rom,site.pc))
    .filter(s=>s?.writesRamByte);
  await mkdir(out,{recursive:true});
  const modulePath=resolve(out,'generated-static-indexed-stores.mjs');
  await writeFile(modulePath,emitStaticModule(specs));
  const {compiledStep}=await import(pathToFileURL(modulePath).href);
  const report=inspectIndexedStores({rom,rows,sync,compiledStep});
  await writeFile(resolve(out,'report.json'),
    JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
  if(report.status!=='INDEXED_REGISTER_CHECKPOINTS_MATCHED_BUS_UNVERIFIED')
    process.exitCode=2;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(e=>{
    console.error('A03_INDEXED_STORE=BLOCKED '+e.message);
    process.exitCode=2;
  });
