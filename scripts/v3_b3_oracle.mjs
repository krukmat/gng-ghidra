#!/usr/bin/env node
/** V3.B3 G0.3: compare frozen B3 AOT records with MAME gngb records for
 * the SAME input tape. Bytes our runtime marks unknown are skipped; every
 * other byte of RAM, sprite RAM/buffer, FG/BG VRAM and palette must match.
 * MAME is an external lab oracle only; its output stays in out/ (private).
 * Usage: node scripts/v3_b3_oracle.mjs <profile> <frame,frame,...>
 */
import {execFileSync} from 'node:child_process';
import {readFileSync,mkdirSync,mkdtempSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {loadFrozen} from '../src/v2_b1_frozen.mjs';
import {CYCLES_PER_FRAME} from '../src/gngb_runtime.mjs';
import {B3_HORIZONS,b3Tape} from '../src/v3_b3_tapes.mjs';

const ROOT=resolve(fileURLToPath(import.meta.url),'../..');
const DIR=join(ROOT,'out/v3/b3/frozen');
const [profile,list]=process.argv.slice(2);
const frames=[...new Set((list??'').split(',').map(Number))].sort((a,b)=>a-b);
if(!profile||!frames.length||frames.some(f=>!Number.isInteger(f)||f<2||
   f>B3_HORIZONS[profile]))throw Error('V3_B3_ORACLE_USAGE');
const tape=b3Tape(profile);
const spec=tape.events.map(e=>{
  if(e.cycle%CYCLES_PER_FRAME)throw Error('V3_B3_ORACLE_TAPE_NOT_FRAME_ALIGNED');
  return e.cycle/CYCLES_PER_FRAME+':'+e.control+':'+(e.pressed?1:0);
}).join(',');
const out=join(ROOT,'out/v3/b3/oracle');
mkdirSync(out,{recursive:true,mode:0o700});
const work=mkdtempSync(join(out,profile+'-'));
const log=execFileSync('mame',['gngb','-rompath',join(ROOT,'roms'),
  '-cfg_directory',join(work,'cfg'),'-nvram_directory',join(work,'nvram'),
  '-video','none','-sound','none','-nothrottle','-skip_gameinfo',
  '-autoboot_script',join(ROOT,'scripts/v3_b3_oracle.lua'),
  '-seconds_to_run',String(Math.ceil(frames.at(-1)/50)+30)],
  {env:{...process.env,GNG_B3_ORACLE_DIR:work,GNG_B3_ORACLE_TAPE:spec,
    GNG_B3_ORACLE_FRAMES:frames.join(',')},stdio:['ignore','pipe','pipe'],
  encoding:'utf8'});
if(!log.includes('V3_B3_ORACLE_LUA=RECORDED')){
  console.error(log.split('\n').slice(-8).join('\n'));
  throw Error('V3_B3_ORACLE_MAME_LUA_INCOMPLETE');
}
if(!existsSync(join(work,'frames.bin')))throw Error('V3_B3_ORACLE_MAME_NO_OUTPUT');
const blob=readFileSync(join(work,'frames.bin'));
const idx=readFileSync(join(work,'frames.txt'),'utf8').trim().split('\n').map(Number);
if(JSON.stringify(idx)!==JSON.stringify(frames)||blob.length!==frames.length*0x3800)
  throw Error('V3_B3_ORACLE_MAME_RECORDS_INCOMPLETE');

const {code}=loadFrozen(DIR);
const {blocks}=await import(pathToFileURL(join(DIR,'program.mjs')).href);
const {createBoard}=await import(pathToFileURL(join(DIR,'gngb_runtime.mjs')).href);
const ours=new Map(),want=new Set(frames);
const board=createBoard(code,blocks,{frames:frames.at(-1),
  portRead:(addr,cycle)=>tape.read(addr,cycle),
  onFrame:r=>{
    const i=board.state.records.length;
    board.state.records[i-1]=null;
    if(want.has(i))ours.set(i,{record:r.record,known:r.known});
  }});
const run=board.run();
// Our record layout == T4.3 MAME layout (see scripts/r35-t43-frames.lua).
const REGIONS=[['ram',0,0x1e00],['spriteram',0x1e00,0x2000],
  ['sprite_buffer',0x2000,0x2200],['fg',0x2200,0x2a00],['bg',0x2a00,0x3200],
  ['palette',0x3200,0x3400]];
let worst=0;
for(const [n,f] of frames.entries()){
  const mame=blob.subarray(n*0x3800,(n+1)*0x3800),aot=ours.get(f);
  if(!aot){console.log('V3_B3_ORACLE_FRAME_'+f+'=MISSING_AOT_'+run.status);worst=2;continue;}
  const diffs={};let unknown=0;
  for(const [name,a,b] of REGIONS){
    let d=0,firstAt=null;
    for(let i=a;i<b;i++){
      if(aot.known[i]!==255){unknown++;continue;}
      if(aot.record[i]!==mame[i]){d++;firstAt??=i;}
    }
    if(d)diffs[name]={bytes:d,first:'0x'+firstAt.toString(16)};
  }
  const ok=!Object.keys(diffs).length;
  if(!ok)worst=Math.max(worst,1);
  console.log('V3_B3_ORACLE_FRAME_'+f+'='+(ok?'MATCH':'DIFF '+JSON.stringify(diffs))+
    ' unknown_skipped='+unknown);
}
console.log('V3_B3_ORACLE_'+profile+'='+(worst?'MISMATCH':'PASS_ALL_FRAMES_MATCH'));
console.log('V3_B3_ORACLE_MAME_DIR='+work);
process.exitCode=worst?2:0;
