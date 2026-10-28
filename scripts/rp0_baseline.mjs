#!/usr/bin/env node
/** Short, explicit frozen-bundle baseline. Writes no ROM bytes or CPU traces. */
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
import {loadFrozen} from '../src/v2_b1_frozen.mjs';

const [bundleArg,framesArg,reportArg]=process.argv.slice(2);
if(!bundleArg||!framesArg||!reportArg)throw Error('RP0_USAGE: bundle frames report');
const bundle=resolve(bundleArg),frames=Number(framesArg),report=resolve(reportArg);
if(!Number.isInteger(frames)||frames<1||frames>6000)throw Error('RP0_FRAMES_INVALID');
if(!report.startsWith(resolve('out')+'/'))throw Error('RP0_REPORT_MUST_BE_PRIVATE_OUT');
const {manifest,code}=loadFrozen(bundle);
if(frames>manifest.frames)throw Error('RP0_FRAMES_EXCEED_BUNDLE');
const {blocks}=await import(pathToFileURL(join(bundle,'program.mjs')).href);
const {createBoard}=await import(pathToFileURL(join(bundle,'gngb_runtime.mjs')).href);
const selected=new Set([1,Math.min(60,frames),frames]);
const samples=[];
const board=createBoard(code,blocks,{frames,onFrame:f=>{
  if(selected.has(f.index))samples.push({frame:f.index,recordSha256:createHash('sha256')
    .update(f.record).update(f.known).digest('hex')});
  board.state.records[f.index-1]=null;
}});
const start=performance.now();
const result=board.run();
const elapsedMs=performance.now()-start;
if(result.status!=='FRAMES_DONE'||samples.length!==selected.size)
  throw Error('RP0_BASELINE_INCOMPLETE '+result.status);
const baseline={schema:'rom-migration.rp0.baseline.v1',scope:'semantic-smoke-and-local-timing',
  source:'frozen-bundle',bundle,frames,manifestSha256:createHash('sha256')
    .update(readFileSync(join(bundle,'manifest.json'))).digest('hex'),
  programSha256:manifest.files['program.mjs'],sourceGitHead:manifest.source_git_head,
  node:process.version,platform:process.platform,arch:process.arch,
  result:result.status,cycles:board.state.C,samples,
  timing:{elapsedMs:+elapsedMs.toFixed(3),msPerFrame:+(elapsedMs/frames).toFixed(3),
    note:'CPU run only, after import and board creation; separate process for each measurement.'}};
mkdirSync(dirname(report),{recursive:true,mode:0o700});
writeFileSync(report,JSON.stringify(baseline,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({result:baseline.result,frames,cycles:baseline.cycles,
  msPerFrame:baseline.timing.msPerFrame,report}));
