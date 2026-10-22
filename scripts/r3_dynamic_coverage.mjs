#!/usr/bin/env node
/**
 * A0.1: ROM-private, read-only dynamic coverage profile of existing MAME
 * pre-instruction trace and *current* static compiler eligibility.
 *
 * Counts sampled PCs, NOT the total game's instructions or full CFG.
 * Adjacent debugger prestates do not authenticate IRQ, bank, bus or a
 * control-flow edge. No raw opcode bytes, registers, read data or ROM-derived
 * JavaScript are printed or emitted.
 */
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {compileAt,checkedState} from './r3_static_trace_probe.mjs';
import {compileLdaAt} from './r3_lda_extended_gate.mjs';
import {compileSyncAt} from './r3_sync_boundary.mjs';
import {runNativeBootWriteGate} from './r3_compare_sprite_writes.mjs';
import {inspectNativeSyncPrestates} from './r3_sync_boundary.mjs';

const hx=n=>'0x'+n.toString(16).padStart(4,'0');
const MODES=['IMM','DIRECT','INDEXED','EXT'];
const AA=['SUBA','CMPA','SBCA','SUBD','ANDA','BITA','LDA','STA',
  'EORA','ADCA','ORA','ADDA','CMPX','JSR_OR_BSR','LDX','STX'];
const BB=['SUBB','CMPB','SBCB','ADDD','ANDB','BITB','LDB','STB',
  'EORB','ADCB','ORB','ADDB','LDD','STD','LDU','STU'];
const FIXED=new Map([
  [0x12,'NOP'],[0x13,'SYNC'],[0x16,'LBRA'],[0x17,'LBSR'],
  [0x19,'DAA'],[0x1a,'ORCC_IMM'],[0x1c,'ANDCC_IMM'],
  [0x1d,'SEX'],[0x1e,'EXG'],[0x1f,'TFR'],
  [0x34,'PSHS'],[0x35,'PULS'],[0x36,'PSHU'],[0x37,'PULU'],
  [0x39,'RTS'],[0x3a,'ABX'],[0x3b,'RTI'],[0x3c,'CWAI'],
  [0x3d,'MUL'],[0x3f,'SWI'],[0x7e,'JMP_EXT'],
]);
const PREFIX10=new Map([
  [0x3f,'SWI2'],[0x8e,'LDY_IMM'],[0x9e,'LDY_DIRECT'],
  [0xae,'LDY_INDEXED'],[0xbe,'LDY_EXT'],
  [0x8c,'CMPY_IMM'],[0x9c,'CMPY_DIRECT'],
  [0xac,'CMPY_INDEXED'],[0xbc,'CMPY_EXT'],
  [0xce,'LDS_IMM'],[0xde,'LDS_DIRECT'],
  [0xee,'LDS_INDEXED'],[0xfe,'LDS_EXT'],
  [0x9f,'STY_DIRECT'],[0xaf,'STY_INDEXED'],[0xbf,'STY_EXT'],
  [0xdf,'STS_DIRECT'],[0xef,'STS_INDEXED'],[0xff,'STS_EXT'],
]);
const PREFIX11=new Map([[0x3f,'SWI3'],
  [0x83,'CMPU_IMM'],[0x93,'CMPU_DIRECT'],
  [0xa3,'CMPU_INDEXED'],[0xb3,'CMPU_EXT'],
  [0x8c,'CMPS_IMM'],[0x9c,'CMPS_DIRECT'],
  [0xac,'CMPS_INDEXED'],[0xbc,'CMPS_EXT']]);

/** Names are coverage *hints*, NOT decoded/verified semantics. */
export function opcodeFamily(rom,pc){
  if(!(rom instanceof Uint8Array)||rom.length!==65536||
      !Number.isInteger(pc)||pc<0x6000||pc>0xffff)
    return 'NON_FIXED_ROM';
  const op=rom[pc];
  if(op===0x10||op===0x11){
    if(pc===0xffff)return 'TRUNCATED_PREFIX';
    const next=rom[pc+1];
    if(next>=0x20&&next<=0x2f && op===0x10)
      return 'PAGE10_LONG_BRANCH';
    const label=(op===0x10?PREFIX10:PREFIX11).get(next);
    return label??(op===0x10?'PAGE10_UNCLASSIFIED':'PAGE11_UNCLASSIFIED');
  }
  if(FIXED.has(op))return FIXED.get(op);
  if(op>=0x20&&op<=0x2f)return 'SHORT_BRANCH';
  if(op>=0x30&&op<=0x33)return 'LEA_INDEXED';
  if(op>=0x40&&op<=0x5f)return 'REG_UNARY';
  if(op>=0x60&&op<=0x6f)return 'MEM_UNARY_INDEXED';
  if(op>=0x70&&op<=0x7f)return 'MEM_UNARY_EXT';
  if(op>=0x80){
    const isA=op<0xc0;
    const group=isA?AA:BB;
    const mode=MODES[(op>>>4)&3];
    return (group[op&15]??'UNKNOWN')+'_'+mode;
  }
  return 'UNCLASSIFIED_6809_OPCODE';
}
function classOf(rom,pc){
  if(pc<0x4000)return {eligibility:'NON_ROM_OR_UNVERIFIED_EXECUTION',
    family:'NON_ROM_EXECUTION_UNVERIFIED'};
  if(pc<0x6000)return {eligibility:'BANKED_ROM_NOT_PROVEN',
    family:'BANKED_OPCODE_UNVERIFIED'};
  const compiled=compileAt(rom,pc);
  if(compiled)return {eligibility:compiled.writesSpriteWord?
    'AOT_SPRITE_WRITE_SITE':'AOT_STATIC_AVAILABLE',family:compiled.name};
  if(pc===0x6016&&compileSyncAt(rom,pc))
    return {eligibility:'AOT_SYNC_WAIT_ONLY',family:'SYNC'};
  if(pc===0x6017&&compileLdaAt(rom,pc)?.address===0x3c00)
    return {eligibility:'AOT_LDA_REQUIRES_B4_PROOF',family:'LDA_EXT'};
  return {eligibility:'UNSUPPORTED_OR_UNVERIFIED_OPCODE',
    family:opcodeFamily(rom,pc)};
}
/**
 * A0 does not require a new MAME run: the caller validates existing native
 * R3.3 / SYNC artifacts. No constant "game coverage %" is inferred.
 */
export function profileDynamicCoverage(rom,rows,sync,{top=12}={}){
  if(!(rom instanceof Uint8Array)||rom.length!==65536||
      rom[0xfffe]!==0x60||rom[0xffff]!==0||
      !Array.isArray(rows)||rows.length<3)
    throw Error('A0_NATIVE_ROM_OR_PRETRACE_INVALID');
  if(!Number.isInteger(top)||top<1||top>50)
    throw Error('A0_INVALID_TOP_LIMIT');
  const epochs=sync?.epochs;
  if(sync?.status!=='SYNC_BYTE_AND_WAIT_BARRIER_PREPARED'||
      !Array.isArray(epochs)||epochs.length!==2||
      epochs[0].sync_pc!=='0x6016'||epochs[1].sync_pc!=='0x6016'||
      epochs[0].next_debugger_pc!=='0x6000'||
      epochs[1].next_debugger_pc!=='0x6017'||
      !epochs[1].irq_masked_in_sync_prestate||
      !epochs[1].firq_masked_in_sync_prestate)
    throw Error('A0_NATIVE_SYNC_AND_RESET_PROVENANCE_REQUIRED');
  const cut=epochs[0].sync_prestate_seq+1;
  const afterLda=epochs[1].sync_prestate_seq+2;
  if(cut<=0||cut>=rows.length||afterLda>=rows.length||
      rows[cut]?.pc!==0x6000||
      rows[epochs[1].sync_prestate_seq]?.pc!==0x6016||
      rows[afterLda-1]?.pc!==0x6017||
      rows[afterLda]?.pc!==0x601a)
    throw Error('A0_NATIVE_BOUNDARY_SEQUENCE_MISSING');
  const pcs=new Map(),families=new Map(),eligibilityCounts=new Map();
  const edges=new Map();
  let fixed=0,codegenEligible=0,unknown=0;
  for(let i=0;i<rows.length;i++){
    const r=rows[i];
    if(r?.schema!=='gng.r2.pre-instruction.v1'||
       r.kind!=='pre_instruction'||r.origin!=='mame-native-tracelog'||
       r.seq!==i||!Number.isInteger(r.pc)||r.pc<0||r.pc>0xffff||
       r.before?.PC!==r.pc)
      throw Error('A0_NATIVE_TRACE_SCHEMA_OR_SEQUENCE_INVALID');
    checkedState(r.before);
    const category=classOf(rom,r.pc);
    if(r.pc>=0x6000)fixed++;
    if(category.eligibility.startsWith('AOT_'))codegenEligible++;
    if(category.eligibility==='UNSUPPORTED_OR_UNVERIFIED_OPCODE')unknown++;
    const prev=pcs.get(r.pc)??{pc:r.pc,hits:0,
      first_seq:i,first_epoch:i<cut?0:1,...category};
    if(prev.eligibility!==category.eligibility||
       prev.family!==category.family)
      throw Error('A0_INCONSISTENT_PC_CLASSIFICATION');
    prev.hits++;
    pcs.set(r.pc,prev);
    const familyKey=category.eligibility+'|'+category.family;
    const f=families.get(familyKey)??{
      eligibility:category.eligibility,family:category.family,
      hits:0,distinct:new Set()};
    f.hits++;f.distinct.add(r.pc);families.set(familyKey,f);
    eligibilityCounts.set(category.eligibility,
      (eligibilityCounts.get(category.eligibility)??0)+1);
    if(i>0&&i!==cut&&i!==epochs[1].sync_prestate_seq+1){
      const key=hx(rows[i-1].pc)+'→'+hx(r.pc);
      edges.set(key,(edges.get(key)??0)+1);
    }
  }
  const seqAt=rows[afterLda];
  const byHits=(a,b)=>b.hits-a.hits||
    (b.distinct_pc??0)-(a.distinct_pc??0)||
    (a.pc??0)-(b.pc??0);
  const gaps=[...pcs.values()]
    .filter(x=>x.eligibility==='UNSUPPORTED_OR_UNVERIFIED_OPCODE')
    .sort(byHits).slice(0,top)
    .map(x=>({pc:hx(x.pc),family:x.family,samples:x.hits}));
  const blockedFamilies=[...families.values()]
    .filter(x=>x.eligibility==='UNSUPPORTED_OR_UNVERIFIED_OPCODE')
    .map(x=>({family:x.family,samples:x.hits,
      distinct_pc:x.distinct.size}))
    .sort(byHits).slice(0,top);
  const categories=[...eligibilityCounts.entries()]
    .map(([eligibility,samples])=>({eligibility,samples}))
    .sort((a,b)=>b.samples-a.samples||a.eligibility.localeCompare(b.eligibility));
  return {
    schema:'gng.a0.native-dynamic-coverage.v1',
    status:'NATIVE_TRACE_COVERAGE_PROFILED_NOT_RUNTIME_EQUIVALENCE',
    native_prestate_samples:rows.length,
    native_two_reset_epochs_corroborated:true,
    native_epochs:[{epoch:0,samples:cut},{epoch:1,samples:rows.length-cut}],
    distinct_observed_pcs:pcs.size,
    distinct_fixed_rom_pcs:[...pcs.keys()].filter(pc=>pc>=0x6000).length,
    fixed_rom_prestate_samples:fixed,
    aot_codegen_eligible_samples:codegenEligible,
    aot_codegen_eligible_share_of_observed_samples:
      Number((codegenEligible/rows.length).toFixed(4)),
    unsupported_fixed_rom_samples:unknown,
    distinct_unsupported_fixed_rom_pcs:
      [...pcs.values()].filter(x=>
        x.eligibility==='UNSUPPORTED_OR_UNVERIFIED_OPCODE').length,
    eligibility_categories:categories,
    most_repeated_unsupported_families:blockedFamilies,
    highest_frequency_unsupported_pcs:gaps,
    post_lda_first_pc:hx(seqAt.pc),
    post_lda_first_family:classOf(rom,seqAt.pc).family,
    post_lda_first_aot_eligibility:classOf(rom,seqAt.pc).eligibility,
    observed_non_reset_non_sync_adjacency_edges:edges.size,
    dynamic_edges_are_cpu_control_flow_proven:false,
    sampled_pc_coverage_is_total_rom_coverage:false,
    full_cpu_bus_irq_or_gameplay_equivalence_verified:false,
    raw_rom_bytes_registers_or_dynamic_read_values_exported:false,
    game_playable:false,
    next_task:'Batch implement dominant unsupported opcode families and add trusted bus provenance; retain all R0-R3 gates'
  };
}
async function main(){
  const args=process.argv.slice(2);
  const arg=(name,fallback)=>{
    const i=args.indexOf(name);return i<0?fallback:args[i+1];
  };
  const out=resolve(arg('--out','out/r3/dynamic-coverage'));
  const rel=relative(resolve('out/r3'),out);
  if(!rel||rel==='..'||rel.startsWith('../')||isAbsolute(rel))
    throw Error('A0_PRIVATE_OUTPUT_REQUIRED');
  const romPath=arg('--rom','out/gngb-flat.bin');
  const tracePath=arg('--trace','out/r2/mame-probe/pre-instruction.jsonl');
  const proof=await runNativeBootWriteGate({
    romPath,tracePath,
    observationsPath:arg('--observations','out/r2/mame-probe/observations.tsv'),
    capabilitiesPath:arg('--capabilities','out/r2/mame-probe/capabilities.json'),
    outDir:resolve(out,'verified-boot')
  });
  const rom=new Uint8Array(await readFile(romPath));
  const rows=(await readFile(tracePath,'utf8')).trimEnd()
    .split('\n').map(JSON.parse);
  const sync=inspectNativeSyncPrestates(rom,rows,proof);
  const report=profileDynamicCoverage(rom,rows,sync);
  await mkdir(out,{recursive:true});
  await writeFile(resolve(out,'report.json'),
    JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(error=>{
    console.error('A0_DYNAMIC_COVERAGE=BLOCKED '+error.message);
    process.exitCode=2;
  });
