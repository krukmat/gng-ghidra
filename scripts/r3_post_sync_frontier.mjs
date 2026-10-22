#!/usr/bin/env node
/**
 * R3.6-A: locate compiled and unsupported ROM instructions *after* the
 * 0x6016 SYNC barrier, using the already-captured second MAME boot.
 *
 * Observing the next debugger PC=0x6017 is NOT independent evidence
 * of an asserted IRQ or SYNCACK. This tool never resumes SYNC itself
 * and never claims generated JS executed past that boundary.
 */
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {compileAt,checkedState} from './r3_static_trace_probe.mjs';
import {inspectNativeSyncPrestates} from './r3_sync_boundary.mjs';
import {runNativeBootWriteGate} from './r3_compare_sprite_writes.mjs';

const OPCODES=new Map([
  [0x10,'PAGE10'],[0x11,'PAGE11'],[0x13,'SYNC'],
  [0x1e,'EXG'],[0x1f,'TFR'],[0x34,'PSHS'],[0x35,'PULS'],
  [0x39,'RTS'],[0x3b,'RTI'],[0x4f,'CLRA'],[0x5f,'CLRB'],
  [0x6e,'JMP_INDEXED'],[0x7f,'CLR_EXT'],[0x8c,'CMPX_IMM'],
  [0x8d,'BSR'],[0x9d,'JSR_DIRECT'],[0xa6,'LDA_INDEXED'],
  [0xa7,'STA_INDEXED'],[0xad,'JSR_INDEXED'],[0xb6,'LDA_EXT'],
  [0xb7,'STA_EXT'],[0xbd,'JSR_EXT'],[0xf7,'STB_EXT'],[0xfd,'STD_EXT']
]);
function entry(row,rom){
  const pc=row.pc, decoded=compileAt(rom,pc);
  return {
    pc:'0x'+pc.toString(16),
    supported:!!decoded,
    family:decoded?.name??OPCODES.get(rom[pc])??'REQUIRES_GHIDRA_DISASSEMBLY',
    effects_on_bus_verified:false
  };
}
export function inspectPostSync(rom,rows,sync,limit=32){
  if(!(rom instanceof Uint8Array)||rom.length!==65536||
      rom[0xfffe]!==0x60||rom[0xffff]!==0)
    throw Error('R3_POST_SYNC_UNVERIFIED_FLAT_ROM');
  if(!Number.isInteger(limit)||limit<1||limit>128)
    throw Error('R3_POST_SYNC_INVALID_SCAN_LIMIT');
  if(sync?.status!=='SYNC_BYTE_AND_WAIT_BARRIER_PREPARED'||
      sync.boundary_prestate_count!==2||sync.epochs?.length!==2||
      sync.epochs[1]?.next_debugger_pc!=='0x6017'||
      sync.epochs[1]?.next_pc_equals_fallthrough!==true||
      !sync.epochs[1]?.irq_masked_in_sync_prestate||
      !sync.epochs[1]?.firq_masked_in_sync_prestate)
    throw Error('R3_POST_SYNC_NO_GROUNDED_MASKED_FALLTHROUGH');
  const index=sync.epochs[1].sync_prestate_seq;
  if(rows[index]?.pc!==0x6016||rows[index+1]?.pc!==0x6017)
    throw Error('R3_POST_SYNC_BOUNDARY_SEQUENCE_MISSING');
  const surveyed=[];
  for(let i=index+1;i<rows.length&&surveyed.length<limit;i++){
    const row=rows[i];
    if(row.seq!==i||row.before?.PC!==row.pc)
      throw Error('R3_POST_SYNC_ROW_CORRUPTION');
    checkedState(row.before);
    if(row.pc<0x6000)break; // bank code outside fixed-ROM is not allowed
    const info=entry(row,rom);
    info.seq=row.seq;
    surveyed.push(info);
    if(!info.supported)break;
  }
  if(surveyed.length===0)throw Error('R3_POST_SYNC_NO_NEXT_CPU_INSTRUCTION');
  const firstUnsupported=surveyed.find(x=>!x.supported)??null;
  return {
    schema:'gng.r3.post-sync-instruction-frontier.v1',
    status:firstUnsupported?'POST_SYNC_OPCODE_FRONTIER_IDENTIFIED':
      'POST_SYNC_ONLY_SUPPORTED_WINDOW_OBSERVED',
    starting_pc:'0x6017',
    start_seq:index+1,
    inspected_instruction_count:surveyed.length,
    supported_fixed_rom_prefix:surveyed.filter(x=>x.supported).length,
    first_unsupported:firstUnsupported,
    instruction_families:surveyed.map(({pc,family,supported})=>({pc,family,supported})),
    wait_to_resume_transition_executed_by_js:false,
    cause_of_native_sync_wake_observed:false,
    native_cpu_irq_entry_verified:false,
    generated_code_after_sync_verified:false,
    bus_io_or_bank_equivalence_verified:false,
    game_playable:false,
    next_task:'Use first unsupported ROM opcode to prioritize post-SYNC static compilation, separately from native IRQ signal proof'
  };
}
async function main(){
  const argv=process.argv.slice(2);
  const arg=(key,def)=>{const i=argv.indexOf(key);return i<0?def:argv[i+1];};
  const out=resolve(arg('--out','out/r3/post-sync-frontier'));
  const diff=relative(resolve('out/r3'),out);
  if(!diff||diff==='..'||diff.startsWith('../')||isAbsolute(diff))
    throw Error('R3_POST_SYNC_PRIVATE_OUTPUT_REQUIRED');
  const romPath=arg('--rom','out/gngb-flat.bin');
  const tracePath=arg('--trace','out/r2/mame-probe/pre-instruction.jsonl');
  const proof=await runNativeBootWriteGate({
    romPath,tracePath,
    observationsPath:arg('--observations','out/r2/mame-probe/observations.tsv'),
    capabilitiesPath:arg('--capabilities','out/r2/mame-probe/capabilities.json'),
    outDir:resolve(out,'same-run-proof')
  });
  const rom=new Uint8Array(await readFile(romPath));
  const rows=(await readFile(tracePath,'utf8')).trim().split('\n')
    .map(JSON.parse);
  const sync=inspectNativeSyncPrestates(rom,rows,proof);
  const result=inspectPostSync(rom,rows,sync);
  await mkdir(out,{recursive:true});
  await writeFile(resolve(out,'report.json'),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result,null,2));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(e=>{
    console.error('GNG_R3_POST_SYNC=BLOCKED '+e.message);
    process.exitCode=2;
  });
