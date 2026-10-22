#!/usr/bin/env node
/**
 * R3.6.B2: exact-address, independently captured MAME MMIO read candidate.
 *
 * The Lua callback sees returned program-bus byte and reset epoch, but does
 * NOT authenticate the issuing MC6809 instruction. Never infer PC from the
 * tap's advisory debugger PC or use MAME register A as the read value.
 * Only a UNIQUE native read sample in second reset epoch can be compared
 * with a generated static LDA step. It remains a correlation, NOT a reusable
 * emulation rule for the MMIO device or a causal bus-instruction trace.
 */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,relative,isAbsolute} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {compileLdaAt,emitLdaModule} from './r3_lda_extended_gate.mjs';
import {runNativeBootWriteGate} from './r3_compare_sprite_writes.mjs';
import {inspectNativeSyncPrestates} from './r3_sync_boundary.mjs';
import {checkedState,diffRegisters} from './r3_static_trace_probe.mjs';

const R36_LINE='R36_TARGETED_READ_BYTE';
const MAX_EVENTS=4096;
const parseUInt=s=>
  typeof s==='string'&&/^(0|[1-9][0-9]*)$/.test(s) &&
  Number.isSafeInteger(Number(s))?Number(s):null;
export function parseNativeTargetReads(tsv,address){
  if(typeof tsv!=='string'||!Number.isInteger(address)||
      address<0x3800||address>0x3fff)
    throw Error('R36_TARGETED_READ_NOT_CONFIGURED');
  let enabled=0,recordedAddr=null,count=null,resetCount=0;
  const events=[];
  let end=false;
  for(const line of tsv.trimEnd().split('\n')){
    const [key,...v]=line.split('\t');
    if(key==='R36_TARGETED_READ_ENABLED'){
      if(v.length!==1||v[0]!=='1'||enabled++)
        throw Error('R36_TARGETED_READ_NOT_ENABLED');
    }else if(key==='R36_TARGETED_READ_ADDR'){
      if(v.length!==1||recordedAddr!==null)
        throw Error('R36_TARGETED_READ_ADDR_INVALID');
      recordedAddr=parseUInt(v[0]);
    }else if(key===R36_LINE){
      if(v.length!==7)throw Error('R36_NATIVE_READ_SAMPLE_MALFORMED');
      const [epoch,seq,frame,pc,addr,data,mask]=v.map(parseUInt);
      if([epoch,seq,frame,addr,data,mask].some(x=>x===null)||
          addr!==address||data>255||mask>255||
          !Number.isInteger(epoch)||epoch!==resetCount||
          seq!==events.length+1||events.length>=MAX_EVENTS)
        throw Error('R36_NATIVE_READ_SAMPLE_INVALID');
      // PC is advisory ONLY, never matched as an instruction boundary.
      events.push({epoch,data,mask,pcAdvisory:pc});
    }else if(key==='RESET_NOTIFICATION'){
      resetCount++;
    }else if(key==='R36_TARGETED_READ_COUNT'){
      if(v.length!==1||count!==null)throw Error('R36_READ_COUNT_DUPLICATED');
      count=parseUInt(v[0]);
    }else if(key==='PROBE_END'){
      end=v.length===1&&['frame-limit','machine-stop'].includes(v[0]);
    }
  }
  if(enabled!==1||recordedAddr!==address||count===null||
      count!==events.length||count>MAX_EVENTS||
      resetCount!==1||!end)
    throw Error('R36_READ_INCOMPLETE_OR_TRUNCATED_OR_WRONG_EPOCH');
  return {total:count,epochs:[
    events.filter(e=>e.epoch===0),
    events.filter(e=>e.epoch===1)]};
}
export function analyzeNativeMmioLda({rom,rows,bootProof,sync,tsv,executeLdaExt}){
  const spec=compileLdaAt(rom);
  if(!spec||spec.region!=='PALETTE_OR_MMIO')
    throw Error('R36_NOT_ORIGINAL_MMIO_LDA_EXT');
  if(bootProof?.status!=='PASS_BOOT_SPRITE_RAM_WRITE_BYTES' ||
      bootProof.actual_mame_sprite_byte_writes_compared!==true||
      !Array.isArray(bootProof.per_boot)||bootProof.per_boot.length!==2||
      bootProof.per_boot.some(x=>x.uniquely_matched!==true))
    throw Error('R36_SAME_CAPTURE_BOOT_PROOF_MISSING');
  if(sync?.status!=='SYNC_BYTE_AND_WAIT_BARRIER_PREPARED'||
      sync.epochs?.length!==2||
      sync.epochs[1]?.next_debugger_pc!=='0x6017'||
      !sync.epochs[1]?.irq_masked_in_sync_prestate||
      !sync.epochs[1]?.firq_masked_in_sync_prestate)
    throw Error('R36_SECOND_SYNC_NATIVE_BOUNDARY_MISSING');
  const sequence=sync.epochs[1].sync_prestate_seq+1;
  const before=rows[sequence],after=rows[sequence+1];
  if(before?.pc!==0x6017 || before.seq!==sequence ||
      after?.pc!==0x601a || after.seq!==sequence+1)
    throw Error('R36_MAME_LDA_CHECKPOINTS_MISSING');
  checkedState(before.before);checkedState(after.before);
  const native=parseNativeTargetReads(tsv,spec.address);
  const samples=native.epochs[1];
  const report={
    schema:'gng.r3.lda-mmio-native-read.v1',
    instruction_pc:'0x6017',instruction:'LDA_EXT',
    operand_region:spec.region,
    operand_address_private:true,
    native_read_samples_total:native.total,
    native_samples_before_reset:native.epochs[0].length,
    native_samples_after_reset:samples.length,
    native_read_value_exposed:false,
    native_register_checkpoint_seq:sequence,
    native_next_pc:'0x601a',
    generated_js_checkpoints_compared:false,
    independent_read_sample_observed:samples.length>0,
    exact_instruction_bus_correlation_verified:false,
    irq_wake_cause_authenticated:false,
    mmio_device_behavior_modeled:false,
    full_cpu_or_game_equivalence_verified:false,
    game_playable:false,
    status:'BLOCKED_NO_NATIVE_READ_SAMPLE',
    next_task:'Obtain a CPU-instruction-correlated native memory read and implement the MMIO device semantics'
  };
  if(samples.length===0)return report;
  // The read callback PC is an advisory snapshot: never use it to pick one
  // candidate from multiple samples. Demand uniqueness, or block.
  if(samples.length!==1){
    report.status='BLOCKED_AMBIGUOUS_NATIVE_MMIO_READ_SAMPLES';
    return report;
  }
  const sample=samples[0];
  if(sample.mask!==255){
    report.status='BLOCKED_MMIO_READ_MASK_NOT_FULL_BYTE';
    return report;
  }
  const state=executeLdaExt(before.before,addr=>{
    if(addr!==spec.address)throw Error('R36_LDA_ADDRESS_DRIFT');
    return sample.data;
  });
  const fields=diffRegisters(state,after.before);
  report.generated_js_checkpoints_compared=true;
  report.first_divergence=fields.length?{fields}:null;
  report.status=fields.length?'FIRST_DIVERGENCE':
    'SINGLE_NATIVE_READ_CONSISTENT_NOT_INSTRUCTION_CORRELATED';
  report.next_task=fields.length?
    'Investigate LDA/register mismatch; do not override native bus value':
    'Add instruction-tagged MAME read provenance and device-level behavior before declaring MMIO equivalence';
  return report;
}
async function main(){
  const argv=process.argv.slice(2);
  const arg=(k,d)=>{const i=argv.indexOf(k);return i===-1?d:argv[i+1];};
  const out=resolve(arg('--out','out/r3/lda-mmio-read'));
  const rel=relative(resolve('out/r3'),out);
  if(!rel||rel==='..'||rel.startsWith('../')||isAbsolute(rel))
    throw Error('R36_MMIO_PRIVATE_OUTPUT_REQUIRED');
  const romPath=arg('--rom','out/gngb-flat.bin'),
    tracePath=arg('--trace','out/r2/mame-probe/pre-instruction.jsonl'),
    observationsPath=arg('--observations','out/r2/mame-probe/observations.tsv');
  const proof=await runNativeBootWriteGate({
    romPath,tracePath,observationsPath,
    capabilitiesPath:arg('--capabilities','out/r2/mame-probe/capabilities.json'),
    outDir:resolve(out,'same-run-proof')});
  const rom=new Uint8Array(await readFile(romPath));
  const rows=(await readFile(tracePath,'utf8')).trimEnd().split('\n').map(JSON.parse);
  const sync=inspectNativeSyncPrestates(rom,rows,proof);
  const spec=compileLdaAt(rom);
  if(!spec||spec.region!=='PALETTE_OR_MMIO')
    throw Error('R36_LDA_NOT_THE_EXPECTED_NATIVE_MMIO_INSTRUCTION');
  await mkdir(out,{recursive:true});
  const modulePath=resolve(out,'generated-lda.mjs');
  await writeFile(modulePath,emitLdaModule(spec));
  const {executeLdaExt}=await import(pathToFileURL(modulePath).href);
  const report=analyzeNativeMmioLda({rom,rows,bootProof:proof,sync,
    tsv:await readFile(observationsPath,'utf8'),executeLdaExt});
  await writeFile(resolve(out,'report.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
  if(report.status!=='SINGLE_NATIVE_READ_CONSISTENT_NOT_INSTRUCTION_CORRELATED')
    process.exitCode=2;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(e=>{
    console.error('GNG_R36_NATIVE_MMIO=BLOCKED '+e.message);
    process.exitCode=2;
  });
