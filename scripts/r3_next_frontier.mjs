#!/usr/bin/env node
/**
 * R3.4 candidate selection after a native-verified sprite-RAM boot loop.
 * The private ROM and MAME pretrace stay on the operator's machine.
 * This is a planning/audit gate, NOT a CPU or memory-equivalence claim.
 */
import {createHash} from 'node:crypto';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {compileAt} from './r3_static_trace_probe.mjs';
import {runNativeBootWriteGate} from './r3_compare_sprite_writes.mjs';

const BOOT_PCS=new Set([0x6000,0x6002,0x6005,0x6009,
  0x600c,0x600e,0x6010,0x6012]);
const KNOWN=new Map([
  [0x13,'SYNC'],[0x16,'LBRA'],[0x17,'LBSR'],[0x1a,'ORCC'],
  [0x1c,'ANDCC'],[0x1e,'EXG'],[0x1f,'TFR'],
  [0x20,'BRA'],[0x26,'BNE'],[0x27,'BEQ'],
  [0x34,'PSHS'],[0x35,'PULS'],[0x36,'PSHU'],[0x37,'PULU'],
  [0x39,'RTS'],[0x3b,'RTI'],[0x3c,'CWAI'],[0x4f,'CLRA'],
  [0x5f,'CLRB'],[0x7e,'JMP_EXT'],[0x7f,'CLR_EXT'],
  [0x83,'SUBD_IMM'],[0x86,'LDA_IMM'],[0x8c,'CMPX_IMM'],
  [0x8d,'BSR'],[0x8e,'LDX_IMM'],[0x9d,'JSR_DIRECT'],
  [0xad,'JSR_INDEXED'],[0xb7,'STA_EXT'],[0xbd,'JSR_EXT'],
  [0xc3,'ADDD_IMM'],[0xc6,'LDB_IMM'],[0xcc,'LDD_IMM'],
  [0xce,'LDU_IMM'],[0xf7,'STB_EXT'],[0xfd,'STD_EXT'],
]);
function checkedRow(r,index){
  if(!r||r.schema!=='gng.r2.pre-instruction.v1'||
      r.kind!=='pre_instruction'||r.origin!=='mame-native-tracelog'||
      r.seq!==index||!Number.isInteger(r.pc)||r.pc!==r.before?.PC)
    throw Error('R3_FRONTIER_PRETRACE_INCOMPATIBLE');
}
function labelAt(rom,pc){
  const op=rom[pc];
  if(op===0x10)return 'PAGE_10_PREFIX_NEEDS_GHIDRA';
  if(op===0x11)return 'PAGE_11_PREFIX_NEEDS_GHIDRA';
  return KNOWN.get(op)??'UNCLASSIFIED_NEEDS_GHIDRA';
}
/** Pure frontier classifier; never expose opcode bytes or register values. */
export function inspectPostBootFrontier(rom,rows,proof){
  if(!(rom instanceof Uint8Array)||rom.length!==65536 ||
      rom[0xfffe]!==0x60||rom[0xffff]!==0)
    throw Error('R3_FRONTIER_NEEDS_VERIFIED_FLAT_IMAGE');
  if(!Array.isArray(rows)||rows.length<2)
    throw Error('R3_FRONTIER_PRETRACE_EMPTY');
  rows.forEach(checkedRow);
  if(proof?.status!=='PASS_BOOT_SPRITE_RAM_WRITE_BYTES'||
      proof.boot_runs_compared!==2||
      proof.compiled_sprite_ram_word_writes!==384||
      proof.native_sprite_byte_samples!==768||
      proof.actual_mame_sprite_byte_writes_compared!==true||
      !Array.isArray(proof.per_boot)||proof.per_boot.length!==2||
      proof.per_boot.some(x=>x.uniquely_matched!==true||
        x.native_sample_count!==384||x.expected_byte_writes!==384||
        x.unverified_other_native_writes!==0))
    throw Error('R3_FRONTIER_MISSING_COMPLETE_NATIVE_BOOT_WRITE_PROOF');
  const starts=[];
  for(let i=0;i<rows.length-1;i++){
    if(![0x6000,0x6002].includes(rows[i].pc))continue;
    if(i>0 && BOOT_PCS.has(rows[i-1].pc))continue;
    starts.push(i);
  }
  if(starts.length!==2)throw Error('R3_FRONTIER_BOOT_START_AMBIGUOUS');
  const frontiers=[];
  for(const start of starts){
    let end=start;
    while(end<rows.length&&BOOT_PCS.has(rows[end].pc))end++;
    if(end>=rows.length||rows[end].pc!==0x6014)
      throw Error('R3_FRONTIER_BOOT_EXIT_NOT_OBSERVED');
    const bootSteps=end-start;
    const expectedBootSteps=rows[start].pc===0x6000?388:387;
    if(bootSteps!==expectedBootSteps)
      throw Error('R3_FRONTIER_UNEXPECTED_BOOT_INSTRUCTION_COUNT');
    const bootRows=rows.slice(start,end);
    if(bootRows.filter(r=>r.pc===0x600c).length!==96||
        bootRows.filter(r=>r.pc===0x600e).length!==96)
      throw Error('R3_FRONTIER_MISSING_BOOT_SPRITE_STORES');
    const exitSeq=end;
    let postBootCompiledSteps=0;
    while(end<rows.length-1 && compileAt(rom,rows[end].pc)){
      postBootCompiledSteps++;
      end++;
      if(postBootCompiledSteps>32)
        throw Error('R3_FRONTIER_POST_BOOT_SCAN_BUDGET_EXCEEDED');
    }
    if(end>=rows.length-1)
      throw Error('R3_FRONTIER_UNSUPPORTED_PC_NOT_OBSERVED');
    frontiers.push({
      start_seq:start,
      start_pc:'0x'+rows[start].pc.toString(16),
      boot_instruction_count:bootSteps,
      boot_exit_seq:exitSeq,
      boot_exit_pc:'0x6014',
      already_compiled_after_boot:postBootCompiledSteps,
      first_uncompiled_seq:end,
      first_uncompiled_pc:'0x'+rows[end].pc.toString(16),
      candidate_opcode_family:labelAt(rom,rows[end].pc),
      source:'ROM opcode-family hint, not an instruction decode; verify with Ghidra/native CPU oracle',
    });
  }
  if(frontiers[0].first_uncompiled_pc!==
      frontiers[1].first_uncompiled_pc)
    throw Error('R3_FRONTIER_BOOT_EXITS_DIFFER_BETWEEN_EPOCHS');
  return {
    schema:'gng.r3.post-boot-frontier.v1',
    status:'FRONTIER_IDENTIFIED_NOT_COMPILED',
    boot_runs_with_native_ram_write_proof:2,
    boot_frontiers:frontiers,
    unique_first_uncompiled_pc:frontiers[0].first_uncompiled_pc,
    next_task:'Confirm exact instruction and side-effects using existing Ghidra/native CPU oracle; then compile only that instruction',
    no_new_mame_required:true,
    opcode_bytes_or_register_values_exported:false,
    next_instruction_cpu_equivalence_verified:false,
    boot_sprite_ram_bytes_verified:true,
    full_ram_irq_bank_bus_verified:false,
    game_playable:false,
  };
}
async function main(){
  const args=process.argv.slice(2);
  const val=(flag,defaultValue)=>{
    const i=args.indexOf(flag);return i<0?defaultValue:args[i+1];
  };
  const romPath=val('--rom','out/gngb-flat.bin');
  const tracePath=val('--trace','out/r2/mame-probe/pre-instruction.jsonl');
  const observationsPath=val('--observations','out/r2/mame-probe/observations.tsv');
  const capabilitiesPath=val('--capabilities','out/r2/mame-probe/capabilities.json');
  const reportPath=resolve(val('--out','out/r3/next-frontier'));
  const allowed=resolve('out/r3');
  const rel=relative(allowed,reportPath);
  if(!rel||rel==='..'||rel.startsWith('../')||isAbsolute(rel))
    throw Error('R3_FRONTIER_PRIVATE_OUTPUT_REQUIRED');
  // Recompute R3.3 on the SAME current native observations, CPU pretrace
  // and ROM image. A stale or copied standalone PASS JSON is never enough.
  // No MAME process runs; this is fully offline re-verification.
  const evidence=await runNativeBootWriteGate({
    romPath,tracePath,observationsPath,capabilitiesPath,
    outDir:resolve(reportPath,'verified-reference')
  });
  const image=await readFile(romPath),trace=await readFile(tracePath,'utf8');
  const rows=trace.trimEnd().split('\n').map(line=>JSON.parse(line));
  const result=inspectPostBootFrontier(new Uint8Array(image),rows,evidence);
  result.evidence_reverified_from_same_private_files=true;
  result.rom_sha256=createHash('sha256').update(image).digest('hex');
  result.trace_sha256=createHash('sha256').update(trace.trim()).digest('hex');
  await mkdir(reportPath,{recursive:true});
  await writeFile(resolve(reportPath,'report.json'),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result,null,2));
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(e=>{
    console.error('GNG_R3_FRONTIER=BLOCKED '+e.message);
    process.exitCode=2;
  });
