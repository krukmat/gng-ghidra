#!/usr/bin/env node
/**
 * Read-only private R0 snapshot audit. Requires user-owned MAME files under
 * ignored out/. Does not authenticate that MAME, rather than a fixture,
 * produced the files; does not claim native per-instruction correlation.
 */
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,relative,isAbsolute,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyR42eSnapshot} from '../src/r42e_snapshot_integrity.mjs';
import {compareR42eCheckpoint} from '../src/r42e_checkpoint_compare.mjs';

const PATHS={
  foreground:'foreground.bin',background:'background.bin',
  sprites:'sprites-buffered.bin',palette:'palette-rgba.bin',
  reference:'reference.png'
};
function ensurePrivate(path){
  const root=resolve('out'),absolute=resolve(path),r=relative(root,absolute);
  if(!r||r==='..'||r.startsWith('../')||isAbsolute(r))
    throw Error('R42E_PRIVATE_OUT_PATH_REQUIRED');
  return absolute;
}
export async function auditR42eLocal({
  referenceDir='out/reference/mame',
  labReportPath=null,checkpointId=null,
  outPath='out/r3/r42e-reference-audit.json'
}={}){
  const dir=ensurePrivate(referenceDir),out=ensurePrivate(outPath);
  if((labReportPath===null)!==(checkpointId===null))
    throw Error('R42E_LAB_REPORT_AND_CHECKPOINT_REQUIRED_TOGETHER');
  const manifest=JSON.parse(await readFile(resolve(dir,'manifest.json'),'utf8'));
  const state=JSON.parse(await readFile(resolve(dir,'state.json'),'utf8'));
  const files={};
  for(const [key,name] of Object.entries(PATHS))
    files[key]=await readFile(resolve(dir,name));
  const reference=verifyR42eSnapshot({manifest,state,files});
  const result={
    schema:'gng.r42e.local-audit.v1',
    status:'STRUCTURAL_AUDIT_ONLY_NATIVE_TIMELINE_UNVERIFIED',
    reference,
    correlation:null,
    no_native_event_timeline:true,
    source_independence_not_attested:true,
    native_pixel_equivalence_verified:false,
    autonomous_cpu_frame_rendered:false
  };
  if(labReportPath!==null){
    const report=JSON.parse(await readFile(ensurePrivate(labReportPath),'utf8'));
    result.correlation=compareR42eCheckpoint({
      reference,labReport:report,checkpointId
    });
  }
  await mkdir(dirname(out),{recursive:true});
  await writeFile(out,JSON.stringify(result,null,2)+'\n');
  return result;
}
async function main(){
  const args=process.argv.slice(2);
  const options={};
  const map={'--reference':'referenceDir','--lab-report':'labReportPath',
    '--checkpoint':'checkpointId','--out':'outPath'};
  for(let i=0;i<args.length;i+=2){
    if(!map[args[i]]||!args[i+1])throw Error('R42E_ARGUMENT_INVALID');
    options[map[args[i]]]=args[i+1];
  }
  const result=await auditR42eLocal(options);
  console.log(JSON.stringify({status:result.status,
    reference_status:result.reference.status,
    correlation_status:result.correlation?.status??null,
    native_timeline_verified:false},null,2));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(e=>{console.error('R42E_AUDIT_BLOCKED '+e.message);process.exitCode=2;});
