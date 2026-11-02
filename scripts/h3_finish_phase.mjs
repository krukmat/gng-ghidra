#!/usr/bin/env node
/** Bounded bot continuation after the first boss is defeated. Try short
 * directional holds from a verified explorer tape, keep the first input-only
 * branch whose game phase advances, and save it as a replayable B3 tape.
 * Usage: node scripts/h3_finish_phase.mjs <boss-defeated-tape.json>
 */
import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {basename,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {loadFrozen} from '../src/v2_b1_frozen.mjs';
import {selectB3Bundle} from '../src/v3_b3_bundle.mjs';
import {labCreateBoard} from '../src/v3_b3_lab_board.mjs';
import {resolveB3LabTape} from '../src/v3_b3_external_tape.mjs';
import {defineInputSchedule,readScheduledPort} from '../src/gngb_input_contract.mjs';
import {CYCLES_PER_FRAME as CPF} from '../src/gngb_runtime.mjs';
import {B3_TAPE_SCHEMA} from '../src/v3_b3_tapes.mjs';
import {look,BOSS_LIFE} from '../src/h3_explore.mjs';

const ROOT=resolve(fileURLToPath(import.meta.url),'../..');
const path=process.argv[2];
if(!path)throw Error('H3_FINISH_USAGE');
const raw=JSON.parse(readFileSync(path,'utf8'));
const tape=resolveB3LabTape(path);
const start=raw.h3?.goalFrame;
if(!Number.isSafeInteger(start)||start<1200||!raw.h3?.ramSha||raw.h3.bossLife!==0)
  throw Error('H3_FINISH_NEEDS_BOSS_DEFEATED_TAPE');
const selected=selectB3Bundle(ROOT);
if(!selected)throw Error('H3_FINISH_NO_CERTIFIED_BUNDLE');
const {manifest,code}=loadFrozen(selected.dir);
const {blocks}=await import(pathToFileURL(join(selected.dir,'program.mjs')).href);
const sha256=b=>createHash('sha256').update(b).digest('hex');
const prefixEvents=tape.events.filter(e=>e.cycle<=start*CPF);
let schedule=defineInputSchedule(prefixEvents),transition=null,phase0=null,board;
board=await labCreateBoard(join(selected.dir,'gngb_runtime.mjs'),
  manifest.files['gngb_runtime.mjs'],code,blocks,{frames:1,
    portRead:(addr,cycle)=>readScheduledPort(schedule,addr,cycle),
    onFrame:f=>{
      const i=board.state.records.length;
      if(i>start&&transition===null&&f.record[0x72]!==phase0)transition=i;
      board.state.records[i-1]=null;
      board.state.events.length=0;
    }});
const advance=n=>{
  const result=board.lab.advanceTo(n);
  if(result.status!=='FRAMES_DONE')throw Error('H3_FINISH_REPLAY_'+result.status);
};
advance(start);
if(sha256(board.state.ramBytes(0,0x3000).bytes)!==raw.h3.ramSha)
  throw Error('H3_FINISH_PREFIX_MISMATCH');
phase0=board.state.ramBytes(0,0x600).bytes[0x72];
if(board.state.ramBytes(0,BOSS_LIFE+1).bytes[BOSS_LIFE]!==0)
  throw Error('H3_FINISH_BOSS_NOT_DEFEATED');
const prefix=board.lab.save();
let winner=null;
for(const control of ['p1.left','p1.right']){
  for(const hold of [120,180,240,272,320]){
    const cycle=start*CPF;
    try{schedule=defineInputSchedule([...prefixEvents,
      {cycle,control,pressed:true},{cycle:(start+hold)*CPF,control,pressed:false}]
      .sort((a,b)=>a.cycle-b.cycle||a.control.localeCompare(b.control)));
    }catch{continue;}
    board.lab.restore(prefix);transition=null;
    advance(start+500);
    if(transition!==null){winner={control,hold,transition,events:schedule.events};break;}
  }
  if(winner)break;
}
if(!winner)throw Error('H3_FINISH_NO_PHASE_TRANSITION');
schedule=defineInputSchedule(winner.events);
board.lab.restore(prefix);transition=null;
const goalFrame=winner.transition+60;
advance(goalFrame);
if(transition!==winner.transition)throw Error('H3_FINISH_TRANSITION_UNSTABLE');
const s=look(board.state.ramBytes(0,0x600).bytes);
if(s.phase===phase0)throw Error('H3_FINISH_PHASE_REVERTED');
const signal={phase:s.phase,cp:s.cp,x:s.x,y:s.y,scroll:s.scroll,
  lives:s.lives,armor:s.armor};
const metadata={schema:B3_TAPE_SCHEMA,profile:'explorer-g4',frames:goalFrame,
  events:schedule.events};
const tapeSha=sha256(JSON.stringify(metadata));
const out=join(ROOT,'out/h3/explore');
mkdirSync(out,{recursive:true,mode:0o700});
const file=join(out,'tape-s2-phase-'+goalFrame+'.json');
writeFileSync(file,JSON.stringify({...metadata,sha256:tapeSha,h3:{probe:'h3-key-search',
  bundle:'g'+selected.generation,from:{file:basename(path),sha256:tape.sha256,
    goalFrame:start,ramSha:raw.h3.ramSha},goalFrame,transitionFrame:transition,
  control:winner.control,holdFrames:winner.hold,signal,
  ramSha:sha256(board.state.ramBytes(0,0x3000).bytes)}})+'\n',{mode:0o600});
console.log('H3_FINISH_PHASE=PASS transition='+transition+' goal='+goalFrame+
  ' control='+winner.control+' hold='+winner.hold+' tape='+file);
