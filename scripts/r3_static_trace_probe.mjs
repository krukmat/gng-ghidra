#!/usr/bin/env node
// Experimental direct MC6809->JS ROM-backed compiler plus MAME prestate diff.
// It does NOT implement or claim RAM, MMIO, IRQ, bank or full-game equivalence.
// Generated code contains compiled statements by PC, never an opcode interpreter.
import {createHash} from 'node:crypto';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {resolve, relative, isAbsolute} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const KEYS=['PC','A','B','X','Y','U','S','DP','CC'];
const BYTES=new Set(['A','B','DP','CC']);
const hex=n=>'0x'+n.toString(16);
const signed8=n=>n>=128?n-256:n;
const signed16=n=>n>=32768?n-65536:n;
export function checkedState(r){
  if(!r || typeof r!=='object' ||
      Object.keys(r).sort().join(',')!==KEYS.slice().sort().join(',') ||
      KEYS.some(k=>!Number.isInteger(r[k]) || r[k]<0 ||
        r[k]>(BYTES.has(k)?255:65535)))
    throw Error('INVALID_MC6809_REGISTER_STATE');
}
const changeNZV=(cc,v,bits)=>(cc&~14)|((v&(bits===8?128:32768))?8:0)|(v===0?4:0);

export function compileAt(rom,pc){
  if(!(rom instanceof Uint8Array) || rom.length!==65536 ||
      !Number.isInteger(pc) || pc<0x6000 || pc>0xffef)return null;
  const op=rom[pc], b1=rom[pc+1], b2=rom[pc+2];
  const imm16=(b1<<8)|b2;
  let len=0,stmt='',name='';
  const load=(reg,val,bits)=>'r.'+reg+'='+hex(val)+';r.CC=changeNZV(r.CC,r.'+reg+','+bits+');';
  if(op===0x12){len=1;name='NOP';}
  else if(op===0x1a){len=2;name='ORCC_IMM';stmt='r.CC=(r.CC|'+hex(b1)+')&255;';}
  else if(op===0x1c){len=2;name='ANDCC_IMM';stmt='r.CC=(r.CC&'+hex(b1)+')&255;';}
  else if(op===0x86||op===0xc6){
    len=2;name=op===0x86?'LDA_IMM':'LDB_IMM';
    stmt=load(op===0x86?'A':'B',b1,8);
  }else if(op===0x8e||op===0xce){
    len=3;name=op===0x8e?'LDX_IMM':'LDU_IMM';
    stmt=load(op===0x8e?'X':'U',imm16,16);
  }else if(op===0xcc){
    len=3;name='LDD_IMM';
    stmt='r.A='+hex(b1)+';r.B='+hex(b2)+';r.CC=changeNZV(r.CC,'+hex(imm16)+',16);';
  }else if(op===0x10&&(b1===0x8e||b1===0xce)){
    len=4;name=b1===0x8e?'LDY_IMM':'LDS_IMM';
    stmt=load(b1===0x8e?'Y':'S',(b2<<8)|rom[pc+3],16);
  }else if(op===0x20){
    len=2;name='BRA';stmt='next='+hex((pc+2+signed8(b1))&65535)+';';
  }else if(op===0x16){
    len=3;name='LBRA';stmt='next='+hex((pc+3+signed16(imm16))&65535)+';';
  }else if(op===0x26||op===0x27){
    len=2;name=op===0x26?'BNE':'BEQ';
    stmt='if((r.CC&4)'+(op===0x26?'===':'!==')+'0)next='+
      hex((pc+2+signed8(b1))&65535)+';';
  }else if(op===0x7e){
    len=3;name='JMP_EXT';stmt='next='+hex(imm16)+';';
  }else return null;
  if(pc+len>65536)return null;
  return {pc,len,name,statement:stmt,next:(pc+len)&65535};
}

export function emitStaticModule(specs){
  let js='// PRIVATE ROM-DERIVED STATIC JS. No runtime opcode decoder.\n';
  js+='const changeNZV=(cc,v,bits)=>(cc&~14)|((v&(bits===8?128:32768))?8:0)|(v===0?4:0);\n';
  js+='export function compiledStep(regs){\nconst r={...regs};let next=0;\nswitch(r.PC){\n';
  for(const spec of specs){
    js+='case '+hex(spec.pc)+':{next='+hex(spec.next)+';'+
      spec.statement+'r.PC=next;return r;}\n';
  }
  js+='default:throw Error("UNCOMPILED_PC");\n}\n}\n';
  return js;
}

function checkedRow(row,seq){
  if(row?.schema!=='gng.r2.pre-instruction.v1' ||
      row.kind!=='pre_instruction' ||
      row.origin!=='mame-native-tracelog' ||
      row.seq!==seq || !Number.isInteger(row.pc) ||
      row.pc!==row.before?.PC)
    throw Error('R3_PRETRACE_OR_SEQUENCE_INVALID at '+seq);
  checkedState(row.before);
}
export function diffRegisters(actual,expected){
  checkedState(actual);checkedState(expected);
  return KEYS.filter(key=>actual[key]!==expected[key]);
}

export async function runGate({romPath,tracePath,outDir}){
  const allowed=resolve('out/r3');
  const target=resolve(outDir);
  const rel=relative(allowed,target);
  if(!rel || rel==='..'||rel.startsWith('../')||isAbsolute(rel))
    throw Error('R3_PRIVATE_OUTPUT_OUTSIDE_OUT_R3');
  const romBytes=await readFile(romPath);
  if(romBytes.length!==65536)throw Error('R3_NEEDS_64K_FLAT_ROM');
  const rom=new Uint8Array(romBytes);
  if(rom[0xfffe]!==0x60||rom[0xffff]!==0)
    throw Error('R3_UNEXPECTED_GNGB_RESET_VECTOR');
  const raw=(await readFile(tracePath,'utf8')).trim();
  if(!raw)throw Error('R3_EMPTY_PRIVATE_MAME_TRACE');
  const rows=raw.split('\n').map(line=>JSON.parse(line));
  if(rows.length<2)throw Error('R3_NEEDS_AT_LEAST_TWO_NATIVE_PRESTATES');
  rows.forEach(checkedRow);
  const compiled=new Map();
  for(const row of rows){
    const s=compileAt(rom,row.pc);
    if(s)compiled.set(s.pc,s);
  }
  await mkdir(target,{recursive:true});
  const generated=resolve(target,'static-rom-slice.mjs');
  await writeFile(generated,emitStaticModule([...compiled.values()]));
  const {compiledStep}=await import(pathToFileURL(generated).href);
  let pairs=0,matched=0,first=null;
  const covered=new Set();
  for(let i=0;i<rows.length-1;i++){
    const one=rows[i],two=rows[i+1];
    const spec=compiled.get(one.pc);
    if(!spec)continue;
    pairs++;covered.add(one.pc);
    const diff=diffRegisters(compiledStep(one.before),two.before);
    if(diff.length&&!first)
      first={seq:one.seq,pc:hex(one.pc),instruction:spec.name,
        divergent_fields:diff,interpretation:
        'CPU disagreement or interrupt/other activity between MAME trace hooks'};
    if(!diff.length)matched++;
  }
  const status=!pairs?'NO_SUPPORTED_NATIVE_PAIR':first?'FIRST_DIVERGENCE':
    'MATCHED_SUPPORTED_PRESTATE_PAIRS';
  const report={
    schema:'gng.r3.static-native-prestate-gate.v1',status,
    source:'fixed-ROM compiled instructions compared to adjacent native MAME prestates',
    compiled_pc_count:compiled.size,compared_pairs:pairs,matching_pairs:matched,
    distinct_compared_pc:covered.size,first_divergence:first,
    rom_sha256:createHash('sha256').update(romBytes).digest('hex'),
    trace_sha256:createHash('sha256').update(raw).digest('hex'),
    reference_provenance_independently_authenticated:false,
    full_game_or_bus_irq_equivalence_verified:false,
    runtime_opcode_interpreter:false,
    no_runtime_memory_or_io:true,
    limitations:['Only statically supported fixed-ROM register/control instructions',
      'MAME adjacent prestates can cross interrupts or external CPU events',
      'No RAM/MMIO/banking/fetch/stack or SYNC/IRQ bus-level effects verified',
      'Generated ROM-derived JS must stay private under out/'],
  };
  await writeFile(resolve(target,'report.json'),JSON.stringify(report,null,2)+'\n');
  return report;
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const arg=name=>{const p=process.argv.indexOf(name);return p<0?null:process.argv[p+1];};
  const romPath=arg('--rom')??'out/gngb-flat.bin';
  const tracePath=arg('--trace')??'out/r2/mame-probe/pre-instruction.jsonl';
  const outDir=arg('--out')??'out/r3/static-mame-prestate';
  runGate({romPath,tracePath,outDir}).then(report=>{
    console.log(JSON.stringify({status:report.status,
      compiled_pc_count:report.compiled_pc_count,
      compared_pairs:report.compared_pairs,
      matching_pairs:report.matching_pairs,
      first_divergence:report.first_divergence},null,2));
    if(report.status!=='MATCHED_SUPPORTED_PRESTATE_PAIRS')process.exitCode=2;
  }).catch(error=>{
    console.error('GNG_R3_STATIC_GATE=BLOCKED '+error.message);
    process.exitCode=2;
  });
}
