#!/usr/bin/env node
/**
 * R3.6.B1. Recompile the exact native LDA extended at fixed ROM 0x6017.
 * The generated JS executes one CPU read; no runtime MC6809 opcode decoder.
 * Only independently known memory sources can be supplied to readByte:
 *   fixed ROM 0x6000..ffff; sprite RAM bytes reproduced by the R3.3
 *   768/768 native write proof in two boot epochs.
 * All other RAM, MMIO, and bank reads BLOCK instead of copying a native
 * destination register as the "read value".
 *
 * SYNC wake remains unproven. This gate can establish only a single
 * post-SYNC LDA step when a real next MAME prestate exists.
 */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,relative,isAbsolute} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {runNativeBootWriteGate,deriveBootWrites}
  from './r3_compare_sprite_writes.mjs';
import {compileAt,diffRegisters,checkedState}
  from './r3_static_trace_probe.mjs';
import {emitStaticModule} from './r3_static_trace_probe.mjs';
import {inspectNativeSyncPrestates} from './r3_sync_boundary.mjs';

const PC=0x6017;
const END=0x601a;
const REGIONS=[
  [0x0000,0x1dff,'UNINITIALIZED_WORK_RAM'],
  [0x1e00,0x1fff,'SPRITE_RAM'],
  [0x2000,0x2fff,'VIDEO_RAM'],
  [0x3000,0x37ff,'INPUT_OR_MMIO'],
  [0x3800,0x3fff,'PALETTE_OR_MMIO'],
  [0x4000,0x5fff,'BANKED_ROM'],
  [0x6000,0xffff,'FIXED_ROM'],
];
export function classifyAddress(address){
  if(!Number.isInteger(address)||address<0||address>65535)
    throw Error('R36_LDA_BAD_ADDRESS');
  return REGIONS.find(([from,to])=>address>=from&&address<=to)?.[2];
}
export function compileLdaAt(rom,pc=PC){
  if(!(rom instanceof Uint8Array)||rom.length!==65536||
      rom[0xfffe]!==0x60||rom[0xffff]!==0||
      pc!==PC||rom[pc]!==0xb6)return null;
  const address=(rom[pc+1]<<8)|rom[pc+2];
  return Object.freeze({pc,name:'LDA_EXT',len:3,next:END,address,
    region:classifyAddress(address),
    opcode_has_fixed_rom_provenance:true,
    value_is_not_embedded_in_generated_code:true,
    bus_read_independently_verified:false});
}
/** Static address literal, mandatory readByte, N/Z from byte and V clear. */
export function emitLdaModule(spec){
  if(spec?.pc!==PC||spec?.name!=='LDA_EXT'||spec?.len!==3||
      spec?.next!==END||!Number.isInteger(spec.address)||
      spec.address<0||spec.address>65535||
      spec.region!==classifyAddress(spec.address))
    throw Error('R36_LDA_UNVERIFIED_SPEC');
  return [
    '// PRIVATE ROM-derived single-instruction static JavaScript.',
    '// READ VALUE MUST COME FROM CERTIFIED MEMORY; NEVER FROM MAME A.',
    'export function executeLdaExt(regs,readByte){',
    "  if(!regs||regs.PC!==0x6017)throw Error('R36_LDA_WRONG_PC');",
    "  if(typeof readByte!=='function')throw Error('R36_LDA_READ_SOURCE_REQUIRED');",
    '  const r={...regs};',
    '  const value=readByte(0x'+spec.address.toString(16)+');',
    "  if(!Number.isInteger(value)||value<0||value>255)",
    "    throw Error('R36_LDA_READ_VALUE_INVALID');",
    '  r.A=value;',
    '  r.CC=(r.CC&~14)|(value&128?8:0)|(value===0?4:0);',
    '  r.PC=0x601a;',
    '  return r;',
    '}',
    ''
  ].join('\n');
}
export function finalSpriteMemory(boot){
  if(!Array.isArray(boot)||boot.length!==384)
    throw Error('R36_LDA_NEEDS_192_NATIVE_VERIFIED_WORD_WRITES');
  const known=new Map();
  for(const event of boot){
    if(!Number.isInteger(event.addr)||event.addr<0x1e00||
        event.addr>0x1fff||!Number.isInteger(event.data)||
        event.data<0||event.data>255)
      throw Error('R36_LDA_INVALID_SPRITE_WRITE_EVENT');
    known.set(event.addr,event.data);
  }
  return known;
}
export function makeTrustedRead(spec,rom,spriteBytes){
  if(!spec||!classifyAddress(spec.address))
    throw Error('R36_LDA_NO_VALIDATED_MEMORY_REGION');
  const addr=spec.address;
  if(spec.region==='FIXED_ROM')
    return () => rom[addr];
  if(spec.region==='SPRITE_RAM'&&spriteBytes.has(addr))
    return () => spriteBytes.get(addr);
  return null;
}
export function evaluateLdaAgainstMame({
  rom,rows,sync,proof,compiledBootStep,generatedLdaStep
}){
  const spec=compileLdaAt(rom);
  if(!spec)throw Error('R36_LDA_OPCODE_B6_NOT_AT_6017');
  if(sync?.status!=='SYNC_BYTE_AND_WAIT_BARRIER_PREPARED'||
      sync.epochs?.length!==2||
      sync.epochs[1]?.next_debugger_pc!=='0x6017')
    throw Error('R36_LDA_NO_REAL_POST_SYNC_PRESTATE');
  if(proof?.status!=='PASS_BOOT_SPRITE_RAM_WRITE_BYTES'||
      proof.actual_mame_sprite_byte_writes_compared!==true)
    throw Error('R36_LDA_NO_VERIFIED_NATIVE_SPRITE_RAM');
  const seq=sync.epochs[1].sync_prestate_seq+1;
  const before=rows[seq],after=rows[seq+1];
  if(before?.pc!==PC||before?.seq!==seq||
      before?.before?.PC!==PC)
    throw Error('R36_LDA_NATIVE_ENTRY_INCOMPATIBLE');
  checkedState(before.before);
  // This read is independent of the next MAME A register.
  const bootWrites=deriveBootWrites(rows,compiledBootStep);
  const memory=finalSpriteMemory(bootWrites[1].events);
  const trusted=makeTrustedRead(spec,rom,memory);
  const report={
    schema:'gng.r3.post-sync-lda-ext-v1',
    status:'READ_SOURCE_NOT_YET_GROUNDED',
    instruction_pc:'0x6017',
    instruction:'LDA_EXT',
    operand_region:spec.region,
    operand_address_private:true,
    source_is_fixed_rom_or_verified_boot_sprite_ram:!!trusted,
    native_entry_prestate_seq:seq,
    native_next_prestate_present:!!after,
    native_next_pc:after?'0x'+after.pc.toString(16):null,
    independently_observed_bus_read:false,
    generated_js_step_compared:false,
    sync_wake_line_authenticated:false,
    cpu_irq_entry_verified:false,
    full_bus_or_game_equivalence_verified:false,
    game_playable:false,
    next_task:'Capture the exact native read address/value if source is dynamic; do not inject MAME A into JS'
  };
  if(!trusted){
    report.status='BLOCKED_UNVERIFIED_MEMORY_READ';
    return report;
  }
  if(!after){
    report.status='BLOCKED_NO_NATIVE_AFTER_CHECKPOINT';
    return report;
  }
  checkedState(after.before);
  const result=generatedLdaStep(before.before,(address)=>{
    if(address!==spec.address)
      throw Error('R36_LDA_STATIC_ADDRESS_MISMATCH');
    return trusted();
  });
  const divergent=diffRegisters(result,after.before);
  report.generated_js_step_compared=true;
  report.first_divergence=divergent.length?{
    instruction_pc:'0x6017',fields:divergent
  }:null;
  report.status=divergent.length?'FIRST_DIVERGENCE':
    'MATCHED_LDA_REGISTER_CHECKPOINT_WITH_KNOWN_READ_SOURCE';
  return report;
}
async function main(){
  const args=process.argv.slice(2);
  const arg=(name,otherwise)=>{
    const index=args.indexOf(name);return index<0?otherwise:args[index+1];
  };
  const target=resolve(arg('--out','out/r3/lda-extended'));
  const rel=relative(resolve('out/r3'),target);
  if(!rel||rel==='..'||rel.startsWith('../')||isAbsolute(rel))
    throw Error('R36_LDA_PRIVATE_OUTPUT_REQUIRED');
  const romPath=arg('--rom','out/gngb-flat.bin');
  const tracePath=arg('--trace','out/r2/mame-probe/pre-instruction.jsonl');
  const proof=await runNativeBootWriteGate({
    romPath,tracePath,
    observationsPath:arg('--observations','out/r2/mame-probe/observations.tsv'),
    capabilitiesPath:arg('--capabilities','out/r2/mame-probe/capabilities.json'),
    outDir:resolve(target,'same-run-native-proof')
  });
  const rom=new Uint8Array(await readFile(romPath));
  const rows=(await readFile(tracePath,'utf8')).trim().split('\n')
    .map(line=>JSON.parse(line));
  const sync=inspectNativeSyncPrestates(rom,rows,proof);
  const spec=compileLdaAt(rom);
  if(!spec)throw Error('R36_LDA_OPCODE_B6_NOT_AT_6017');
  await mkdir(target,{recursive:true});
  const modulePath=resolve(target,'generated-lda.mjs');
  await writeFile(modulePath,emitLdaModule(spec));
  const {executeLdaExt}=await import(pathToFileURL(modulePath).href);
  // Reuse separately compiled verified boot JS to derive a read-only
  // memory image, not a fabricated prestate/operand from the MAME output.
  const bootSpec=new Map();
  for(const row of rows){
    if(row.pc<0x6014){
      const compiled=compileAt(rom,row.pc);
      if(compiled)bootSpec.set(row.pc,compiled);
    }
  }
  const bootModulePath=resolve(target,'verified-boot-step.mjs');
  await writeFile(bootModulePath,
    emitStaticModule([...bootSpec.values()]));
  const {compiledStep}=await import(pathToFileURL(bootModulePath).href);
  const result=evaluateLdaAgainstMame({
    rom,rows,sync,proof,compiledBootStep:compiledStep,
    generatedLdaStep:executeLdaExt
  });
  await writeFile(resolve(target,'report.json'),
    JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result,null,2));
  if(!result.status.startsWith('MATCHED_'))process.exitCode=2;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(err=>{
    console.error('GNG_R36_LDA_EXT=BLOCKED '+err.message);
    process.exitCode=2;
  });
