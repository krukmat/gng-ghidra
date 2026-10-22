#!/usr/bin/env node
/**
 * R3.5.B1: prove the SOFT_RESET boundary separately from a masked SYNC wake.
 *
 * Uses native debugger prestates, real observed MAME reset notifications, and
 * the ROM-attested SYNC instruction. It never infers IRQ line from PC or frame.
 * The gngb driver source connects screen VBLANK -> irq0_line_hold, but no
 * direct CPU IRQ assertion or vector acceptance is instrumented in Lua.
 */
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runNativeBootWriteGate} from './r3_compare_sprite_writes.mjs';
import {inspectNativeSyncPrestates} from './r3_sync_boundary.mjs';

const INT=n=>typeof n==='string' && /^(0|[1-9][0-9]*)$/.test(n) &&
  Number.isSafeInteger(Number(n)) ? Number(n) : null;
export function classifyResetAndSync(report,tsv){
  if(report?.status!=='SYNC_BYTE_AND_WAIT_BARRIER_PREPARED'||
      report.boundary_prestate_count!==2||
      !Array.isArray(report.epochs)||report.epochs.length!==2||
      report.epochs[0].epoch!==0||report.epochs[1].epoch!==1||
      report.epochs.some(e=>e.sync_pc!=='0x6016'||
        !e.irq_masked_in_sync_prestate||
        !e.firq_masked_in_sync_prestate))
    throw Error('R3_SYNC_B1_REQUIRES_TWO_MASKED_NATIVE_SYNC_BOUNDARIES');
  if(typeof tsv!=='string')throw Error('R3_SYNC_B1_NO_NATIVE_EVENT_TIMELINE');
  const chronological=tsv.trimEnd().split('\n')
    .map(line=>line.split('\t'));
  let requested=false,notified=false,requestAt=-1,resetAt=-1;
  let requestedCount=0,resetCount=0;
  let total=null,controlled=null,hasCompleteEnd=false;
  for(let i=0;i<chronological.length;i++){
    const [key,...data]=chronological[i];
    if(key==='SOFT_RESET_REQUESTED'){
      if(data.length!==2 || data.some(x=>INT(x)===null))
        throw Error('R3_SYNC_B1_BAD_RESET_REQUEST');
      requested=true;requestAt=i;requestedCount++;
    }else if(key==='RESET_NOTIFICATION'){
      if(data.length!==2 || data.some(x=>INT(x)===null))
        throw Error('R3_SYNC_B1_BAD_RESET_NOTIFICATION');
      notified=true;resetAt=i;resetCount++;
    }else if(key==='OBSERVED_RESET_COUNT'){
      if(data.length!==1 || INT(data[0])===null)
        throw Error('R3_SYNC_B1_BAD_RESET_COUNT');
      total=INT(data[0]);
    }else if(key==='CONTROLLED_SOFT_RESET_REQUESTED'){
      if(data.length!==1 || !['0','1'].includes(data[0]))
        throw Error('R3_SYNC_B1_BAD_RESET_CONTROL');
      controlled=data[0];
    }else if(key==='PROBE_END'){
      hasCompleteEnd=data.length===1&&
        ['frame-limit','machine-stop'].includes(data[0]);
    }
  }
  if(!requested||!notified||requestedCount!==1||resetCount!==1||
      total!==1||controlled!=='1'||!hasCompleteEnd||
      requestAt>=resetAt)
    throw Error('R3_SYNC_B1_RESET_REQUEST_NOTIFICATION_NOT_CAUSAL');
  const [a,b]=report.epochs;
  if(a.next_debugger_pc!=='0x6000'||b.next_debugger_pc!=='0x6017' ||
      a.next_pc_equals_fallthrough!==false ||
      b.next_pc_equals_fallthrough!==true)
    throw Error('R3_SYNC_B1_UNEXPECTED_TWO_EPOCH_DEBUGGER_SEQUENCE');
  return {
    schema:'gng.r3.sync-reset-versus-masked-wake.v1',
    status:'RESET_BOUNDARY_CONFIRMED_MASKED_WAKE_CAUSE_NOT_OBSERVED',
    first_epoch:{
      sync_prestate_seq:a.sync_prestate_seq,
      next_debugger_pc:'0x6000',
      observed_reset_request_before_notification:true,
      attribution:'RESET_SEQUENCE_ASSOCIATED_WITH_FIRST_EPOCH_NOT_IRQ_EVIDENCE',
      irq_assertion_observed:false,
    },
    second_epoch:{
      sync_prestate_seq:b.sync_prestate_seq,
      next_debugger_pc:'0x6017',
      irq_and_firq_masked:true,
      attribution:'MASKED_SYNC_FALLTHROUGH_OBSERVED_CAUSING_LINE_UNKNOWN',
      irq_assertion_observed:false,
      irq_handler_entry_observed:false,
    },
    driver_source_vblank_irq_configured:true,
    driver_vblank_line_assertion_directly_observed:false,
    native_reset_notifications:resetCount,
    boot_registers_and_sprite_writes_prevalidated:true,
    post_sync_cpu_or_irq_equivalence_verified:false,
    next_task:'Direct IRQ line assertion and CPU SYNCACK/IRQ entry observation requires native MAME core/driver hook; do not infer causation from frame or PC alone',
  };
}
async function main(){
  const argv=process.argv.slice(2);
  const arg=(name,fallback)=>{
    const i=argv.indexOf(name);return i<0?fallback:argv[i+1];
  };
  const target=resolve(arg('--out','out/r3/sync-reset-causality'));
  const base=resolve('out/r3');
  const rel=relative(base,target);
  if(!rel||rel==='..'||rel.startsWith('../')||isAbsolute(rel))
    throw Error('R3_SYNC_B1_PRIVATE_OUTPUT_REQUIRED');
  const romPath=arg('--rom','out/gngb-flat.bin');
  const tracePath=arg('--trace','out/r2/mame-probe/pre-instruction.jsonl');
  const observationsPath=arg('--observations','out/r2/mame-probe/observations.tsv');
  const capabilitiesPath=arg('--capabilities','out/r2/mame-probe/capabilities.json');
  const proof=await runNativeBootWriteGate({romPath,tracePath,
    observationsPath,capabilitiesPath,
    outDir:resolve(target,'revalidated-boot')});
  const rom=new Uint8Array(await readFile(romPath));
  const rows=(await readFile(tracePath,'utf8')).trim().split('\n')
    .map(x=>JSON.parse(x));
  const native=inspectNativeSyncPrestates(rom,rows,proof);
  const report=classifyResetAndSync(native,await readFile(observationsPath,'utf8'));
  await mkdir(target,{recursive:true});
  await writeFile(resolve(target,'report.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(e=>{
    console.error('GNG_R3_SYNC_B1=BLOCKED '+e.message);
    process.exitCode=2;
  });
