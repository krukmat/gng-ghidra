#!/usr/bin/env node
/**
 * R3.6.B5. Identify and, where side-effect-free, execute the next static
 * MC6809 instructions after the *independently native map-policy-verified*
 * LDA_EXT at 0x6017. Only one MAME prestate seeds the LDA; from there
 * generated JS accumulates state across consecutive compiled instructions.
 *
 * A neighboring debugger PC does NOT prove SYNC wake, IRQ, or bus causality.
 * The ROM, native trace, MMIO taps and map policy remain private under out/.
 */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,relative,isAbsolute} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {compileAt,emitStaticModule,checkedState,diffRegisters}
  from './r3_static_trace_probe.mjs';
import {compileLdaAt,emitLdaModule} from './r3_lda_extended_gate.mjs';
import {inspectNativeSyncPrestates} from './r3_sync_boundary.mjs';
import {runNativeBootWriteGate} from './r3_compare_sprite_writes.mjs';
import {nativeUnmapPolicy,emitStaticGngbUnmappedRead,
  verifyNativeUnmappedLda} from './r3_unmapped_read_policy.mjs';

const FIRST_PC=0x601a;
const FAMILY=new Map([
  [0x10,'PAGE10_PREFIX'],[0x11,'PAGE11_PREFIX'],[0x13,'SYNC'],
  [0x19,'DAA'],[0x1e,'EXG'],[0x1f,'TFR'],
  [0x30,'LEAX_INDEXED'],[0x31,'LEAY_INDEXED'],
  [0x34,'PSHS'],[0x35,'PULS'],[0x39,'RTS'],[0x3b,'RTI'],
  [0x4d,'TSTA'],[0x5d,'TSTB'],[0x6e,'JMP_INDEXED'],
  [0x8d,'BSR'],[0x9d,'JSR_DIRECT'],[0xa6,'LDA_INDEXED'],
  [0xa7,'STA_INDEXED'],[0xad,'JSR_INDEXED'],[0xb6,'LDA_EXT'],
  [0xb7,'STA_EXT'],[0xbd,'JSR_EXT'],[0xf6,'LDB_EXT'],
  [0xf7,'STB_EXT'],[0xfd,'STD_EXT'],
]);
const hex=n=>'0x'+n.toString(16);
function verifyBoundary(rom,rows,sync,b4){
  if(!(rom instanceof Uint8Array)||rom.length!==65536||
      rom[0xfffe]!==0x60||rom[0xffff]!==0||
      compileLdaAt(rom)?.address!==0x3c00)
    throw Error('R36_B5_FIXED_ROM_LDA_NOT_ATTESTED');
  if(b4?.status!=='MAME_UNMAPPED_POLICY_MATCHES_NATIVE_TAPS_AND_STATIC_LDA'||
      b4.autonomous_read_policy_for_exact_address_validated!==true||
      b4.generated_lda_checkpoint_compared!==true||
      b4.all_native_tap_values_equal_map_policy!==true||
      b4.native_second_epoch_tap_count<1)
    throw Error('R36_B5_NO_SAME_RUN_B4_READ_POLICY_PROOF');
  if(sync?.status!=='SYNC_BYTE_AND_WAIT_BARRIER_PREPARED'||
      sync.epochs?.length!==2||
      sync.epochs[1]?.next_debugger_pc!=='0x6017'||
      !sync.epochs[1]?.irq_masked_in_sync_prestate||
      !sync.epochs[1]?.firq_masked_in_sync_prestate)
    throw Error('R36_B5_MASKED_NATIVE_SYNC_BOUNDARY_MISSING');
  const ldaSeq=sync.epochs[1].sync_prestate_seq+1;
  if(rows[ldaSeq]?.pc!==0x6017||rows[ldaSeq]?.seq!==ldaSeq||
      rows[ldaSeq+1]?.pc!==FIRST_PC||rows[ldaSeq+1]?.seq!==ldaSeq+1)
    throw Error('R36_B5_NATIVE_POST_LDA_CHECKPOINT_MISSING');
  checkedState(rows[ldaSeq].before);
  checkedState(rows[ldaSeq+1].before);
  return ldaSeq;
}
/** Plan candidates without executing or disclosing original ROM bytes. */
export function planPostLdaCandidates(rom,rows,sync,b4,limit=24){
  const ldaSeq=verifyBoundary(rom,rows,sync,b4);
  if(!Number.isInteger(limit)||limit<1||limit>64)
    throw Error('R36_B5_INVALID_SCAN_BUDGET');
  const start=ldaSeq+1;
  const specs=[],candidates=[];
  let stopped='SCAN_BUDGET_OR_TRACE_END';
  for(let i=start;i<rows.length&&candidates.length<limit;i++){
    const r=rows[i];
    if(r?.seq!==i||r.before?.PC!==r.pc)
      throw Error('R36_B5_NATIVE_TRACE_SEQUENCE_INVALID');
    checkedState(r.before);
    const pc=r.pc;
    if(pc<0x6000||pc>0xffef){
      candidates.push({seq:i,pc:hex(pc),supported:false,
        family:'NON_FIXED_ROM_CODE',effects_verified:false});
      stopped='NON_FIXED_ROM_CODE';break;
    }
    const spec=compileAt(rom,pc);
    const sideEffect=!!(spec?.writesSpriteWord||spec?.writesRamByte);
    candidates.push({seq:i,pc:hex(pc),
      family:spec?.name??FAMILY.get(rom[pc])??'REQUIRES_GHIDRA_DECODE',
      supported:!!spec&&!sideEffect,effects_verified:false});
    if(!spec){stopped='FIRST_UNCOMPILED_OPCODE';break;}
    if(sideEffect){stopped='MEMORY_EFFECT_NOT_VERIFIED';break;}
    specs.push(spec);
    if(i+1>=rows.length){stopped='TRACE_END';break;}
  }
  return {ldaSeq,start,specs,candidates,stopped};
}
/**
 * Execute only proven static register/control instructions, comparing
 * accumulated JS state with each native prestate. A mismatch can be a
 * missing external CPU event; it is never silently skipped.
 */
export function inspectPostLdaFrontier({
  rom,rows,sync,b4,executeLdaExt,readGngbUnmappedByte,
  compiledStep,limit=24
}){
  if(typeof executeLdaExt!=='function'||
      typeof readGngbUnmappedByte!=='function'||
      typeof compiledStep!=='function')
    throw Error('R36_B5_STATIC_JS_MODULES_REQUIRED');
  const plan=planPostLdaCandidates(rom,rows,sync,b4,limit);
  const ldaIn=rows[plan.ldaSeq].before;
  let regs=executeLdaExt(ldaIn,addr=>readGngbUnmappedByte(addr));
  if(diffRegisters(regs,rows[plan.start].before).length)
    throw Error('R36_B5_GENERATED_LDA_DIVERGED_FROM_NATIVE_ENTRY');
  let compared=0,stopReason=plan.stopped,firstUnsupported=null;
  let firstDivergence=null;
  let lastCheckpoint=hex(FIRST_PC);
  for(const item of plan.candidates){
    const native=rows[item.seq];
    const atEntry=diffRegisters(regs,native.before);
    if(atEntry.length){
      firstDivergence={pc:item.pc,stage:'accumulated_state',
        fields:atEntry};
      stopReason='FIRST_DIVERGENCE';break;
    }
    if(!item.supported){
      firstUnsupported={seq:item.seq,pc:item.pc,family:item.family};
      stopReason=plan.stopped;break;
    }
    const next=rows[item.seq+1];
    if(!next){stopReason='TRACE_END';break;}
    if(next.seq!==item.seq+1||next.before?.PC!==next.pc)
      throw Error('R36_B5_NATIVE_NEXT_TRACE_SEQUENCE_INVALID');
    checkedState(next.before);
    const output=compiledStep(regs,()=>{
      throw Error('R36_B5_UNVERIFIED_MEMORY_WRITE_FROM_STATIC_STEP');
    });
    const differences=diffRegisters(output,next.before);
    if(differences.length){
      firstDivergence={pc:item.pc,stage:'native_step_or_external_cpu_event',
        fields:differences};
      stopReason='FIRST_DIVERGENCE';break;
    }
    regs=output;
    compared++;
    lastCheckpoint=hex(next.pc);
  }
  return {
    schema:'gng.r3.post-lda-static-frontier.v1',
    status:firstDivergence?'BLOCKED_NATIVE_STEP_OR_EXTERNAL_EVENT_DIVERGENCE':
      firstUnsupported?'POST_LDA_OPCODE_FRONTIER_IDENTIFIED':
      compared>0?'COMPILED_POST_LDA_PREFIX_MATCHED':
      'POST_LDA_FRONTIER_INCOMPLETE',
    lda_pc:'0x6017',first_post_lda_pc:'0x601a',
    native_lda_entry_seq:plan.ldaSeq,
    original_rom_derived_opcode_bytes_exported:false,
    prior_b4_native_map_policy_verified:true,
    accumulated_static_js_registers_from_one_lda_prestate:true,
    mame_state_reinjected_between_steps:false,
    statically_compiled_steps_compared:compared,
    last_matching_checkpoint_pc:lastCheckpoint,
    first_unsupported:firstUnsupported,
    first_divergence:firstDivergence,
    candidate_families:plan.candidates.map(x=>({
      pc:x.pc,family:x.family,supported:x.supported
    })),
    irq_or_sync_wake_causality_verified:false,
    instruction_correlated_bus_access_verified:false,
    post_lda_memory_mmio_effects_verified:false,
    game_playable:false,
    next_task:firstUnsupported?
      'Implement only this native ROM opcode with required register/RAM/MMIO effects and compare the next native checkpoint':
      firstDivergence?
      'Investigate the first divergent CPU checkpoint or external event before extending code':
      'Extend bounded native instruction survey without inventing memory or IRQ behavior',
  };
}
async function main(){
  const argv=process.argv.slice(2);
  const arg=(name,defaultValue)=>{
    const i=argv.indexOf(name);return i<0?defaultValue:argv[i+1];
  };
  const target=resolve(arg('--out','out/r3/post-lda-frontier'));
  const rel=relative(resolve('out/r3'),target);
  if(!rel||rel==='..'||rel.startsWith('../')||isAbsolute(rel))
    throw Error('R36_B5_OUTPUT_MUST_BE_PRIVATE');
  const romPath=arg('--rom','out/gngb-flat.bin'),
    tracePath=arg('--trace','out/r2/mame-probe/pre-instruction.jsonl'),
    observationPath=arg('--observations','out/r2/mame-probe/observations.tsv');
  const proof=await runNativeBootWriteGate({
    romPath,tracePath,observationsPath:observationPath,
    capabilitiesPath:arg('--capabilities','out/r2/mame-probe/capabilities.json'),
    outDir:resolve(target,'same-run-proof')
  });
  const rom=new Uint8Array(await readFile(romPath));
  const rows=(await readFile(tracePath,'utf8')).trimEnd().split('\n')
    .map(JSON.parse);
  const tsv=await readFile(observationPath,'utf8');
  const sync=inspectNativeSyncPrestates(rom,rows,proof);
  const ldaSpec=compileLdaAt(rom);
  const policy=nativeUnmapPolicy(tsv);
  await mkdir(target,{recursive:true});
  const busPath=resolve(target,'generated-unmapped-bus.mjs'),
    ldaPath=resolve(target,'generated-lda.mjs'),
    stepsPath=resolve(target,'generated-post-lda-steps.mjs');
  await writeFile(busPath,emitStaticGngbUnmappedRead(policy));
  await writeFile(ldaPath,emitLdaModule(ldaSpec));
  const {readGngbUnmappedByte}=await import(pathToFileURL(busPath).href);
  const {executeLdaExt}=await import(pathToFileURL(ldaPath).href);
  const verifiedB4=verifyNativeUnmappedLda({
    rom,rows,bootProof:proof,sync,tsv,
    readGngbUnmappedByte,executeLdaExt
  });
  if(verifiedB4.status!=='MAME_UNMAPPED_POLICY_MATCHES_NATIVE_TAPS_AND_STATIC_LDA')
    throw Error('R36_B5_NATIVE_B4_POLICY_GATE_NOT_PASSED');
  // No candidate JS code is emitted until REAL same-run B4 passes.
  const plan=planPostLdaCandidates(rom,rows,sync,verifiedB4);
  await writeFile(stepsPath,emitStaticModule(plan.specs));
  const {compiledStep}=await import(pathToFileURL(stepsPath).href);
  const report=inspectPostLdaFrontier({
    rom,rows,sync,b4:verifiedB4,executeLdaExt,
    readGngbUnmappedByte,compiledStep
  });
  await writeFile(resolve(target,'report.json'),
    JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
  if(!['POST_LDA_OPCODE_FRONTIER_IDENTIFIED',
        'COMPILED_POST_LDA_PREFIX_MATCHED'].includes(report.status))
    process.exitCode=2;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(err=>{
    console.error('GNG_R36_B5_FRONTIER=BLOCKED '+err.message);
    process.exitCode=2;
  });
