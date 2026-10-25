#!/usr/bin/env node
/**
 * R4.2.G read-only private F timeline -> incremental board reconstruction.
 * Aggregate output only. No trace, ROM or private bytes are exported.
 * Never promotes F's unauthenticated source to native CPU/raster equivalence.
 */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,relative,isAbsolute,dirname,join} from 'node:path';
import {replayR42gTimeline} from '../src/r42g_incremental_timeline.mjs';

const privatePath=p=>{
  if(typeof p!=='string'||!p)throw Error('R42G_PATH_REQUIRED');
  const home=resolve('out'),absolute=resolve(p);
  const rel=relative(home,absolute);
  if(!rel||rel==='..'||rel.startsWith('../')||isAbsolute(rel))
    throw Error('R42G_PRIVATE_PATH_OUT_REQUIRED');
  return absolute;
};
export async function* readR42gJsonlLines(filename){
  // Stream one newline-terminated record at a time, preserving raw SHA data.
  const stream=createReadStream(filename);
  let rest=Buffer.alloc(0);
  for await (const chunk of stream){
    rest=Buffer.concat([rest,chunk]);
    while(true){
      const end=rest.indexOf(10);
      if(end<0)break;
      if(end+1>512)throw Error('R42G_JSONL_LINE_TOO_LONG');
      yield rest.subarray(0,end+1);
      rest=rest.subarray(end+1);
    }
    if(rest.length>512)throw Error('R42G_JSONL_LINE_TOO_LONG');
  }
  if(rest.length)throw Error('R42G_TRUNCATED_FINAL_LINE');
}
function decodeBootstrap(raw){
  if(raw?.schema!=='gng.r42g.bootstrap.v1'||
     !['LAB_SYNTHETIC','PRE_TAP_UNATTESTED'].includes(raw.origin)||
     typeof raw.sha256!=='string')
    throw Error('R42G_BOOTSTRAP_FILE_INVALID');
  const keys=['sprite_ram','video_ram','palette_ext','palette_base','scroll_bytes'];
  const seed={schema:raw.schema,origin:raw.origin,sha256:raw.sha256};
  for(const key of keys){
    const encoded=raw[key];
    if(typeof encoded!=='string'||!encoded.length||
       !/^(?:[a-zA-Z0-9+/]{4})*(?:[a-zA-Z0-9+/]{2}==|[a-zA-Z0-9+/]{3}=)?$/.test(encoded))
      throw Error('R42G_BOOTSTRAP_BASE64_INVALID_'+key);
    seed[key]=Buffer.from(encoded,'base64');
  }
  return seed;
}
export async function runR42gLocal({
  referenceDir='out/reference/mame',
  bootstrapPath=null,
  r0AuditPath=null,
  outputPath='out/r3/r42g-incremental-replay.json'
}={}){
  const dir=privatePath(referenceDir),target=privatePath(outputPath);
  const manifest=JSON.parse(await readFile(join(dir,'manifest.json'),'utf8'));
  if(manifest?.schema!=='gng.mame-video-capture.v1'||
     !manifest.r42f_native_timeline)
    throw Error('R42G_F_VALIDATED_MANIFEST_REQUIRED');
  const timeline=manifest.r42f_native_timeline;
  let bootstrap,reference,referenceBytes;
  if(bootstrapPath!==null)
    bootstrap=decodeBootstrap(JSON.parse(await readFile(privatePath(bootstrapPath),'utf8')));
  if(r0AuditPath!==null){
    const report=JSON.parse(await readFile(privatePath(r0AuditPath),'utf8'));
    if(report?.schema!=='gng.r42e.local-audit.v1'||
       report.status!=='STRUCTURAL_AUDIT_ONLY_NATIVE_TIMELINE_UNVERIFIED')
      throw Error('R42G_R0_AUDIT_REQUIRED');
    reference=report.reference;
    // Original private R0 bytes are SHA-bound against the independent
    // integrity audit before their first mismatch offset may be reported.
    const fg=await readFile(join(dir,'foreground.bin'));
    const bg=await readFile(join(dir,'background.bin'));
    referenceBytes={
      video_ram:Buffer.concat([fg,bg]),
      buffered_sprites:await readFile(join(dir,'sprites-buffered.bin')),
      palette:await readFile(join(dir,'palette-rgba.bin'))
    };
  }
  const result=await replayR42gTimeline({
    rawLines:readR42gJsonlLines(join(dir,'r42f-native-events.jsonl')),
    timeline,bootstrap,reference,referenceBytes
  });
  await mkdir(dirname(target),{recursive:true});
  await writeFile(target,JSON.stringify(result,null,2)+'\n','utf8');
  return result;
}
async function main(){
  const args=process.argv.slice(2),keyMap={
    '--reference-dir':'referenceDir','--bootstrap':'bootstrapPath',
    '--r0-audit':'r0AuditPath','--out':'outputPath'
  },opts={};
  for(let i=0;i<args.length;i+=2){
    if(!keyMap[args[i]]||!args[i+1])throw Error('R42G_ARGUMENT_INVALID');
    opts[keyMap[args[i]]]=args[i+1];
  }
  const output=await runR42gLocal(opts);
  console.log(JSON.stringify({
    status:output.status,event_count:output.event_count,
    window_count:output.window_count,coverage:output.coverage,
    r0_status:output.reference_comparison?.status??null,
    native_certified:false
  },null,2));
  if(output.status!=='STATE_REPLAYED_TEMPORAL_PROOF_MISSING')
    process.exitCode=2;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(e=>{console.error('R42G_REPLAY_BLOCKED '+e.message);process.exitCode=2;});
