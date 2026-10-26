#!/usr/bin/env node
/** Build-only: freeze private ROM-derived AOT and board bytes under ignored out/. */
import {execFileSync} from 'node:child_process';
import {readFileSync,mkdirSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {gngbCodeImage} from '../src/gngb_runtime.mjs';
import {romBytes} from './r35_t5_run.mjs';
import {freezeBundle,sha256,MODULES} from '../src/v2_b1_frozen.mjs';

const ROOT=resolve(fileURLToPath(import.meta.url),'../..');
const out=join(ROOT,'out/v2/b1');
function main(){
  if(process.argv.slice(2).join(' ')!=='--freeze')throw Error('V2_B1_USAGE_FREEZE_ONLY');
  const bundle=join(out,'frozen');
  if(existsSync(bundle))throw Error('V2_B1_DESTINATION_EXISTS');
  const t5=join(ROOT,'out/r35/t5');
  const reportData=readFileSync(join(t5,'report.json'));
  const report=JSON.parse(reportData);
  if(report.result?.status!=='FRAMES_DONE'||report.frames_run!==600||
     report.first_bad_frame!==null||report.blocks<1)
    throw Error('V2_B1_T5_REPORT_NOT_READY');
  const read=n=>execFileSync('unzip',['-p',join(ROOT,'roms/gng.zip'),n],
    {maxBuffer:1<<20,stdio:['ignore','pipe','ignore']});
  const code=gngbCodeImage(read);
  const descriptions=JSON.parse(readFileSync(join(t5,'ram-overlays.json'),'utf8'));
  if(!Array.isArray(descriptions))throw Error('V2_B1_OVERLAY_META_INVALID');
  const overlays=descriptions.map(o=>({start:o.start,
    bytes:romBytes(code,o.origin,o.length)}));
  const modules=Object.fromEntries(MODULES.map(n=>[n,
    readFileSync(join(ROOT,'src',n),'utf8')]));
  const generated=readFileSync(join(t5,'aot-generated.mjs'),'utf8');
  mkdirSync(out,{recursive:true,mode:0o700});
  const manifest=freezeBundle(bundle,{generated,code,overlays,modules,
    provenance:{frames:600,blocks:report.blocks,
      source_report_sha256:sha256(reportData)}});
  console.log('V2_B1_T2_FREEZE=PASS_PRIVATE_BUNDLE_NO_ORACLE');
  console.log('V2_B1_T2_BLOCKS='+manifest.blocks);
  console.log('V2_B1_T2_FRAMES='+manifest.frames);
}
try{main();}catch(e){console.error('V2_B1_T2_FREEZE=BLOCKED_'+
  (String(e.message).startsWith('V2_B1_')?String(e.message).slice(6):'PRIVATE_INPUT_OR_IO'));process.exitCode=2;}
