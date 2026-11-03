#!/usr/bin/env node
/** H3 lab: beam search from a coherent mid-phase respawn to the next phase.
 * Base tape titleCoinStart; during its first death H3_POKE sets the phase
 * (0x72) and the game's own checkpoint index (0x81=1), so the respawn routine
 * at 0x6D25 rebuilds the mid-phase state exactly as after a legitimate death
 * past the midpoint (0xED64). Only P1 inputs change afterwards; branches where
 * Arthur dies (handler 0x0510 in the bank window, 0x47xx/0x4Bxx, or a hit
 * handler 0x9C5C/0x9C64/0x8E05 while already without armour) or lives drop are
 * pruned; losing the armour (0x00AC=1, cleared by the respawn at 0x6D25) is penalised.
 * Without H3_POKE, H3_SEED continues an input-only tape instead: phases 2 and 3
 * were completed that way (02/11/2026; docs/go-explore/README.md).
 * Success: 0x72 advances (boss defeated, key taken, gate crossed).
 * Usage: [H3_POKE=...|H3_SEED=<tape>] node scripts/h3_boss_search.mjs <phase> [start=2200] [step=60] [end=9000]
 * Env: H3_SEED earlier tape to resume from, H3_WX/H3_WY/H3_WCY/H3_WS/H3_WU progress weights (x, max y, current y, score, climb = start y - min y),
 * H3_WB health penalty; H3_BOSS_LIFE comma-separated RAM health addresses (default 0xe76),
 * H3_LAST save the last beam head instead of the best, H3_WA armour-loss penalty,
 * H3_XCAP/H3_YCAP x/current-y caps (boss arena), H3_WIDTH beam width.
 * H3_STEP overrides the positional segment length. H3_BACKTRACK=N enables
 * backtracking N segments when every live branch dies; H3_BACKTRACK_LIMIT caps
 * the number of retries (unlimited by default). Without these variables the
 * original beam-only behaviour is unchanged. H3_DEBUG logs every pruned branch.
 * H3_GOAL=<addr:value,...> also succeeds on the first frame, still in
 * <phase>, where every listed RAM byte matches (e.g. 0x08:2,0xb6:0 for the
 * final room, whose exit is a backward 6→0 change).
 * H3_FOLLOW=<tape>:<shift> reuses a donor route (src/h3_follow.mjs): START
 * is matched to donor frame START-shift, and each branch to the nearest donor
 * position around its parent's match; 'follow' (one more action) replays the
 * donor's P1 inputs from that match, and the value adds H3_WF (default 1)
 * times (donor frames advanced - H3_WD (default 1) * distance |dx|+|dy|), so
 * only the segments where the run diverges are re-optimised. H3_TAG=<a-z0-9->
 * suffixes the output name so parallel runs never overwrite each other.
 * Output: out/h3/boss/search-p<phase>-<frame>[-<tag>].json (inputs only, private);
 * without H3_POKE its h3 also has goalFrame (the saved head), signal and ramSha,
 * so `h3_explore.mjs replay` verifies it and `explore --from` continues from it.
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
import {weaponPolicyForPhase,phaseOutcome,progressionCandidate,weaponPriority} from '../src/h3_weapon_policy.mjs';
import {P1_BITS,eventsToMasks} from '../src/h3_explore.mjs';
import {trailWindow,matchTrail,followEvents,joinEvents,heldMask} from '../src/h3_follow.mjs';

const ROOT=resolve(fileURLToPath(import.meta.url),'../..');
const selected=selectB3Bundle(ROOT);
if(!selected)throw Error('V3_B3_NO_CERTIFIED_BUNDLE');
const {manifest,code}=loadFrozen(selected.dir);
const {blocks}=await import(pathToFileURL(join(selected.dir,'program.mjs')).href);
const [phase,START,ARG_K,END]=[0,2200,60,9000].map((d,i)=>Number(process.argv[2+i]??d));
const K=Number(process.env.H3_STEP??ARG_K);
const policy=weaponPolicyForPhase(phase);
const WIDTH=Number(process.env.H3_WIDTH??8);
const BACKTRACK=Number(process.env.H3_BACKTRACK??0);
const BACKTRACK_LIMIT=process.env.H3_BACKTRACK_LIMIT===undefined?Infinity:Number(process.env.H3_BACKTRACK_LIMIT);
const WX=Number(process.env.H3_WX??1),WY=Number(process.env.H3_WY??0),
  WCY=Number(process.env.H3_WCY??0),WS=Number(process.env.H3_WS??0.02);
const WU=Number(process.env.H3_WU??0),WA=Number(process.env.H3_WA??2000),
  WB=Number(process.env.H3_WB??0),XCAP=Number(process.env.H3_XCAP??65535),
  YCAP=Number(process.env.H3_YCAP??65535);
const LIFE_ADDRS=(process.env.H3_BOSS_LIFE??'0xe76').split(',').map(Number);
if(!LIFE_ADDRS.length||LIFE_ADDRS.some(a=>!Number.isInteger(a)||a<0||a>=0x3000))
  throw Error('H3_BOSS_LIFE_INVALID');
const GOAL=(process.env.H3_GOAL??'').split(',').filter(Boolean).map(g=>g.split(':').map(Number));
if(GOAL.some(([a,v])=>!Number.isInteger(a)||a<0||a>=0x3000||!Number.isInteger(v)||v<0||v>255))
  throw Error('H3_GOAL_INVALID');
const LOOK_BYTES=Math.max(0xe77,...LIFE_ADDRS.map(a=>a+1));
if(!Number.isInteger(K)||K<1)throw Error('H3_STEP_INVALID '+K);
if(!Number.isInteger(WIDTH)||WIDTH<1)throw Error('H3_WIDTH_INVALID '+WIDTH);
if(!Number.isInteger(BACKTRACK)||BACKTRACK<0)throw Error('H3_BACKTRACK_INVALID '+BACKTRACK);
if(!(BACKTRACK_LIMIT===Infinity||Number.isInteger(BACKTRACK_LIMIT)&&BACKTRACK_LIMIT>=0))
  throw Error('H3_BACKTRACK_LIMIT_INVALID '+BACKTRACK_LIMIT);
const POKES=parseLabPokes();
const FOLLOW=process.env.H3_FOLLOW?(([file,shift])=>({file,shift:Number(shift)}))(process.env.H3_FOLLOW.split(':')):null;
if(FOLLOW&&(!FOLLOW.file||!Number.isSafeInteger(FOLLOW.shift)))throw Error('H3_FOLLOW_INVALID');
const WF=Number(process.env.H3_WF??(FOLLOW?1:0)),WD=Number(process.env.H3_WD??1);
const TAG=process.env.H3_TAG??'';
if(!/^[a-z0-9-]*$/.test(TAG))throw Error('H3_TAG_INVALID');
const actions=['right','right_fire','right_jump','right_fire_jump','right_late_jump',
  'fire','jump','duck_fire','left','left_fire','left_jump','up','up_fire','down',...FOLLOW?['follow']:[]];
// H3_SEED resumes from an earlier search tape: its inputs before START are kept.
const base=process.env.H3_SEED?resolveB3LabTape(process.env.H3_SEED).events
  .filter(e=>e.cycle<START*CYCLES_PER_FRAME):b3Tape('titleCoinStart').events;
const event=(frame,control,pressed)=>({cycle:frame*CYCLES_PER_FRAME,control,pressed});
// Donor trail (lo..hi) and its masks up to hi+K, so 'follow' from any match fits.
// The whole donor tape: a branch may lag the donor by more than START-k0.
const WINDOW=trailWindow(K);
const follow=FOLLOW?{tape:resolveB3LabTape(FOLLOW.file),k0:START-FOLLOW.shift}:null;
if(follow){
  follow.lo=Math.max(1,follow.k0-WINDOW.behind);
  follow.hi=follow.tape.frames-K-1;
  if(follow.k0<follow.lo||follow.k0>follow.hi)throw Error('H3_FOLLOW_HORIZON');
  follow.masks=eventsToMasks(follow.lo,follow.hi+K+1,follow.tape.events);
}
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
  handler:b[0x510]<<8|b[0x511],armor:b[0xac],weapon:b[0x73],
  score:bcd(b),scroll:b[0x58]<<8|b[0x59],
  boss:LIFE_ADDRS.reduce((sum,a)=>sum+b[a],0)});
let schedule=defineInputSchedule(base),dead=false,goal=false,board;
let previousFramePhase=null,previousFrameWeapon=null,weaponAtTransition=null;
board=await labCreateBoard(join(selected.dir,'gngb_runtime.mjs'),
  manifest.files['gngb_runtime.mjs'],code,blocks,{frames:END,
    portRead:(addr,cycle)=>readScheduledPort(schedule,addr,cycle),
    onFrame:r=>{
      const i=board.state.records.length;
      board.state.records[i-1]=null;
      applyLabPokes(POKES,board.state,i);
      if(previousFramePhase===phase&&r.record[0x72]!==phase&&weaponAtTransition===null)
        weaponAtTransition=previousFrameWeapon??r.record[0x73];
      previousFramePhase=r.record[0x72];previousFrameWeapon=r.record[0x73];
      const h=r.record[0x510]<<8|r.record[0x511];
      if(GOAL.length&&i>START&&r.record[0x72]===phase&&GOAL.every(([a,v])=>r.record[a]===v))goal=true;
      if(i>START&&(h<0x6000||r.record[0xac]&&
        (r.record[0x503]===3||h===0x8e05||h===0x9c64||(h&0xffe0)===0x9c40)))dead=true;
    }});
if(board.lab.advanceTo(START).status!=='FRAMES_DONE')throw Error('H3_BOSS_START_FAILED');
// Donor trail: Arthur's position per donor frame while it is in this phase,
// from the donor's own replay from reset.
if(follow){
  const pos=new Int32Array(2*(follow.hi-follow.lo+1)).fill(-1),fsched=defineInputSchedule(follow.tape.events);
  const donor=await labCreateBoard(join(selected.dir,'gngb_runtime.mjs'),
    manifest.files['gngb_runtime.mjs'],code,blocks,{frames:follow.hi,
      portRead:(addr,cycle)=>readScheduledPort(fsched,addr,cycle),
      onFrame:r=>{const i=donor.state.records.length,b=r.record;donor.state.records[i-1]=null;
        if(i>=follow.lo&&i<=follow.hi&&b[0x72]===phase){
          pos[2*(i-follow.lo)]=b[0xa0]<<8|b[0xa1];pos[2*(i-follow.lo)+1]=b[0xa2]<<8|b[0xa3];}}});
  if(donor.lab.advanceTo(follow.hi).status!=='FRAMES_DONE')throw Error('H3_FOLLOW_REPLAY_FAILED');
  follow.pos=pos;
}
const match=(s,k)=>follow?matchTrail(follow,s,k,WINDOW):{k:0,d:0};
const s0=look(board.state.ramBytes(0,LOOK_BYTES).bytes);
console.log('H3_BOSS_START '+JSON.stringify(s0));
if(s0.phase!==phase)throw Error('H3_BOSS_START_PHASE '+s0.phase);
// XCAP stops rewarding x in a boss arena.
const value=(s,maxX,maxY,minY,m)=>s.phase!==phase?1e9:
  WX*Math.min(maxX,XCAP)+WY*maxY+WCY*Math.min(s.y,YCAP)+
  WU*(s0.y-minY)+WS*s.score-WA*s.armor-WB*s.boss+
  (follow?WF*(m.k-follow.k0-WD*Math.min(m.d,1e6)):0);
let branches=0,halts=0,invalidTransitions=0;
// With H3_FOLLOW, P1 controls the seed still holds at START are tracked (and
// released by the next macro); the start is matched on the trail too.
const m0=follow?match(s0,follow.k0):{k:0,d:0};
let beam=[{snap:board.lab.save(),events:[],s:s0,maxX:s0.x,maxY:s0.y,minY:s0.y,v:0,route:[],
  mask:follow?heldMask(base):0,k:m0.k,d:m0.d}],best=beam[0],done=null;
if(follow)console.log('H3_FOLLOW_START k0='+follow.k0+' match='+m0.k+' d='+m0.d+' trail='+follow.lo+'..'+follow.hi+' held='+beam[0].mask);
let depth=0,backtracks=0;
const history=new Map();
while(START+(depth+1)*K<=END&&!done){
  const frame=START+depth*K;
  const next=[];
  for(const p of beam)for(const a of actions){
    board.lab.restore(p.snap);dead=false;goal=false;
    previousFramePhase=p.s.phase;previousFrameWeapon=p.s.weapon;weaponAtTransition=null;
    const seg=a==='follow'?followEvents(follow.masks,follow.lo,p.k,frame,K,p.mask):
      {events:p.mask?joinEvents(frame,p.mask,segment(frame,a)):segment(frame,a),mask:0};
    const events=[...p.events,...seg.events];
    schedule=defineInputSchedule([...base,...events]);
    const res=board.lab.advanceTo(frame+K);branches++;
    if(res.status!=='FRAMES_DONE'){halts++;console.log('H3_BOSS_HALT '+frame+' '+a+' '+res.status+' pc='+res.pc);continue;}
    const s=look(board.state.ramBytes(0,LOOK_BYTES).bytes);
    const outcome=phaseOutcome(phase,s.phase,weaponAtTransition??s.weapon,policy);
    if(goal){done={snap:board.lab.save(),events,s,route:[...p.route,a],mask:seg.mask,k:p.k,d:p.d,goal};break;}
    if(s.phase!==phase&&!progressionCandidate(outcome)){
      invalidTransitions++;
      if(process.env.H3_DEBUG)console.log('H3_BOSS_PRUNE_PHASE f='+(frame+K)+
        ' action='+a+' outcome='+outcome+' weaponAtExit='+(weaponAtTransition??s.weapon)+
        ' '+JSON.stringify(s));
      continue;
    }
    if(s.phase===phase&&(dead||s.lives<p.s.lives)){
      if(process.env.H3_DEBUG)console.log('H3_BOSS_PRUNE f='+frame+' '+a+' dead='+dead+' '+JSON.stringify(s));
      continue;}
    const m=match(s,p.k);
    const c={snap:board.lab.save(),events,s,maxX:Math.max(p.maxX,s.x),maxY:Math.max(p.maxY,s.y),minY:Math.min(p.minY,s.y),route:[...p.route,a],mask:seg.mask,k:m.k,d:m.d};
    c.v=value(s,c.maxX,c.maxY,c.minY,m);next.push(c);
    if(s.phase!==phase&&progressionCandidate(outcome)){done=c;break;}
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
  next.sort((a,b)=>weaponPriority(b.s,policy)-weaponPriority(a.s,policy)||b.v-a.v);
  const seen=new Set(),ranked=[];
  for(const c of next){
    const key=[c.s.x,c.s.y,c.s.armor,...policy?[c.s.weapon]:[],
      c.s.handler,c.s.score,c.snap.hardware.scroll.join(',')].join(':');
    if(seen.has(key))continue;seen.add(key);ranked.push(c);
    if(!BACKTRACK&&ranked.length===WIDTH)break;
  }
  beam=ranked.slice(0,WIDTH);
  if(BACKTRACK){
    history.set(depth+1,{ranked,cursor:beam.length});
    for(const d of history.keys())if(d<depth+1-BACKTRACK)history.delete(d);
  }
  if(weaponPriority(beam[0].s,policy)>weaponPriority(best.s,policy)||
    weaponPriority(beam[0].s,policy)===weaponPriority(best.s,policy)&&beam[0].v>best.v)
    best=beam[0];
  if(((frame-START)/K)%5===4)console.log('H3_BOSS_PROGRESS f='+(frame+K)+' '+JSON.stringify(beam[0].s)+' maxX='+beam[0].maxX+' maxY='+beam[0].maxY+
    (follow?' k='+beam[0].k+' d='+beam[0].d+' last='+beam[0].route.at(-1):''));
  depth++;
}
const win=done??(process.env.H3_LAST?beam[0]:best);
const frames=(done?win.snap.recordCount:win.snap.recordCount)+300;
// A head reached by 'follow' may still hold P1 controls: release them after it.
const release=Object.entries(P1_BITS).filter(([,bit])=>win.mask&bit).map(([c])=>event(win.snap.recordCount,c,false));
const metadata={schema:B3_TAPE_SCHEMA,profile:'explorer-g4',frames,
  events:defineInputSchedule([...base,...win.events,...release]).events};
const sha256=createHash('sha256').update(JSON.stringify(metadata)).digest('hex');
const out=join(ROOT,'out/h3/boss');mkdirSync(out,{recursive:true,mode:0o700});
const file=join(out,'search-p'+phase+'-'+win.snap.recordCount+(TAG?'-'+TAG:'')+'.json');
const search=BACKTRACK?{step:K,backtrack:BACKTRACK,
  backtrackLimit:Number.isFinite(BACKTRACK_LIMIT)?BACKTRACK_LIMIT:'unlimited',backtracks}:{};
// Input-only heads also carry goalFrame/signal/ramSha, so replay checks them and explore --from resumes.
let anchor={};
if(!POKES.length){
  board.lab.restore(win.snap);
  const r=board.state.ramBytes(0,0x3000).bytes,w=look(r);
  anchor={goalFrame:win.snap.recordCount,signal:{phase:w.phase,cp:w.cp,x:w.x,y:w.y,scroll:w.scroll,lives:w.lives,armor:w.armor},
    ramSha:createHash('sha256').update(r).digest('hex')};
}
writeFileSync(file,JSON.stringify({...metadata,sha256,h3:{poke:process.env.H3_POKE??'',route:win.route,
  ...policy?{progressionPolicy:policy.id,requiredWeapon:policy.requiredWeapon,
    progressionStatus:'UNVERIFIED'}:{},...search,...anchor,
  // The head's donor match: continue with H3_FOLLOW=<donor>:<START-k>.
  ...follow?{follow:{donor:follow.tape.sha256,shift:FOLLOW.shift,k:win.k,d:win.d}}:{}}})+'\n',{mode:0o600});
const retryResult=BACKTRACK?' backtracks='+backtracks:'';
console.log('H3_BOSS_RESULT '+(done?done.goal?'GOAL_REACHED':policy?'PROGRESSION_CANDIDATE':'PHASE_ADVANCED':'NOT_ADVANCED')+
  ' frame='+win.snap.recordCount+' branches='+branches+' halts='+halts+
  ' invalidTransitions='+invalidTransitions+retryResult+' '+JSON.stringify(win.s)+
  (follow?' k='+win.k+' d='+win.d+' follows='+win.route.filter(a=>a==='follow').length+'/'+win.route.length:''));
console.log('H3_BOSS_TAPE='+file);
process.exitCode=done?0:2;
