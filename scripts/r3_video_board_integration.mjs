#!/usr/bin/env node
/**
 * A0.5.B. Offline, native-evidence-gated replay of compiled CPU video-store
 * instructions into the real gngb RAM adapter and FG/BG decoder.
 *
 * Does not run MAME or use captured bytes as inputs to the JavaScript CPU.
 * Raw ROM, per-instruction prestates and tap samples stay under out/r3.
 */
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,relative,isAbsolute} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {compileAt,emitStaticModule}
  from './r3_static_trace_probe.mjs';
import {runNativeBootWriteGate}
  from './r3_compare_sprite_writes.mjs';
import {inspectNativeSyncPrestates}
  from './r3_sync_boundary.mjs';
import {SITES} from './r3_indexed_store_gate.mjs';
import {verifyNativeVideoWriteGate,parseNativeVideoWrites}
  from './r3_native_video_write_gate.mjs';
import {replayNativeVerifiedVideoToBoard}
  from '../src/gngb_video_bridge.mjs';

async function main(){
  const args=process.argv.slice(2);
  const arg=(flag,fallback)=>{
    const i=args.indexOf(flag);return i<0?fallback:args[i+1];
  };
  const target=resolve(arg('--out','out/r3/video-board-integration'));
  const rel=relative(resolve('out/r3'),target);
  if(!rel||rel==='..'||rel.startsWith('../')||isAbsolute(rel))
    throw Error('A05_PRIVATE_OUTPUT_REQUIRED');
  const romPath=arg('--rom','out/gngb-flat.bin');
  const tracePath=arg('--trace','out/r2/mame-probe/pre-instruction.jsonl');
  const observationsPath=arg('--observations',
    'out/r2/mame-probe/observations.tsv');
  const boot=await runNativeBootWriteGate({
    romPath,tracePath,observationsPath,
    capabilitiesPath:arg('--capabilities',
      'out/r2/mame-probe/capabilities.json'),
    outDir:resolve(target,'same-run-verified-boot')
  });
  if(boot.status!=='PASS_BOOT_SPRITE_RAM_WRITE_BYTES'||
      boot.actual_mame_sprite_byte_writes_compared!==true)
    throw Error('A05_SAME_RUN_BOOT_PROOF_MISSING');
  const rom=new Uint8Array(await readFile(romPath));
  const rows=(await readFile(tracePath,'utf8')).trimEnd()
    .split('\n').map(JSON.parse);
  const tsv=await readFile(observationsPath,'utf8');
  const sync=inspectNativeSyncPrestates(rom,rows,boot);
  const specs=SITES.map(site=>compileAt(rom,site.pc));
  if(specs.some(s=>!s?.writesRamByte))
    throw Error('A05_REQUIRED_STORES_UNCOMPILED');
  await mkdir(target,{recursive:true});
  const modulePath=resolve(target,'generated-static-video-stores.mjs');
  await writeFile(modulePath,emitStaticModule(specs));
  const {compiledStep}=await import(pathToFileURL(modulePath).href);
  const nativeGate=verifyNativeVideoWriteGate({
    rom,rows,sync,compiledStep,tsv
  });
  if(nativeGate.status!=='NATIVE_VIDEO_WRITES_MATCH_GENERATED_STATIC_JS')
    throw Error('A05_A04_NATIVE_VIDEO_WRITE_GATE_BLOCKED');
  const native=parseNativeVideoWrites(tsv);
  const report=replayNativeVerifiedVideoToBoard({
    rows,sync,compiledStep,nativeGate,
    nativeVideoWrites:native.epochs[1]
  });
  await writeFile(resolve(target,'report.json'),
    JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(e=>{
    console.error('A05_NATIVE_VIDEO_BOARD=BLOCKED '+e.message);
    process.exitCode=2;
  });
