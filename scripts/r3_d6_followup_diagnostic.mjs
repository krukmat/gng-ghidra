#!/usr/bin/env node
/** Read-only post-D6 diagnosis. No native execution or evidence writes. */
import {readFile,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {compileNativeBankedPairs,validateFullOracleEvidence,validateFullOraclePaths}
  from './r3_banked_static_gate.mjs';
import {emitStaticModule} from './r3_static_trace_probe.mjs';
import {opcodeFamily} from './r3_dynamic_coverage.mjs';
import {profileNativeBankedEffects} from './r3_banked_effect_profile.mjs';

async function requirePlainEvidenceFile(path){
  const parts=path.split('/');
  for(let i=1;i<=parts.length;i++){
    const info=await lstat(parts.slice(0,i).join('/'));
    if(i===parts.length?!info.isFile():!info.isDirectory())
      throw Error('D6_FOLLOWUP_REGULAR_EVIDENCE_PATH_REQUIRED');
  }
}

export async function diagnoseD6({mameBin}){
  if(typeof mameBin!=='string'||!mameBin.includes('/'))
    throw Error('D6_FOLLOWUP_EXPLICIT_BINARY_REQUIRED');
  const locations={flat:'out/gngb-flat.bin',
    banks:'out/r3/banked-rom/private-banked-rom.bin',
    trace:'out/r2/mame-probe/pre-instruction.jsonl',
    rawtrace:'out/r2/mame-probe/cpu.trace',
    observations:'out/r2/mame-probe/observations.tsv',
    capabilities:'out/r2/mame-probe/capabilities.json',
    preflight:'out/r3/banked-provenance/private-a063-preflight.json',
    postflight:'out/r2/mame-probe/private-a063-postflight.json',
    witness:'out/r3/banked-provenance/private-bank-per-prestate.jsonl',
    bank_report:'out/r3/banked-provenance/report.json',
    full_oracle:'out/r2/mame-probe/private-a063-full-oracle-check.json'};
  const manifestPath='out/r3/banked-provenance/private-source-manifest.json';
  validateFullOraclePaths(locations,manifestPath);
  await requirePlainEvidenceFile(manifestPath);
  const manifest=JSON.parse(await readFile(manifestPath,'utf8'));
  if(manifest.schema!=='gng.a06.private-bank-evidence-manifest.v1'||
      manifest.full_oracle_same_run_postflight_verified!==true||
      Object.keys(manifest.sha256??{}).length!==Object.keys(locations).length)
    throw Error('D6_FOLLOWUP_SAME_RUN_MANIFEST_REQUIRED');
  const buffers={};
  for(const [role,path] of Object.entries(locations)){
    if(!/^[0-9a-f]{64}$/.test(manifest.sha256[role]??''))
      throw Error('D6_FOLLOWUP_HASHED_EVIDENCE_REQUIRED');
    await requirePlainEvidenceFile(path);
    const bytes=await readFile(path);
    if(createHash('sha256').update(bytes).digest('hex')!==manifest.sha256[role])
      throw Error('D6_FOLLOWUP_EVIDENCE_HASH_MISMATCH');
    buffers[role]=bytes;
  }
  // Verify the captured SOURCE_FILES closure and protected binary before
  // generating anything in memory. The verifier never executes MAME.
  const chain=spawnSync('python3',['scripts/a063_capture_integrity.py','--verify',
    '--output',resolve('out/r2/mame-probe'),'--preflight',locations.preflight,
    '--mame-bin',mameBin],{encoding:'utf8',timeout:30000,
    env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
  if(chain.status!==0)throw Error('D6_FOLLOWUP_POSTFLIGHT_INVALID');
  const rows=buffers.trace.toString('utf8').trimEnd().split('\n').map(JSON.parse);
  const witness=buffers.witness.toString('utf8').trimEnd().split('\n').map(JSON.parse);
  const report=JSON.parse(buffers.bank_report);
  validateFullOracleEvidence({report,oracle:JSON.parse(buffers.full_oracle),rows,witness});
  const compiled=compileNativeBankedPairs({fixed:new Uint8Array(buffers.flat),
    packed:new Uint8Array(buffers.banks),rows,witness,nativeBankReport:report});
  const compiledByBank=new Map();
  for(const [bank,specs] of compiled.byBank){
    // The ROM-derived module exists only in this private process memory.
    const uri='data:text/javascript;base64,'+
      Buffer.from(emitStaticModule(specs)).toString('base64');
    const {compiledStep}=await import(uri);
    compiledByBank.set(bank,compiledStep);
  }
  const profile=profileNativeBankedEffects({rows,witness,compiled,compiledByBank});
  const hints={};
  for(const group of compiled.groups){
    if(group.spec)continue;
    // opcodeFamily is a coverage hint for fixed-ROM addresses. Relocate
    // bytes solely for this name lookup; do not compile/execute that alias.
    const alias=new Uint8Array(65536);
    alias.set(buffers.banks.subarray(group.bank*8192,(group.bank+1)*8192),0x6000);
    // A page-prefix at the last bank byte reads its family byte from fixed
    // ROM. Preserve that successor instead of classifying zero-filled data.
    alias[0x8000]=buffers.flat[0x6000];
    const family=opcodeFamily(alias,0x6000+group.pc-0x4000);
    hints[family]=(hints[family]??0)+compiled.counts.get(group.bank+':'+group.pc);
  }
  return {schema:'gng.d6.readonly-followup.v1',
    status:'D6_FOLLOWUP_DIAGNOSTIC_ONLY_NOT_NATIVE_EFFECT_PROOF',
    same_run_manifest_roles_verified:Object.keys(locations).length,
    capture_source_and_binary_chain_verified:true,
    unsupported_opcode_family_hints:hints,
    profile};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2);
  if(args.length!==2||args[0]!=='--mame-bin'){
    console.error('D6_FOLLOWUP=BLOCKED explicit_binary_argument_required');
    process.exitCode=2;
  }else{
    diagnoseD6({mameBin:args[1]}).then(report=>console.log(JSON.stringify(report)))
      .catch(()=>{
        // Errors may contain private paths or instruction data. Export only
        // this fixed failure marker; raw diagnostics stay inside the process.
        console.error('D6_FOLLOWUP=BLOCKED evidence_or_contract_invalid');
        process.exitCode=2;
      });
  }
}
