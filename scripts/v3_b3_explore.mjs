#!/usr/bin/env node
/** E2 offline beam search. Only P1 ports change; CPU remains frozen g4 AOT. */
import {createHash} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {loadFrozen} from '../src/v2_b1_frozen.mjs';
import {selectB3Bundle} from '../src/v3_b3_bundle.mjs';
import {CYCLES_PER_FRAME} from '../src/gngb_runtime.mjs';
import {defineInputSchedule,readScheduledPort} from '../src/gngb_input_contract.mjs';
import {B3_TAPE_SCHEMA,b3Tape} from '../src/v3_b3_tapes.mjs';
import {labCreateBoard} from '../src/v3_b3_lab_board.mjs';
import {resolveB3LabTape} from '../src/v3_b3_external_tape.mjs';

const ROOT=resolve(fileURLToPath(import.meta.url),'../..');
const selected=selectB3Bundle(ROOT);
if(!selected)throw Error('V3_B3_NO_CERTIFIED_BUNDLE');
const {manifest,code}=loadFrozen(selected.dir);
const {blocks}=await import(pathToFileURL(join(selected.dir,'program.mjs')).href);
const {createBoard}=await import(pathToFileURL(join(selected.dir,'gngb_runtime.mjs')).href);
const seedPath=process.argv[2];
const seed=seedPath?resolveB3LabTape(seedPath):null;
const targetArg=process.argv[3]===undefined?null:Number(process.argv[3]);
const stepArg=process.argv[4]===undefined?90:Number(process.argv[4]);
if(targetArg!==null&&(!Number.isSafeInteger(targetArg)||targetArg<1||targetArg>4096))
  throw Error('V3_B3_EXPLORER_TARGET_INVALID');
if(!Number.isSafeInteger(stepArg)||stepArg<20||stepArg>180)
  throw Error('V3_B3_EXPLORER_STEP_INVALID');
const START=seed?.frames??1200,K=stepArg,WIDTH=seed?8:4,END=6000;
const actions=['right','right_fire','right_jump','right_fire_jump',
  'right_late_jump','right_verylate_jump','stand_fire','up','up_fire','left'];
const base=seed?.events??b3Tape('titleCoinStart').events;
const event=(frame,control,pressed)=>({cycle:frame*CYCLES_PER_FRAME,control,pressed});
function segment(start,action){
  const e=[],dir=action.startsWith('right')?'p1.right':
    action.startsWith('up')?'p1.up':action==='left'?'p1.left':null;
  if(dir)e.push(event(start,dir,true),event(start+K-1,dir,false));
  if(action.includes('fire'))for(let f=start+1;f+4<start+K;f+=12)
    e.push(event(f,'p1.button1',true),event(f+3,'p1.button1',false));
  if(action.includes('jump')){
    const first=action==='right_late_jump'?start+Math.floor(K/2):
      action==='right_verylate_jump'?start+K-8:start+1;
    for(let f=first;f+5<start+K;f+=44)
      e.push(event(f,'p1.button2',true),event(f+5,'p1.button2',false));
  }
  return e.sort((a,b)=>a.cycle-b.cycle||a.control.localeCompare(b.control));
}
const position=r=>r.record[0xa0]*256+r.record[0xa1];
const valid=r=>r.known[0xa0]===255&&r.known[0xa1]===255&&
  r.known[0x60]===255&&r.record[0x60]>=1&&r.record[0x60]<=3&&
  r.record[0x52]===1;

// A comparable baseline: deepest point reached while botA was still alive.
const baselineTape=b3Tape('botA');let baseline=0;
let reference;
reference=createBoard(code,blocks,{frames:END,
  portRead:(addr,cycle)=>baselineTape.read(addr,cycle),
  onFrame:r=>{
    if(valid(r)&&position(r)<4096)baseline=Math.max(baseline,position(r));
    reference.state.records[reference.state.records.length-1]=null;
  }});
const refResult=reference.run();
if(refResult.status!=='FRAMES_DONE')throw Error('V3_B3_EXPLORER_BASELINE_'+refResult.status);
console.log('E2_BASELINE_BOTA_WORLD_X='+baseline);

let schedule=defineInputSchedule(base),observed=null,board;
board=await labCreateBoard(join(selected.dir,'gngb_runtime.mjs'),
  manifest.files['gngb_runtime.mjs'],code,blocks,{
    frames:END,portRead:(addr,cycle)=>readScheduledPort(schedule,addr,cycle),
    onFrame:r=>{
      if(observed&&valid(r))observed.max=Math.max(observed.max,position(r));
      board.state.records[board.state.records.length-1]=null;
    }});
if(board.lab.advanceTo(START).status!=='FRAMES_DONE')
  throw Error('V3_B3_EXPLORER_START_FAILED');
const initial=board.state.ramBytes(0,0xa4).bytes;
const initialWorld=initial[0xa0]*256+initial[0xa1];
let beam=[{snapshot:board.lab.save(),events:[],max:initialWorld,lives:initial[0x60],
  world:initialWorld,y:initial[0xa3],
  frame:START,score:0,route:[]}];
let best=beam[0];
const target=targetArg??Math.max(baseline,seed?initialWorld:0)+100;
for(let frame=START;frame+K<=END;frame+=K){
  const next=[];
  for(const parent of beam)for(const action of actions){
    board.lab.restore(parent.snapshot);
    const events=[...parent.events,...segment(frame,action)];
    schedule=defineInputSchedule([...base,...events]);
    observed={max:parent.max};
    const result=board.lab.advanceTo(frame+K);
    if(result.status!=='FRAMES_DONE'){
      console.log('E2_BRANCH_HALT frame='+frame+' action='+action+
        ' status='+result.status+' pc='+result.pc);
      continue;
    }
    const ram=board.state.ramBytes(0,0xa4),lives=ram.bytes[0x60];
    const world=ram.bytes[0xa0]*256+ram.bytes[0xa1];
    const y=ram.bytes[0xa3];
    if(lives<1||lives>3||world>4096)continue;
    const max=observed.max;
    const score=max+world*0.22+Math.max(0,y-62)*0.8-(3-lives)*160;
    const child={snapshot:board.lab.save(),events,max,lives,world,
      y,frame:frame+K,score,route:[...parent.route,action]};
    next.push(child);
    if(max>best.max&&lives>0)best=child;
  }
  if(!next.length){console.log('E2_STOP_NO_LIVE_BRANCH frame='+frame);break;}
  next.sort((a,b)=>b.score-a.score);
  // Preserve alternatives with distinct state, not duplicate action paths.
  const seen=new Set();beam=[];
  for(const c of next){
    const key=[c.lives,c.world,c.y,c.snapshot.hardware.scroll.join(','),
      c.snapshot.hardware.PC].join(':');
    if(seen.has(key))continue;
    seen.add(key);beam.push(c);
    if(beam.length===WIDTH)break;
  }
  if((frame-START)/K%5===4)
    console.log('E2_PROGRESS frame='+best.frame+' best_x='+best.max+
      ' lives='+best.lives+' beam='+beam.length);
  if(best.max>=target)break;
}

const all=[...base,...best.events],canonical=defineInputSchedule(all).events;
const metadata={schema:B3_TAPE_SCHEMA,profile:'explorer-g4',frames:best.frame,
  events:canonical};
const sha256=createHash('sha256').update(JSON.stringify(metadata)).digest('hex');
const out=join(ROOT,'out/v3/b3/explorer');
mkdirSync(out,{recursive:true,mode:0o700});
const file=join(out,'explorer-g4-'+best.frame+'-'+best.max+'.json');
writeFileSync(file,JSON.stringify({...metadata,sha256},null,2)+'\n',{mode:0o600});
console.log('E2_BEST_X='+best.max+' baseline='+baseline+' lives='+best.lives+
  ' frame='+best.frame+' route='+best.route.join(','));
console.log('E2_TAPE='+file);
console.log('E2_SEARCH='+(best.max>=target?'GO_FARTHER':'STOP_NO_CLEAR_ADVANCE'));
process.exitCode=best.max>=target?0:2;
