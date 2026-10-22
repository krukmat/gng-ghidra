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

/**
 * Compile-time lowering of documented MC6809 A/B single-byte ALU ops.
 * V is unchanged on LSR/ROR/ASR (per MAME base6x09.lst), carry is
 * unchanged on DEC/INC/TST. Illegal unary slots fail closed.
 * The generated statement has no runtime opcode table or ROM decoder.
 */
export function compileUnaryReg(op){
  if(!Number.isInteger(op)||op<0x40||op>0x5f)return null;
  const reg=op<0x50?'A':'B',n=op&15;
  const names={0:'NEG',3:'COM',4:'LSR',6:'ROR',7:'ASR',
    8:'ASL',9:'ROL',10:'DEC',12:'INC',13:'TST',15:'CLR'};
  const operation=names[n];
  if(!operation)return null;
  const r='r.'+reg;
  const nz='((n&128)?8:0)|(n===0?4:0)';
  // Every case binds n and v in a per-PC generated JS lexical scope.
  let body='const v='+r+';let n=v;';
  const set=(mask,flags)=>'r.CC=(r.CC&~'+mask+')|('+flags+');';
  switch(operation){
    case 'NEG':
      body+='n=(-v)&255;'+set(15,nz+'|(v===128?2:0)|(v!==0?1:0)');
      break;
    case 'COM':
      body+='n=(~v)&255;'+set(15,nz+'|1');break;
    case 'LSR':
      body+='n=v>>>1;'+set(13,nz+'|(v&1)');break;
    case 'ROR':
      body+='n=((r.CC&1)<<7)|(v>>>1);'+set(13,nz+'|(v&1)');break;
    case 'ASR':
      body+='n=(v&128)|(v>>>1);'+set(13,nz+'|(v&1)');break;
    case 'ASL':
      body+='n=(v<<1)&255;'+set(15,nz+
        '|((v>>>7)^((n>>>7)&1)?2:0)|(v>>>7)');
      break;
    case 'ROL':
      body+='n=((v<<1)|(r.CC&1))&255;'+set(15,nz+
        '|((v>>>7)^((n>>>7)&1)?2:0)|(v>>>7)');
      break;
    case 'DEC':
      body+='n=(v-1)&255;'+set(14,nz+'|(v===128?2:0)');break;
    case 'INC':
      body+='n=(v+1)&255;'+set(14,nz+'|(v===127?2:0)');break;
    case 'TST':
      body+=set(14,'((v&128)?8:0)|(v===0?4:0)');break;
    case 'CLR':
      body+='n=0;'+set(15,'4');break;
  }
  if(operation!=='TST')body+=r+'=n;';
  return {len:1,name:operation+'_'+reg,statement:body};
}
/** Compile branch conditions once from opcode to JS expressions. */
export function compileShortBranch(op,pc,offset){
  if(!Number.isInteger(op)||op<0x20||op>0x2f||
      !Number.isInteger(pc)||!Number.isInteger(offset))return null;
  const kind=[
    'BRA','BRN','BHI','BLS','BCC','BCS','BNE','BEQ',
    'BVC','BVS','BPL','BMI','BGE','BLT','BGT','BLE'
  ][op&15];
  const c='(r.CC&1)!==0',z='(r.CC&4)!==0',
    v='(r.CC&2)!==0',n='(r.CC&8)!==0';
  const tests=[
    'true','false','(!'+c+'&&!'+z+')','('+c+'||'+z+')',
    '!'+c,c,'!'+z,z,'!'+v,v,'!'+n,n,
    '('+n+'==='+v+')','('+n+'!=='+v+')',
    '(!'+z+'&&'+n+'==='+v+')','('+z+'||'+n+'!=='+v+')'
  ];
  const destination=(pc+2+signed8(offset))&65535;
  return {len:2,name:kind,
    statement:'if('+tests[op&15]+')next='+hex(destination)+';'};
}

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
  }else if((pc===0x600c||pc===0x600e) && op===0xed && b1===0x81){
    // ROM-attested gngb reset-loop STD ,X++ only (src/poc.py).
    // This is an actual 16-bit write, not a register-only shortcut.
    len=2;name='STD_X_POSTINC';
    stmt='if(r.X<0x1e00||r.X>0x1ffe)throw RangeError("SPRITE_RAM_WRITE_OUT_OF_RANGE");'+
      'if(typeof writeRamWord!=="function")throw Error("MISSING_RAM_WORD_SINK");'+
      'writeRamWord(r.X,(r.A<<8)|r.B);r.X=(r.X+2)&65535;'+
      'r.CC=changeNZV(r.CC,(r.A<<8)|r.B,16);';
  }else if(pc===0x6010 && op===0x31 && b1===0x3f){
    // ROM-attested 6809 LEAY -1,Y: modifies Z only.
    len=2;name='LEAY_MINUS_1';
    stmt='r.Y=(r.Y-1)&65535;r.CC=(r.CC&~4)|(r.Y===0?4:0);';
  }else if(op===0x8c){
    len=3;name='CMPX_IMM';
    stmt='const a=r.X, b='+hex(imm16)+', n=(a-b)&65535;'+
      'r.CC=(r.CC&~15)|((n&32768)?8:0)|(n===0?4:0)|'+
      '((((a^b)&(a^n)&32768)!==0)?2:0)|(a<b?1:0);';
  }else if(op>=0x40&&op<=0x5f){
    const unary=compileUnaryReg(op);
    if(!unary)return null;
    len=unary.len;name=unary.name;stmt=unary.statement;
  }else if(op>=0x20&&op<=0x2f){
    const branch=compileShortBranch(op,pc,b1);
    len=branch.len;name=branch.name;stmt=branch.statement;
  }else if(op===0x16){
    len=3;name='LBRA';stmt='next='+hex((pc+3+signed16(imm16))&65535)+';';
  }else if(op===0x7e){
    len=3;name='JMP_EXT';stmt='next='+hex(imm16)+';';
  }else return null;
  if(pc+len>65536)return null;
  return {pc,len,name,statement:stmt,next:(pc+len)&65535,
    writesSpriteWord:name==='STD_X_POSTINC'};
}

export function emitStaticModule(specs){
  let js='// PRIVATE ROM-DERIVED STATIC JS. No runtime opcode decoder.\n';
  js+='const changeNZV=(cc,v,bits)=>(cc&~14)|((v&(bits===8?128:32768))?8:0)|(v===0?4:0);\n';
  js+='export function compiledStep(regs,writeRamWord){\nconst r={...regs};let next=0;\nswitch(r.PC){\n';
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

/**
 * R3 G2 preparation: roll forward each supported instruction WITHOUT
 * injecting MAME state again until the segment stops.
 *
 * A segment starts with ONE MAME pre-state. Its own generated JS output
 * feeds the next compiled JS instruction. Every intermediate output is
 * checked against the corresponding adjacent MAME pre-state. Unsupported
 * instructions, a mismatch, or the end of the trace terminate the segment.
 *
 * This validates registers/control only, never RAM/MMIO/IRQ causality.
 */
export function analyzeContiguousSegments(rows,compiled,compiledStep){
  if(!Array.isArray(rows)||rows.length<2||!(compiled instanceof Map)||
    typeof compiledStep!=='function')throw Error('INVALID_R3_CONTIGUOUS_ARGUMENTS');
  rows.forEach(checkedRow);
  const segments=[];
  let running=null,firstMismatch=null;
  function close(reason){
    if(!running)return;
    if(running.steps>0)segments.push({
      start_seq:running.startSeq,
      start_pc:hex(running.startPC),
      matched_steps:running.steps,
      modeled_ram_word_writes:running.modeledRamWordWrites??0,
      stop_reason:reason
    });
    running=null;
  }
  let supportedPairs=0,matchingPairs=0,uncompiledPairs=0;
  let modeledRamWordWrites=0;
  for(let i=0;i<rows.length-1;i++){
    const row=rows[i],next=rows[i+1];
    const spec=compiled.get(row.pc);
    if(!spec){
      uncompiledPairs++;
      close('UNCOMPILED_INSTRUCTION');
      continue;
    }
    supportedPairs++;
    if(!running){
      running={
        startSeq:row.seq,startPC:row.pc,
        registers:{...row.before},steps:0
      };
    }
    // This cannot be a fresh injection: a live run always carries its
    // previous output, and is compared to the current MAME checkpoint.
    const entryDiff=diffRegisters(running.registers,row.before);
    if(entryDiff.length){
      if(!firstMismatch)firstMismatch={
        seq:row.seq,pc:hex(row.pc),stage:'accumulated_state',
        divergent_fields:entryDiff
      };
      close('ACCUMULATED_STATE_MISMATCH');
      running={
        startSeq:row.seq,startPC:row.pc,
        registers:{...row.before},steps:0
      };
    }
    // RAM is sparse and write-only in this experimental slice. No initial
    // RAM image is invented and no MAME memory equivalence is asserted.
    const stagedWrites=[];
    const output=compiledStep(running.registers,(addr,word)=>{
      if(!Number.isInteger(addr)||addr<0x1e00||addr>0x1ffe||
        !Number.isInteger(word)||word<0||word>65535)
        throw Error('INVALID_COMPILED_SPRITE_RAM_WORD_WRITE');
      stagedWrites.push([addr,word]);
    });
    const diff=diffRegisters(output,next.before);
    if(diff.length){
      if(!firstMismatch)firstMismatch={
        seq:row.seq,pc:hex(row.pc),stage:'after_compiled_instruction',
        divergent_fields:diff
      };
      close('FIRST_DIVERGENCE');
    }else{
      matchingPairs++;
      running.steps++;
      running.registers=output;
      modeledRamWordWrites+=stagedWrites.length;
      running.modeledRamWordWrites=(running.modeledRamWordWrites??0)+stagedWrites.length;
    }
  }
  close('TRACE_END');
  segments.sort((a,b)=>b.matched_steps-a.matched_steps||
    a.start_seq-b.start_seq);
  const longest=segments[0]?.matched_steps??0;
  const contiguous2=segments.filter(s=>s.matched_steps>=2).length;
  const contiguous4=segments.filter(s=>s.matched_steps>=4).length;
  return {
    schema:'gng.r3.contiguous-register-only.v1',
    status:firstMismatch?'FIRST_DIVERGENCE':
      longest>=4?'FOUR_PLUS_STEPS_OBSERVED':
      longest>=2?'MULTISTEP_OBSERVED':'NO_MULTISTEP_FOUND',
    starts_from_one_mame_prestate_per_segment:true,
    reinjects_mame_state_per_instruction:false,
    checkpoints_compared_to_mame_per_instruction:true,
    compiled_supported_pairs:supportedPairs,
    matching_pairs:matchingPairs,
    uncompiled_pairs:uncompiledPairs,
    modeled_ram_word_writes:modeledRamWordWrites,
    ram_writes_compared_with_mame:false,
    segment_count:segments.length,
    segments_at_least_2:contiguous2,
    segments_at_least_4:contiguous4,
    longest_segment_steps:longest,
    top_segments:segments.slice(0,5),
    first_divergence:firstMismatch,
    bus_or_irq_equivalence_verified:false,
    game_executable:false,
    gate_note:'G2 extension: register checkpoints only, sparse RAM writes modeled but not verified against MAME bus; no IRQ'
  };
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
    const diff=diffRegisters(compiledStep(one.before,(addr,word)=>{
      if(!Number.isInteger(addr)||addr<0x1e00||addr>0x1ffe||
          !Number.isInteger(word)||word<0||word>65535)
        throw Error('INVALID_COMPILED_SPRITE_RAM_WORD_WRITE');
    }),two.before);
    if(diff.length&&!first)
      first={seq:one.seq,pc:hex(one.pc),instruction:spec.name,
        divergent_fields:diff,interpretation:
        'CPU disagreement or interrupt/other activity between MAME trace hooks'};
    if(!diff.length)matched++;
  }
  const contiguous=analyzeContiguousSegments(rows,compiled,compiledStep);
  if(contiguous.compiled_supported_pairs!==pairs ||
      contiguous.matching_pairs!==matched)
    throw Error('R3_CONTIGUOUS_CHECKPOINT_ACCOUNTING_MISMATCH');
  const status=!pairs?'NO_SUPPORTED_NATIVE_PAIR':first?'FIRST_DIVERGENCE':
    'MATCHED_SUPPORTED_PRESTATE_PAIRS';
  const report={
    schema:'gng.r3.static-native-prestate-gate.v1',status,
    source:'fixed-ROM compiled instructions compared to adjacent native MAME prestates',
    compiled_pc_count:compiled.size,compared_pairs:pairs,matching_pairs:matched,
    distinct_compared_pc:covered.size,first_divergence:first,
    contiguous,
    rom_sha256:createHash('sha256').update(romBytes).digest('hex'),
    trace_sha256:createHash('sha256').update(raw).digest('hex'),
    reference_provenance_independently_authenticated:false,
    full_game_or_bus_irq_equivalence_verified:false,
    runtime_opcode_interpreter:false,
    no_runtime_memory_or_io:!([...compiled.values()].some(v=>v.writesSpriteWord)),
    generated_sprite_ram_writes_unverified_by_reference:true,
    limitations:['Only statically supported fixed-ROM register/control plus ROM-attested sprite RAM writes',
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
      first_divergence:report.first_divergence,
      contiguous:report.contiguous},null,2));
    if(report.status!=='MATCHED_SUPPORTED_PRESTATE_PAIRS')process.exitCode=2;
  }).catch(error=>{
    console.error('GNG_R3_STATIC_GATE=BLOCKED '+error.message);
    process.exitCode=2;
  });
}
