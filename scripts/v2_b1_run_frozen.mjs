#!/usr/bin/env node
/** Offline V2 frame runner; reads ONLY frozen private package, never ZIP/MAME. */
import {readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runFrozen} from '../src/v2_b1_frozen.mjs';
const ROOT=resolve(fileURLToPath(import.meta.url),'../..');
const OUT=join(ROOT,'out/v2/b1');
async function main(){
  const args=process.argv.slice(2);
  if(args.length!==2||args[0]!=='--run'||!['one','two'].includes(args[1]))
    throw Error('V2_B1_USAGE_RUN_SLOT');
  const slot=args[1],dir=join(OUT,'frozen'),dest=join(OUT,slot+'.json');
  if(existsSync(dest))throw Error('V2_B1_SLOT_ALREADY_EXISTS');
  const report=await runFrozen(dir);
  mkdirSync(OUT,{recursive:true,mode:0o700});
  writeFileSync(dest,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log('V2_B1_T2_RUN=FRAMES_DONE_FROZEN_NO_ORACLE');
  console.log('V2_B1_T2_RUN_SLOT='+slot.toUpperCase());
  console.log('V2_B1_T2_FRAMES='+report.frames);
  console.log('V2_B1_T3_FIRST_FULLY_KNOWN='+String(report.first_fully_known??'NONE'));
}
async function check(){
  const a=JSON.parse(readFileSync(join(OUT,'one.json'),'utf8'));
  const b=JSON.parse(readFileSync(join(OUT,'two.json'),'utf8'));
  if(a.status!=='FRAMES_DONE'||b.status!=='FRAMES_DONE'||
     a.frames!==b.frames||a.sequence_sha256!==b.sequence_sha256||
     JSON.stringify(a.frame_hashes)!==JSON.stringify(b.frame_hashes)||
     JSON.stringify(a.unknowns)!==JSON.stringify(b.unknowns))
    throw Error('V2_B1_NONDETERMINISTIC');
  console.log('V2_B1_T4_DETERMINISM=PASS_TWO_INDEPENDENT_RUNS');
  console.log('V2_B1_T4_FRAMES='+a.frames);
}
try{
  if(process.argv.slice(2).join(' ')==='--verify')await check();
  else await main();
}catch(e){console.error('V2_B1_FROZEN=BLOCKED_'+
  (String(e.message).startsWith('V2_B1_')?String(e.message).slice(6):'RUNTIME_OR_INPUT'));process.exitCode=2;}
