#!/usr/bin/env node
/**
 * R3.5: address-specific MC6809 SYNC barrier and ROM-private MAME boundary audit.
 *
 * MAME base6x09.lst: SYNC waits for any NMI/FIRQ/IRQ line to be asserted,
 * EVEN IF MASKED. A masked line resumes execution without entering handler.
 * An unmasked line requires CPU IRQ stack and vector semantics not yet built.
 * Source: https://github.com/mamedev/mame/blob/master/src/devices/cpu/m6809/base6x09.lst
 */
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,relative,isAbsolute} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {inspectPostBootFrontier} from './r3_next_frontier.mjs';
import {runNativeBootWriteGate} from './r3_compare_sprite_writes.mjs';
import {checkedState} from './r3_static_trace_probe.mjs';

export const SYNC_PC=0x6016,RESUME_PC=0x6017;
export function compileSyncAt(rom,pc){
  if(!(rom instanceof Uint8Array)||rom.length!==65536||
      rom[0xfffe]!==0x60||rom[0xffff]!==0||
      pc!==SYNC_PC||rom[pc]!==0x13)return null;
  return Object.freeze({
    pc,opcode_name:'SYNC',length:1,resume_pc:RESUME_PC,
    waits_for_external_interrupt_line:true,
    wake_requires_interrupt_acceptance:false,
    changes_cc_on_entry:false,irq_entry_implemented:false
  });
}
/** Generate one STATIC JS block; no 6809 opcode decoder in the runtime. */
export function emitSyncModule(spec){
  if(!spec||spec.pc!==SYNC_PC||
      spec.opcode_name!=='SYNC'||spec.length!==1||
      spec.resume_pc!==RESUME_PC)
    throw Error('R3_UNVERIFIED_SYNC_SPEC');
  const source=[
    '// PRIVATE generated from verified fixed-ROM 6809 SYNC at 0x6016.',
    '// Runtime requires an explicit externally supplied asserted line.',
    'const IRQ_MASK=0x10,FIRQ_MASK=0x40;',
    'export function enterSync(regs){',
    "  if(!regs||regs.PC!==0x6016)throw Error('SYNC_WRONG_ENTRY_PC');",
    '  const state={...regs,PC:0x6017};',
    "  return Object.freeze({phase:'SYNC_WAIT',state:Object.freeze(state)});",
    '}',
    'export function wakeSync(waiting,event){',
    "  if(!waiting||waiting.phase!=='SYNC_WAIT')",
    "    throw Error('SYNC_NOT_WAITING');",
    "  if(!event||!['IRQ','FIRQ','NMI'].includes(event.line)||",
    "      event.asserted!==true)",
    "    throw Error('SYNC_REQUIRES_ASSERTED_EXTERNAL_LINE');",
    '  const cc=waiting.state.CC;',
    "  if(!Number.isInteger(cc)||cc<0||cc>255)",
    "    throw Error('SYNC_INVALID_CC');",
    "  const masked=(event.line==='IRQ'&&(cc&IRQ_MASK)!==0)||",
    "    (event.line==='FIRQ'&&(cc&FIRQ_MASK)!==0);",
    '  return Object.freeze({',
    "    phase:masked?'RUNNABLE_AFTER_MASKED_WAKE':'INTERRUPT_ENTRY_REQUIRED',",
    '    state:waiting.state,line:event.line,',
    '    irq_handler_executed:false,irq_stack_or_vector_modeled:false,',
    '    signal_provenance_authenticated:false',
    '  });',
    '}'
  ];
  return source.join('\n')+'\n';
}

/**
 * Describe the next debugger instruction after the two genuine boot SYNC
 * PCs. It is NOT evidence of IRQ line assertion or entry.
 */
export function inspectNativeSyncPrestates(rom,rows,bootWriteProof){
  const frontier=inspectPostBootFrontier(rom,rows,bootWriteProof);
  if(frontier.unique_first_uncompiled_pc!=='0x6016'||
      frontier.boot_frontiers.length!==2)
    throw Error('R3_SYNC_FRONTIER_NOT_EXACT_6016_TWICE');
  if(!compileSyncAt(rom,SYNC_PC))
    throw Error('R3_SYNC_BYTE_13_NOT_CONFIRMED_IN_FIXED_ROM');
  const epochs=frontier.boot_frontiers.map((f,epoch)=>{
    const at=rows[f.first_uncompiled_seq],next=rows[f.first_uncompiled_seq+1];
    if(!at||at.pc!==SYNC_PC||!next)
      throw Error('R3_SYNC_NATIVE_PRESTATES_INCOMPLETE');
    checkedState(at.before);
    checkedState(next.before);
    return {
      epoch,sync_prestate_seq:f.first_uncompiled_seq,
      sync_pc:'0x6016',
      next_debugger_pc:'0x'+next.pc.toString(16),
      irq_masked_in_sync_prestate:!!(at.before.CC&0x10),
      firq_masked_in_sync_prestate:!!(at.before.CC&0x40),
      next_pc_equals_fallthrough:next.pc===RESUME_PC,
      classification:next.pc===RESUME_PC?
        'FALLTHROUGH_OBSERVED_CAUSING_LINE_NOT_CAPTURED':
        'NON_FALLTHROUGH_OBSERVED_IRQ_VECTOR_OR_OTHER_CAUSE_UNVERIFIED',
      event_source_verified:false,
      irq_acceptance_verified:false
    };
  });
  return {
    schema:'gng.r3.native-sync-boundary.v1',
    status:'SYNC_BYTE_AND_WAIT_BARRIER_PREPARED',
    candidate_pc:'0x6016',candidate_opcode:'SYNC',
    verified_rom_instruction_byte:true,
    two_native_boots_with_sprite_ram_evidence:true,
    boundary_prestate_count:epochs.length,
    epochs,
    emitted_js_waits_without_external_line:true,
    irq_or_firq_or_nmi_assertion_observed:false,
    interrupt_acceptance_or_stack_verified:false,
    cpu_post_sync_equivalence_verified:false,
    game_playable:false,
    next_task:'Acquire native independent asserted-line and interrupt-entry evidence; do not infer IRQ from next PC'
  };
}
async function main(){
  const argv=process.argv.slice(2);
  const get=(key,fallback)=>{
    const i=argv.indexOf(key);return i<0?fallback:argv[i+1];
  };
  const romPath=get('--rom','out/gngb-flat.bin');
  const tracePath=get('--trace','out/r2/mame-probe/pre-instruction.jsonl');
  const observationsPath=get('--observations','out/r2/mame-probe/observations.tsv');
  const capabilitiesPath=get('--capabilities','out/r2/mame-probe/capabilities.json');
  const target=resolve(get('--out','out/r3/sync-boundary'));
  const rel=relative(resolve('out/r3'),target);
  if(!rel||rel==='..'||rel.startsWith('../')||isAbsolute(rel))
    throw Error('R3_SYNC_OUTPUT_MUST_STAY_PRIVATE_OUT_R3');
  // Actual proof is recomputed from the SAME native artifacts. No cached PASS.
  const proof=await runNativeBootWriteGate({romPath,tracePath,
    observationsPath,capabilitiesPath,outDir:resolve(target,'boot-proof')});
  const rom=new Uint8Array(await readFile(romPath));
  const rows=(await readFile(tracePath,'utf8')).trim().split('\n')
    .map(x=>JSON.parse(x));
  const report=inspectNativeSyncPrestates(rom,rows,proof);
  await mkdir(target,{recursive:true});
  const output=resolve(target,'generated-sync.mjs');
  await writeFile(output,emitSyncModule(compileSyncAt(rom,SYNC_PC)));
  const {enterSync}=await import(pathToFileURL(output).href);
  for(const epoch of report.epochs){
    const registers=rows[epoch.sync_prestate_seq].before;
    const result=enterSync(registers);
    if(result.phase!=='SYNC_WAIT'||result.state.PC!==RESUME_PC||
        result.state.CC!==registers.CC)
      throw Error('R3_GENERATED_SYNC_WAIT_DIVERGED');
  }
  report.generated_static_js_wait_entered_from_real_prestates=true;
  await writeFile(resolve(target,'report.json'),
    JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(e=>{
    console.error('GNG_R3_SYNC=BLOCKED '+e.message);
    process.exitCode=2;
  });
