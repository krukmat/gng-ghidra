#!/usr/bin/env node
// R3.3: compare ROM-compiled JS sprite-RAM writes with native MAME write taps.
// Only exact boot-loop writes are certified, not the entire CPU/bus/game.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {runGate,diffRegisters} from './r3_static_trace_probe.mjs';

const BOOT_PCS=new Set([0x6000,0x6002,0x6005,0x6009,0x600c,
  0x600e,0x6010,0x6012]);
const EXIT_PC=0x6014;
const EXPECTED_WORDS=192;
const CAPTURE_LIMIT=4096;

function decimal(value){
  return typeof value==='string' && /^(0|[1-9][0-9]*)$/.test(value)
    ? Number(value):NaN;
}
export function splitNativeSpriteObservations(content){
  if(typeof content!=='string')throw Error('R3_MAME_OBSERVATIONS_ABSENT');
  const epochs=[[]], tags=new Map();
  let resetNotifications=0;
  for(const line of content.trimEnd().split('\n')){
    const [kind,...fields]=line.split('\t');
    tags.set(kind,(tags.get(kind)||0)+1);
    if(kind==='RESET_NOTIFICATION'){
      resetNotifications++;
      epochs.push([]);
    }else if(kind==='SPRITE_RAM_WRITE_BYTE'){
      if(fields.length!==3 ||
          fields.some(v=>!Number.isSafeInteger(decimal(v))))
        throw Error('R3_INVALID_NATIVE_SPRITE_RAM_TAP_FIELDS');
      const [addr,data,mask]=fields.map(decimal);
      if(addr<0x1e00||addr>0x1fff||data>255||mask>255)
        throw Error('R3_NATIVE_SPRITE_RAM_TAP_OUT_OF_RANGE');
      epochs.at(-1).push({addr,data,mask});
    }
  }
  if(tags.get('SPRITE_RAM_TAP_ENABLED')!==1 ||
      !content.includes('SPRITE_RAM_TAP_ENABLED\t1\n'))
    throw Error('R3_SPRITE_RAM_TAP_NOT_ENABLED');
  if(tags.get('OBSERVED_SPRITE_RAM_WRITE_COUNT')!==1)
    throw Error('R3_MISSING_NATIVE_WRITE_TOTAL');
  const m=content.match(/^OBSERVED_SPRITE_RAM_WRITE_COUNT\t([0-9]+)$/m);
  if(!m)throw Error('R3_INVALID_NATIVE_WRITE_TOTAL');
  const count=decimal(m[1]);
  const sum=epochs.reduce((n,e)=>n+e.length,0);
  if(count>CAPTURE_LIMIT||sum!==count)
    throw Error('R3_NATIVE_WRITE_SAMPLES_TRUNCATED_OR_DUPLICATED');
  if(resetNotifications!==1||epochs.length!==2)
    throw Error('R3_EXPECTED_ONE_NATIVE_SOFT_RESET_EPOCH_BOUNDARY');
  return {epochs,count,resetNotifications};
}
export function deriveBootWrites(rows,compiledStep){
  if(!Array.isArray(rows)||typeof compiledStep!=='function')
    throw Error('R3_INVALID_BOOT_REFERENCE');
  const runs=[];
  for(let start=0;start<rows.length-1;start++){
    if(![0x6000,0x6002].includes(rows[start].pc) ||
        (start>0 && BOOT_PCS.has(rows[start-1].pc)))
      continue;
    const events=[],startSeq=rows[start].seq;
    let cpu={...rows[start].before};
    let reachedExit=false;
    for(let i=start;i<rows.length-1;i++){
      const row=rows[i],following=rows[i+1];
      if(row.pc!==cpu.PC||!BOOT_PCS.has(row.pc))
        break;
      const out=compiledStep(cpu,(addr,word)=>{
        if(!Number.isInteger(addr)||addr<0x1e00||addr>0x1ffe||
            !Number.isInteger(word)||word<0||word>0xffff)
          throw Error('R3_COMPILED_BOOT_WRITE_OUT_OF_BOUNDS');
        events.push({addr,data:(word>>8)&255,mask:255});
        events.push({addr:addr+1,data:word&255,mask:255});
      });
      const mismatches=diffRegisters(out,following.before);
      if(mismatches.length)
        throw Error('R3_BOOT_ACCUMULATED_REGISTER_DIVERGENCE');
      cpu=out;
      if(cpu.PC===EXIT_PC){
        reachedExit=true;
        break;
      }
    }
    // Do not silently accept partial boot loops: a gate needs 192 stores.
    if(!reachedExit||events.length!==EXPECTED_WORDS*2)
      throw Error('R3_INCOMPLETE_BOOT_SPRITE_FILL_LOOP');
    runs.push({startSeq,events,wordWrites:events.length/2});
    if(runs.length>2)throw Error('R3_TOO_MANY_BOOT_LOOPS');
  }
  if(runs.length!==2)throw Error('R3_EXPECTED_TWO_COMPLETE_BOOT_LOOPS');
  return runs;
}
function nativeEpochResult(native,expected){
  const matches=[];
  // Only a contiguous, unique, completely recorded native write sequence
  // can validate JS write addresses/values/order; no data-dependent skipping.
  for(let offset=0;offset+expected.length<=native.length;offset++){
    if(native[offset].addr!==expected[0].addr||
        native[offset].data!==expected[0].data)continue;
    let valid=true;
    for(let i=0;i<expected.length;i++){
      const n=native[offset+i],e=expected[i];
      if(n.addr!==e.addr||n.data!==e.data||n.mask!==255){
        valid=false;break;
      }
    }
    if(valid)matches.push(offset);
    if(matches.length>1)break;
  }
  return {
    native_sample_count:native.length,
    expected_byte_writes:expected.length,
    uniquely_matched:matches.length===1,
    unverified_other_native_writes:matches.length===1?
      native.length-expected.length:null,
    reason:matches.length===0?'NO_COMPLETE_ORDERED_BYTE_MATCH':
      matches.length>1?'AMBIGUOUS_MULTIPLE_MATCHES':null,
  };
}
export function compareNativeWithCompiledBoot(rows,tsv,compiledStep,
  capabilities){
  const native=splitNativeSpriteObservations(tsv);
  const caps=capabilities?.capabilities;
  if(capabilities?.status!=='PARTIAL_NATIVE_INSTRUMENTATION'||
      capabilities?.real_mame_execution_observed!==true||
      caps?.controlled_soft_reset_observed!==true)
    throw Error('R3_NATIVE_MAME_RESET_PROVENANCE_NOT_VALIDATED');
  const runs=deriveBootWrites(rows,compiledStep);
  const epochs=native.epochs.map((x,i)=>
    nativeEpochResult(x,runs[i].events));
  const allMatched=epochs.every(x=>x.uniquely_matched);
  return {
    schema:'gng.r3.sprite-native-write-differential.v1',
    status:allMatched?'PASS_BOOT_SPRITE_RAM_WRITE_BYTES':
      'BLOCKED_NATIVE_BOOT_SPRITE_RAM_DIFFERENTIAL',
    mame_reset_notifications:native.resetNotifications,
    boot_runs_compared:runs.length,
    compiled_sprite_ram_word_writes:runs.reduce((n,x)=>n+x.wordWrites,0),
    native_sprite_byte_samples:native.count,
    expected_sprite_byte_samples:runs.reduce((n,x)=>n+x.events.length,0),
    per_boot:epochs.map((x,i)=>({epoch:i,...x})),
    compiled_js_state_accumulated_between_steps:true,
    actual_mame_sprite_byte_writes_compared:allMatched,
    all_ram_or_cpu_bus_operations_verified:false,
    irq_sync_bank_edges_verified:false,
    full_game_equivalence_verified:false,
    note:'Only exact ordered boot sprite RAM write bytes; other bus devices and RAM are out of scope',
  };
}

export async function runNativeBootWriteGate({romPath,tracePath,
  observationsPath,capabilitiesPath,outDir}){
  const target=resolve(outDir);
  if(!target.startsWith(resolve('out/r3')+'/'))
    throw Error('R3_OUTPUT_MUST_BE_PRIVATE');
  const base=await runGate({romPath,tracePath,outDir});
  if(base.status!=='MATCHED_SUPPORTED_PRESTATE_PAIRS' ||
      base.contiguous.longest_segment_steps<4 ||
      base.contiguous.first_divergence)
    throw Error('R3_PRESTATE_CONTIGUOUS_BASELINE_NOT_PASS');
  const rows=(await readFile(tracePath,'utf8')).trimEnd().split('\n')
    .map(s=>JSON.parse(s));
  const {compiledStep}=await import(pathToFileURL(
    resolve(outDir,'static-rom-slice.mjs')).href);
  const result=compareNativeWithCompiledBoot(rows,
    await readFile(observationsPath,'utf8'),compiledStep,
    JSON.parse(await readFile(capabilitiesPath,'utf8')));
  await mkdir(target,{recursive:true});
  await writeFile(resolve(target,'sprite-native-report.json'),
    JSON.stringify(result,null,2)+'\n');
  return result;
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const get=n=>{const i=process.argv.indexOf(n);
    return i<0?null:process.argv[i+1];};
  runNativeBootWriteGate({
    romPath:get('--rom')??'out/gngb-flat.bin',
    tracePath:get('--trace')??'out/r2/mame-probe/pre-instruction.jsonl',
    observationsPath:get('--observations')??'out/r2/mame-probe/observations.tsv',
    capabilitiesPath:get('--capabilities')??'out/r2/mame-probe/capabilities.json',
    outDir:get('--out')??'out/r3/sprite-native'
  }).then(r=>{
    console.log(JSON.stringify(r,null,2));
    if(r.status!=='PASS_BOOT_SPRITE_RAM_WRITE_BYTES')process.exitCode=2;
  }).catch(e=>{
    console.error('GNG_R3_SPRITE_NATIVE=BLOCKED '+e.message);
    process.exitCode=2;
  });
}
