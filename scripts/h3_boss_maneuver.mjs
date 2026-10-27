#!/usr/bin/env node
/** H3 lab: at most three directed P1 maneuvers from one saved prefix of a
 * boss-search tape (helpers in src/h3_lab_maneuver.mjs). Replays the frozen
 * certified bundle from reset with the tape's own poke up to the prefix
 * frame, saves, then runs from that state a control (the tape's own inputs)
 * and each maneuver up to the horizon. Bundle and runtime stay untouched.
 * H3_MANEUVER_REF=<ram.bin>:<firstRecord> compares the control's records with
 * an h3_boss_trace.mjs RAM dump.
 * Usage: node scripts/h3_boss_maneuver.mjs <tape.json> <prefix> <name=action,...> [x2]
 * Env: H3_STEP segment length (default 23), H3_HORIZON frames (default/max 240).
 * Output: out/h3/boss/f2/maneuver-<prefix>-<name>.json tapes and
 * maneuvers-<prefix>.json (private).
 */
import {createHash} from 'node:crypto';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {loadFrozen} from '../src/v2_b1_frozen.mjs';
import {selectB3Bundle} from '../src/v3_b3_bundle.mjs';
import {CYCLES_PER_FRAME,RECORD_BYTES} from '../src/gngb_runtime.mjs';
import {defineInputSchedule,readScheduledPort} from '../src/gngb_input_contract.mjs';
import {resolveB3LabTape} from '../src/v3_b3_external_tape.mjs';
import {parseLabPokes,applyLabPokes} from '../src/h3_lab_poke.mjs';
import {labCreateBoard} from '../src/v3_b3_lab_board.mjs';
import {routeEvents,maneuverRow,maneuverOutcome} from '../src/h3_lab_maneuver.mjs';

const ROOT=resolve(fileURLToPath(import.meta.url),'../..');
const [file,prefixArg,...specs]=process.argv.slice(2);
const P=Number(prefixArg),K=Number(process.env.H3_STEP??23),H=Number(process.env.H3_HORIZON??240);
if(!file||!Number.isSafeInteger(P)||P<2||!specs.length||specs.length>3)throw Error('H3_MANEUVER_USAGE');
if(!Number.isInteger(K)||K<1||!Number.isInteger(H)||H<1||H>240)throw Error('H3_MANEUVER_LIMITS');
const maneuvers=specs.map(s=>{
  const [name,route]=s.split('=');
  if(!/^[a-z0-9-]+$/.test(name??'')||!route)throw Error('H3_MANEUVER_SPEC '+s);
  return {name,route:route.split(',')};
});
const raw=JSON.parse(readFileSync(file,'utf8'));
const tape=resolveB3LabTape(file);
const END=P+H,cut=(P+1)*CYCLES_PER_FRAME;
for(const m of maneuvers){
  m.events=routeEvents(P+1,m.route,K);
  if(m.events.some(e=>e.cycle>=(END+1)*CYCLES_PER_FRAME))throw Error('H3_MANEUVER_PAST_HORIZON '+m.name);
}
const prefix=tape.events.filter(e=>e.cycle<cut);
const pokes=parseLabPokes(raw.h3?.poke??'');
const selected=selectB3Bundle(ROOT);
if(!selected)throw Error('V3_B3_NO_CERTIFIED_BUNDLE');
const {manifest,code}=loadFrozen(selected.dir);
const {blocks}=await import(pathToFileURL(join(selected.dir,'program.mjs')).href);
let ref=null;
if(process.env.H3_MANEUVER_REF){
  const [path,first]=process.env.H3_MANEUVER_REF.split(':');
  ref={ram:readFileSync(path),first:Number(first),compared:0,mismatches:[]};
}

let schedule=defineInputSchedule(tape.events),rows=null,hash=null,last=null,checking=false;
const board=await labCreateBoard(join(selected.dir,'gngb_runtime.mjs'),
  manifest.files['gngb_runtime.mjs'],code,blocks,{frames:END,
    portRead:(addr,cycle)=>readScheduledPort(schedule,addr,cycle),
    onFrame:r=>{
      const $=board.state,i=$.records.length;
      $.records[i-1]=null;
      last=maneuverRow(i,r.record);
      if(rows&&i>P){
        rows.push(last);hash.update(r.record);
        const k=i-(ref?.first??0);
        if(checking&&k>=0&&(k+1)*RECORD_BYTES<=ref.ram.length){
          ref.compared++;
          if(!Buffer.from(r.record).equals(ref.ram.subarray(k*RECORD_BYTES,(k+1)*RECORD_BYTES)))
            ref.mismatches.push(i);
        }
      }
      applyLabPokes(pokes,$,i);
    }});
if(board.lab.advanceTo(P).status!=='FRAMES_DONE')throw Error('H3_MANEUVER_PREFIX_FAILED');
const pre=board.lab.save(),start=last;
const runs=[{name:'control',route:raw.h3?.route??null,events:tape.events.filter(e=>e.cycle>=cut)},...maneuvers];
const out=join(ROOT,'out/h3/boss/f2');
mkdirSync(out,{recursive:true,mode:0o700});
for(const v of runs){
  board.lab.restore(pre);rows=[];hash=createHash('sha256');checking=v.name==='control'&&!!ref;
  schedule=defineInputSchedule([...prefix,...v.events]);
  v.status=board.lab.advanceTo(END).status;
  v.recordsSha256=hash.digest('hex');
  v.outcome=maneuverOutcome(rows,{lives:start.lives});
  v.rows=rows;
  if(v.name!=='control'){
    const metadata={schema:raw.schema,profile:raw.profile,frames:END,
      events:defineInputSchedule([...prefix,...v.events]).events};
    v.tapeSha256=createHash('sha256').update(JSON.stringify(metadata)).digest('hex');
    v.tape=join(out,`maneuver-${P}-${v.name}.json`).slice(ROOT.length+1);
    writeFileSync(join(ROOT,v.tape),JSON.stringify({...metadata,sha256:v.tapeSha256,
      h3:{poke:raw.h3?.poke??'',from:tape.sha256,prefix:P,step:K,route:v.route}})+'\n',{mode:0o600});
  }
  delete v.events;
}
const control={compared:ref?.compared??0,mismatches:ref?.mismatches??null};
const summary={schema:'gng.h3.boss-maneuver.v1',bundleGeneration:selected.generation,
  tapeSha256:tape.sha256,poke:raw.h3?.poke??'',prefix:P,step:K,horizon:[P+1,END],start,
  controlReference:control,runs};
writeFileSync(join(out,`maneuvers-${P}.json`),JSON.stringify(summary,null,2)+'\n',{mode:0o600});
console.log(JSON.stringify({...summary,runs:runs.map(({rows:_,...v})=>v)},null,2));
process.exitCode=runs.every(v=>v.status==='FRAMES_DONE')&&
  (!ref||ref.compared>0&&!ref.mismatches.length)?0:1;
