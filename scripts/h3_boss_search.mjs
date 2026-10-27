#!/usr/bin/env node
/** H3 lab: beam search from a coherent mid-phase respawn to the next phase.
 * Base tape titleCoinStart; during its first death H3_POKE sets the phase
 * (0x72) and the game's own checkpoint index (0x81=1), so the respawn routine
 * at 0x6D25 rebuilds the mid-phase state exactly as after a legitimate death
 * past the midpoint (0xED64). Only P1 inputs change afterwards; branches where
 * Arthur dies (handler 0x0510 in the bank window, 0x47xx/0x4Bxx, or a hit
 * handler 0x9C5C/0x9C64/0x8E05 while already without armour) or lives drop are
 * pruned; losing the armour (0x00AC=1, cleared by the respawn at 0x6D25) is penalised.
 * DEFERRED (27/10/2026): not validated after the 0x00AC fix; no boss defeated yet.
 * Success: 0x72 advances (boss defeated, key taken, gate crossed).
 * Usage: H3_POKE=... node scripts/h3_boss_search.mjs <phase> [start=2200] [step=60] [end=9000]
 * Env: H3_SEED earlier tape to resume from, H3_WX/H3_WY/H3_WS/H3_WU progress weights (x, max y, score, climb = start y - min y),
 * H3_LAST save the last beam head instead of the best, H3_WA armour-loss penalty, H3_XCAP x cap (boss arena), H3_WIDTH beam width.
 * H3_STEP overrides the positional segment length. H3_BACKTRACK=N enables
 * backtracking N segments when every live branch dies; H3_BACKTRACK_LIMIT caps
 * the number of retries (unlimited by default). Without these variables the
 * original beam-only behaviour is unchanged.
 * Output: out/h3/boss/search-p<phase>-<frame>.json (inputs only, private).
 */
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
import {parseLabPokes,applyLabPokes} from '../src/h3_lab_poke.mjs';
import {resolveB3LabTape} from '../src/v3_b3_external_tape.mjs';

const ROOT=resolve(fileURLToPath(import.meta.url),'../..');
const selected=selectB3Bundle(ROOT);
if(!selected)throw Error('V3_B3_NO_CERTIFIED_BUNDLE');
const {manifest,code}=loadFrozen(selected.dir);
const {blocks}=await import(pathToFileURL(join(selected.dir,'program.mjs')).href);
const [phase,START,ARG_K,END]=[0,2200,60,9000].map((d,i)=>Number(process.argv[2+i]??d));
const K=Number(process.env.H3_STEP??ARG_K);
const WIDTH=Number(process.env.H3_WIDTH??8);
const BACKTRACK=Number(process.env.H3_BACKTRACK??0);
const BACKTRACK_LIMIT=process.env.H3_BACKTRACK_LIMIT===undefined?Infinity:Number(process.env.H3_BACKTRACK_LIMIT);
const WX=Number(process.env.H3_WX??1),WY=Number(process.env.H3_WY??0),WS=Number(process.env.H3_WS??0.02);
const WU=Number(process.env.H3_WU??0),WA=Number(process.env.H3_WA??2000),XCAP=Number(process.env.H3_XCAP??65535);
if(!Number.isInteger(K)||K<1)throw Error('H3_STEP_INVALID '+K);
if(!Number.isInteger(WIDTH)||WIDTH<1)throw Error('H3_WIDTH_INVALID '+WIDTH);
if(!Number.isInteger(BACKTRACK)||BACKTRACK<0)throw Error('H3_BACKTRACK_INVALID '+BACKTRACK);
if(!(BACKTRACK_LIMIT===Infinity||Number.isInteger(BACKTRACK_LIMIT)&&BACKTRACK_LIMIT>=0))
  throw Error('H3_BACKTRACK_LIMIT_INVALID '+BACKTRACK_LIMIT);
const POKES=parseLabPokes();
const actions=['right','right_fire','right_jump','right_fire_jump','right_late_jump',
  'fire','jump','duck_fire','left','left_fire','left_jump','up','up_fire','down'];
// H3_SEED resumes from an earlier search tape: its inputs before START are kept.
const base=process.env.H3_SEED?resolveB3LabTape(process.env.H3_SEED).events
  .filter(e=>e.cycle<START*CYCLES_PER_FRAME):b3Tape('titleCoinStart').events;
const event=(frame,control,pressed)=>({cycle:frame*CYCLES_PER_FRAME,control,pressed});
function segment(start,action){
  const e=[],hold=(c,a,b)=>e.push(event(a,c,true),event(b,c,false));
  const dir=action.startsWith('right')?'p1.right':action.startsWith('left')?'p1.left':
    action.startsWith('up')?'p1.up':action.startsWith('down')||action==='duck_fire'?'p1.down':null;
  if(dir)hold(dir,start,start+K-1);
  if(action.includes('fire'))for(let f=start+1;f+4<start+K;f+=12)hold('p1.button1',f,f+3);
  if(action.includes('jump')){
    const first=action==='right_late_jump'?start+Math.floor(K/2):start+1;
    for(let f=first;f+5<start+K;f+=44)hold('p1.button2',f,f+5);
  }
  return e.sort((a,b)=>a.cycle-b.cycle||a.control.localeCompare(b.control));
}
const bcd=b=>[0x68,0x69,0x6a,0x6b].reduce((v,a)=>v*100+(b[a]>>4)*10+(b[a]&15),0);
const look=b=>({phase:b[0x72],cp:b[0x81],loop:b[0x71],lives:b[0x60],x:b[0xa0]<<8|b[0xa1],y:b[0xa2]<<8|b[0xa3],
  handler:b[0x510]<<8|b[0x511],armor:b[0xac],score:bcd(b),scroll:b[0x58]<<8|b[0x59]});
let schedule=defineInputSchedule(base),dead=false,board;
board=await labCreateBoard(join(selected.dir,'gngb_runtime.mjs'),
  manifest.files['gngb_runtime.mjs'],code,blocks,{frames:END,
    portRead:(addr,cycle)=>readScheduledPort(schedule,addr,cycle),
    onFrame:r=>{
      const i=board.state.records.length;
      board.state.records[i-1]=null;
      applyLabPokes(POKES,board.state,i);
      const h=r.record[0x510]<<8|r.record[0x511];
      if(i>START&&(h<0x6000||r.record[0xac]&&(h===0x8e05||(h&0xffe0)===0x9c40)))dead=true;
    }});
if(board.lab.advanceTo(START).status!=='FRAMES_DONE')throw Error('H3_BOSS_START_FAILED');
const s0=look(board.state.ramBytes(0,0x600).bytes);
console.log('H3_BOSS_START '+JSON.stringify(s0));
if(s0.phase!==phase)throw Error('H3_BOSS_START_PHASE '+s0.phase);
// XCAP stops rewarding x in a boss arena.
const value=(s,maxX,maxY,minY)=>s.phase!==phase?1e9:
  WX*Math.min(maxX,XCAP)+WY*maxY+WU*(s0.y-minY)+WS*s.score-WA*s.armor;
let branches=0,halts=0;
let beam=[{snap:board.lab.save(),events:[],s:s0,maxX:s0.x,maxY:s0.y,minY:s0.y,v:0,route:[]}],best=beam[0],done=null;
let depth=0,backtracks=0;
const history=new Map();
while(START+(depth+1)*K<=END&&!done){
  const frame=START+depth*K;
  const next=[];
  for(const p of beam)for(const a of actions){
    board.lab.restore(p.snap);dead=false;
    const events=[...p.events,...segment(frame,a)];
    schedule=defineInputSchedule([...base,...events]);
    const res=board.lab.advanceTo(frame+K);branches++;
    if(res.status!=='FRAMES_DONE'){halts++;console.log('H3_BOSS_HALT '+frame+' '+a+' '+res.status+' pc='+res.pc);continue;}
    const s=look(board.state.ramBytes(0,0x600).bytes);
    if(s.phase===phase&&(dead||s.lives<p.s.lives)){
      if(process.env.H3_DEBUG)console.log('H3_BOSS_PRUNE f='+frame+' '+a+' dead='+dead+' '+JSON.stringify(s));
      continue;}
    const c={snap:board.lab.save(),events,s,maxX:Math.max(p.maxX,s.x),maxY:Math.max(p.maxY,s.y),minY:Math.min(p.minY,s.y),route:[...p.route,a]};
    c.v=value(s,c.maxX,c.maxY,c.minY);next.push(c);
    if(s.phase!==phase){done=c;break;}
  }
  if(done)break;
  if(!next.length){
    const targetDepth=depth+1-BACKTRACK;
    const prior=history.get(targetDepth);
    if(!BACKTRACK||backtracks>=BACKTRACK_LIMIT||targetDepth<1||!prior||prior.cursor>=prior.ranked.length){
      console.log('H3_BOSS_STOP_NO_LIVE_BRANCH '+frame);break;
    }
    beam=prior.ranked.slice(prior.cursor,prior.cursor+WIDTH);
    prior.cursor+=beam.length;backtracks++;
    for(const d of history.keys())if(d>targetDepth)history.delete(d);
    depth=targetDepth;
    console.log('H3_BOSS_BACKTRACK from='+(frame+K)+' to='+(START+depth*K)+' depth='+BACKTRACK+
      ' retry='+backtracks+' alternatives='+beam.length+' remaining='+(prior.ranked.length-prior.cursor));
    continue;
  }
  next.sort((a,b)=>b.v-a.v);
  const seen=new Set(),ranked=[];
  for(const c of next){
    const key=[c.s.x,c.s.y,c.s.armor,c.s.handler,c.s.score,c.snap.hardware.scroll.join(',')].join(':');
    if(seen.has(key))continue;seen.add(key);ranked.push(c);
    if(!BACKTRACK&&ranked.length===WIDTH)break;
  }
  beam=ranked.slice(0,WIDTH);
  if(BACKTRACK){
    history.set(depth+1,{ranked,cursor:beam.length});
    for(const d of history.keys())if(d<depth+1-BACKTRACK)history.delete(d);
  }
  if(beam[0].v>best.v)best=beam[0];
  if(((frame-START)/K)%5===4)console.log('H3_BOSS_PROGRESS f='+(frame+K)+' '+JSON.stringify(beam[0].s)+' maxX='+beam[0].maxX+' maxY='+beam[0].maxY);
  depth++;
}
const win=done??(process.env.H3_LAST?beam[0]:best);
const frames=(done?win.snap.recordCount:win.snap.recordCount)+300;
const metadata={schema:B3_TAPE_SCHEMA,profile:'explorer-g4',frames,
  events:defineInputSchedule([...base,...win.events]).events};
const sha256=createHash('sha256').update(JSON.stringify(metadata)).digest('hex');
const out=join(ROOT,'out/h3/boss');mkdirSync(out,{recursive:true,mode:0o700});
const file=join(out,'search-p'+phase+'-'+win.snap.recordCount+'.json');
const search=BACKTRACK?{step:K,backtrack:BACKTRACK,
  backtrackLimit:Number.isFinite(BACKTRACK_LIMIT)?BACKTRACK_LIMIT:'unlimited',backtracks}:{};
writeFileSync(file,JSON.stringify({...metadata,sha256,h3:{poke:process.env.H3_POKE??'',route:win.route,...search}})+'\n',{mode:0o600});
const retryResult=BACKTRACK?' backtracks='+backtracks:'';
console.log('H3_BOSS_RESULT '+(done?'PHASE_ADVANCED':'NOT_ADVANCED')+' frame='+win.snap.recordCount+' branches='+branches+' halts='+halts+retryResult+' '+JSON.stringify(win.s));
console.log('H3_BOSS_TAPE='+file);
process.exitCode=done?0:2;
