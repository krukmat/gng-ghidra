#!/usr/bin/env node
/**
 * A0.4: verify predicted 4,096 JS byte writes from the four indexed gngb
 * fixed-ROM sites against MAME's independently observed VIDEO RAM tap.
 *
 * Revalidates the same-run native sprite boot gate and two SYNC prestates.
 * Native taps have no trustworthy issuing-instruction PC: proof is a
 * UNIQUE ordered contiguous sequence of address/byte/mask effects in
 * the second native reset epoch, not per-instruction bus causality.
 *
 * Source ROM, full trace, generated code and address/value events are PRIVATE
 * under out/r3. Only aggregate counts/booleans are exported.
 */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,relative,isAbsolute} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {compileAt,emitStaticModule,checkedState,diffRegisters}
  from './r3_static_trace_probe.mjs';
import {SITES,inspectIndexedStores}
  from './r3_indexed_store_gate.mjs';
import {runNativeBootWriteGate}
  from './r3_compare_sprite_writes.mjs';
import {inspectNativeSyncPrestates} from './r3_sync_boundary.mjs';

const SAMPLE_LIMIT=32768;
const FIXED_EXPECTED=4096;
const SITE_EXPECTED=1024;
const SITE_INDEX=new Map(SITES.map((s,i)=>[s.pc,i]));
const parseUInt=value=>{
  if(typeof value!=='string'||!/^(0|[1-9][0-9]*)$/.test(value))
    return null;
  const n=Number(value);
  return Number.isSafeInteger(n)?n:null;
};
export function parseNativeVideoWrites(tsv){
  if(typeof tsv!=='string')throw Error('A04_TSV_REQUIRED');
  const epochs=[[]];
  let enabled=0,total=null,resets=0,probeEnd=0;
  let streamSeq=0;
  for(const line of tsv.trimEnd().split('\n')){
    const [tag,...fields]=line.split('\t');
    if(tag==='A04_VIDEO_WRITE_TAP_ENABLED'){
      if(fields.length!==1||fields[0]!=='1'||enabled++)
        throw Error('A04_VIDEO_CAPTURE_NOT_ENABLED_OR_DUPLICATE');
    }else if(tag==='RESET_NOTIFICATION'){
      resets++;epochs.push([]);
    }else if(tag==='A04_VIDEO_WRITE_BYTE'){
      if(fields.length!==5||fields.some(v=>parseUInt(v)===null))
        throw Error('A04_VIDEO_WRITE_MALFORMED');
      const [epoch,seq,address,data,mask]=fields.map(parseUInt);
      if(resets>1||epoch!==resets||seq!==streamSeq+1||
          address<0x2000||address>0x2fff||data>255||mask>255||
          streamSeq>=SAMPLE_LIMIT)
        throw Error('A04_VIDEO_WRITE_SEQUENCE_OR_RANGE_INVALID');
      streamSeq=seq;
      epochs[epoch].push({address,data,mask});
    }else if(tag==='A04_VIDEO_WRITE_COUNT'){
      if(fields.length!==1||total!==null)throw Error('A04_VIDEO_COUNT_INVALID');
      total=parseUInt(fields[0]);
    }else if(tag==='PROBE_END'){
      if(fields.length!==1||!['frame-limit','machine-stop'].includes(fields[0]))
        throw Error('A04_VIDEO_PROBE_END_INVALID');
      probeEnd++;
    }
  }
  if(enabled!==1||resets!==1||epochs.length!==2||
      total===null||total!==streamSeq||total>SAMPLE_LIMIT||
      probeEnd!==1)
    throw Error('A04_VIDEO_MISSING_INCOMPLETE_OR_TRUNCATED');
  return {total,epochs};
}
/** From each native prestate, execute ROM-derived *static* code once.
 * JS output is compared to the next native register prestate, but writes
 * are retained PRIVATE for comparison with an independent native tap.
 */
export function deriveStaticVideoWrites(rom,rows,sync,compiledStep){
  if(!(rom instanceof Uint8Array)||rom.length!==65536||
      rom[0xfffe]!==0x60||rom[0xffff]!==0||
      typeof compiledStep!=='function'||!Array.isArray(rows)||
      sync?.status!=='SYNC_BYTE_AND_WAIT_BARRIER_PREPARED'||
      sync.epochs?.length!==2)
    throw Error('A04_INVALID_PRIVATE_ROM_OR_NATIVE_BOUNDARY');
  const seq=sync.epochs[1].sync_prestate_seq;
  if(rows[seq]?.pc!==0x6016||rows[seq+1]?.pc!==0x6017)
    throw Error('A04_WRONG_SECOND_EPOCH_START');
  for(const site of SITES){
    if(rom[site.pc]!==site.op||
        !compileAt(rom,site.pc)?.writesRamByte)
      throw Error('A04_EXPECTED_FOUR_GENERATED_STORES_NOT_PRESENT');
  }
  const bySite=[0,0,0,0],events=[];
  for(let i=seq+1;i+1<rows.length;i++){
    const r=rows[i],next=rows[i+1];
    const siteIdx=SITE_INDEX.get(r.pc);
    if(siteIdx===undefined)continue;
    if(r.seq!==i||next.seq!==i+1||
        r.before?.PC!==r.pc||next.before?.PC!==next.pc)
      throw Error('A04_MAME_NATIVE_PRESTATE_SEQUENCE_INVALID');
    checkedState(r.before);checkedState(next.before);
    let write=null;
    const generated=compiledStep(r.before,undefined,(address,data)=>{
      if(write!==null||!Number.isInteger(address)||
          address<0x2000||address>0x2fff||
          !Number.isInteger(data)||data<0||data>255)
        throw Error('A04_GENERATED_WRITE_OUTSIDE_VIDEO_RAM');
      write={address,data,mask:255};
    });
    if(!write)
      throw Error('A04_GENERATED_STORE_MISSING_WRITE');
    const mismatch=diffRegisters(generated,next.before);
    if(mismatch.length)
      throw Error('A04_GENERATED_REGISTER_CHECKPOINT_DIVERGENCE');
    events.push(write);
    bySite[siteIdx]++;
  }
  if(events.length!==FIXED_EXPECTED||
      bySite.some(count=>count!==SITE_EXPECTED))
    throw Error('A04_INCOMPLETE_FOUR_SITE_EXPECTED_WRITE_SEQUENCE');
  return {events,bySite};
}
export function compareNativeVideoWriteSequence(predicted,native){
  if(!Array.isArray(predicted)||predicted.length!==FIXED_EXPECTED||
      !Array.isArray(native)||native.some(x=>
        !Number.isInteger(x.address)||!Number.isInteger(x.data)||
        !Number.isInteger(x.mask)))
    throw Error('A04_INVALID_VIDEO_COMPARISON_INPUT');
  const same=(a,b)=>a.address===b.address&&
    a.data===b.data&&a.mask===b.mask;
  let matches=0,matchStart=-1;
  for(let i=0;i+predicted.length<=native.length;i++){
    if(!same(native[i],predicted[0]))continue;
    let j=1;
    for(;j<predicted.length;j++){
      if(!same(native[i+j],predicted[j]))break;
    }
    if(j===predicted.length){
      matches++;
      if(matches===1)matchStart=i;
      else break;
    }
  }
  return {status:matches===1?'UNIQUE_CONTIGUOUS_NATIVE_SEQUENCE_MATCH':
    matches>1?'BLOCKED_AMBIGUOUS_NATIVE_SEQUENCE':
    'BLOCKED_NO_ORDERED_NATIVE_VIDEO_WRITE_MATCH',
    expected_byte_writes:predicted.length,
    native_captured_video_writes:native.length,
    unique_matching_window:matches===1,
    extra_native_video_writes_not_attributed:
      matches===1?native.length-predicted.length:null,
    first_mismatch_raw_values_exposed:false,
  };
}
export function verifyNativeVideoWriteGate({
  rom,rows,sync,tsv,compiledStep
}){
  // Reuse A0.3's existing four-site register checkpoint and indexing-mode
  // verification on the SAME native prestate data before the bus test.
  const a03=inspectIndexedStores({rom,rows,sync,compiledStep});
  if(a03.status!=='INDEXED_REGISTER_CHECKPOINTS_MATCHED_BUS_UNVERIFIED'||
      a03.total_target_site_executions!==FIXED_EXPECTED||
      a03.matching_register_checkpoints!==FIXED_EXPECTED)
    throw Error('A04_NATIVE_A03_REGISTER_GATE_NOT_PASSED');
  const {events}=deriveStaticVideoWrites(rom,rows,sync,compiledStep);
  const native=parseNativeVideoWrites(tsv);
  const compared=compareNativeVideoWriteSequence(events,native.epochs[1]);
  const accepted=compared.unique_matching_window;
  return {
    schema:'gng.a0.native-video-byte-write-v1',
    status:accepted?'NATIVE_VIDEO_WRITES_MATCH_GENERATED_STATIC_JS':
      compared.status,
    four_indexed_rom_store_sites_verified:true,
    native_prestate_samples:rows.length,
    generated_video_byte_writes:events.length,
    independently_native_video_byte_writes_total:native.total,
    native_video_writes_before_reset:native.epochs[0].length,
    native_video_writes_after_reset:native.epochs[1].length,
    matched_native_video_byte_writes:accepted?events.length:0,
    native_unattributed_video_write_count:
      compared.extra_native_video_writes_not_attributed,
    comparison_requires_order_address_value_and_mask:true,
    native_segment_uniquely_matched:accepted,
    generated_js_register_checkpoints_matched:a03.matching_register_checkpoints,
    native_bus_write_to_instruction_correlation_verified:false,
    exhaustive_native_video_ram_write_coverage_verified:false,
    IRQ_SYNC_wake_or_banked_ROM_verified:false,
    full_game_or_board_runtime_verified:false,
    game_playable:false,
    raw_ROM_memory_addresses_or_values_exported:false,
    next_task:accepted?
      'Integrate authenticated video writes into an autonomous board-memory implementation; resolve banked ROM and IRQ/SYNC wake separately':
      'Investigate absent, conflicting, or interleaved native video tap writes; do not infer equivalence from native registers',
  };
}
async function main(){
  const argv=process.argv.slice(2);
  const arg=(flag,defaultValue)=>{
    const at=argv.indexOf(flag);return at===-1?defaultValue:argv[at+1];
  };
  const out=resolve(arg('--out','out/r3/native-video-writes'));
  const rel=relative(resolve('out/r3'),out);
  if(!rel||rel==='..'||rel.startsWith('../')||isAbsolute(rel))
    throw Error('A04_PRIVATE_OUTPUT_REQUIRED');
  const romPath=arg('--rom','out/gngb-flat.bin');
  const tracePath=arg('--trace','out/r2/mame-probe/pre-instruction.jsonl');
  const tsvPath=arg('--observations','out/r2/mame-probe/observations.tsv');
  // R3.3 same-run evidence validates ROM-derived code and native boot RAM.
  const boot=await runNativeBootWriteGate({
    romPath,tracePath,observationsPath:tsvPath,
    capabilitiesPath:arg('--capabilities',
      'out/r2/mame-probe/capabilities.json'),
    outDir:resolve(out,'same-run-verified-boot')
  });
  if(boot.status!=='PASS_BOOT_SPRITE_RAM_WRITE_BYTES'||
      boot.actual_mame_sprite_byte_writes_compared!==true)
    throw Error('A04_NATIVE_BOOT_SPRITE_WRITE_PROOF_MISSING');
  const rom=new Uint8Array(await readFile(romPath));
  const rows=(await readFile(tracePath,'utf8')).trimEnd()
    .split('\n').map(JSON.parse);
  const sync=inspectNativeSyncPrestates(rom,rows,boot);
  const specs=SITES.map(s=>compileAt(rom,s.pc));
  if(specs.some(s=>!s?.writesRamByte))
    throw Error('A04_FOUR_INDEXED_STORES_NOT_COMPILED');
  await mkdir(out,{recursive:true});
  const code=resolve(out,'private-generated-indexed-stores.mjs');
  await writeFile(code,emitStaticModule(specs));
  const {compiledStep}=await import(pathToFileURL(code).href);
  const report=verifyNativeVideoWriteGate({
    rom,rows,sync,compiledStep,tsv:await readFile(tsvPath,'utf8')
  });
  await writeFile(resolve(out,'report.json'),
    JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
  if(report.status!=='NATIVE_VIDEO_WRITES_MATCH_GENERATED_STATIC_JS')
    process.exitCode=2;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(error=>{
    console.error('A04_NATIVE_VIDEO_WRITES=BLOCKED '+error.message);
    process.exitCode=2;
  });
