#!/usr/bin/env node
/** Private Go-Explore of a cooperative two-player game (games/gngb/options.mjs
 * `coop`, default lives and difficulty, no Continue) from reset until the
 * team completes visible phases 1 and 2 (RAM 0x72: 0 -> 1 -> 2). Lab board on
 * the certified frozen bundle (src/v3_b3_lab_board.mjs) with the options'
 * block wrappers; save/restore only between branches; the tape is inputs only.
 * Both players play with the P1 controls (upright cabinet), so a trajectory
 * is P1 masks (src/h3_explore.mjs) from frame 1200 after two coins and Start 2.
 * Unlike the one-player search a death does not end a branch: the turn passes
 * and the other player continues the team's game. A branch ends only when the
 * game ends (both players out of lives).
 * Cell: phase, checkpoint, X>>4, Y>>3, armour, whose turn, boss hits. A cell
 * keeps the trajectory with more team lives left, then armour, then fewer
 * frames. Boss hits: drops of 1-2 in the boss life bytes while in the boss
 * stretch (phase 1 cyclops 0x0E76 from scroll 2900; phase 2 guardians 0x0CF6
 * and 0x0D56 from scroll 6400; measured on tape-fase2-completa-16980.json).
 * When a phase is completed the archive restarts from that cell.
 * Once the boss of the phase is down (all its life in hits), a quarter of the
 * branches hold left or right for 120-319 frames and then release, which is
 * how the one-player route picked up the key (tape-s2-phase-5950.json: left
 * held 240 frames); random 120-frame chunks rarely do it.
 * A phase only counts as completed when the turn changed during it, so both
 * players took part in every phase (the branch is cut otherwise).
 * COOP_TURN_BIAS=<k> (default 1) multiplies a cell's selection weight by k
 * once the turn has changed in the current phase, so the search spends its time
 * where the other player has taken over and both players are seen playing.
 * After a phase change the game shows the map for longer than one chunk with
 * Arthur still: while a cell has the key its archive started with, time
 * (100-frame steps, up to 12) joins the cell key so the search can wait.
 * COOP_FROM=<tape> continues from the goal frame of a tape written by this
 * script (its RAM hash must match), e.g. a ...-phase1.json.
 * Usage: [COOP_TURN_BIAS=8] [COOP_FROM=<tape>] node scripts/gng_coop_explore.mjs [seed=1] [minutes=120]
 * Writes out/gng-coop/explore/tape-s<seed>-<frame>-{goal|phase<N>|best}.json
 * and a progress log on stdout; every minute the best route so far goes to
 * ...-preview.json (replacing the previous one).
 */
import {mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {loadFrozen} from '../src/v2_b1_frozen.mjs';
import {selectB3Bundle} from '../src/v3_b3_bundle.mjs';
import {labCreateBoard} from '../src/v3_b3_lab_board.mjs';
import {CYCLES_PER_FRAME as CPF} from '../src/gngb_runtime.mjs';
import {defineInputSchedule,readScheduledPort} from '../src/gngb_input_contract.mjs';
import {B3_TAPE_SCHEMA} from '../src/v3_b3_tapes.mjs';
import {EXPLORE_DEFAULTS as P,prng,chunkMasks,extendMasks,masksToEvents,eventsToMasks,sha256}
  from '../src/h3_explore.mjs';
import {DIP_DEFAULTS} from '../games/gngb/inputs.mjs';
import {gameOptions,optionDips,withGameOptions} from '../games/gngb/options.mjs';

const ROOT=resolve(fileURLToPath(import.meta.url),'../..');
const OUT=join(ROOT,'out/gng-coop/explore');
const seed=Number(process.argv[2]??1),minutes=Number(process.argv[3]??120);
const START=1200,MAX_FRAMES=60000,GOAL_PHASE=2;
const TURN_BIAS=Number(process.env.COOP_TURN_BIAS??1);
if(!(TURN_BIAS>=1))throw Error('COOP_TURN_BIAS_INVALID');
const OPTIONS=gameOptions({coop:true,continues:false});
// The frozen runtime reads the default DIP bytes: the options must match them.
if(optionDips(OPTIONS).some((v,i)=>v!==DIP_DEFAULTS[i]))throw Error('COOP_EXPLORE_DIPS');
// `life`: hits after which the key maneuver is tried (phase 2: one guardian's worth).
const BOSS=[{phase:0,from:2900,bytes:[0xe76],life:10},{phase:1,from:6400,bytes:[0xcf6,0xd56],life:10}];
const LEFT=2,RIGHT=1,SETTLE=260;
const press=(f,control,n)=>[{cycle:f*CPF,control,pressed:true},
  {cycle:(f+n)*CPF,control,pressed:false}];
const BOOT=[...press(560,'coin1',12),...press(600,'coin1',12),...press(680,'start2',12)]
  .sort((a,b)=>a.cycle-b.cycle);

const selected=selectB3Bundle(ROOT);
if(!selected)throw Error('V3_B3_NO_CERTIFIED_BUNDLE');
const {manifest,code}=loadFrozen(selected.dir);
const {blocks}=await import(pathToFileURL(join(selected.dir,'program.mjs')).href);
const base=defineInputSchedule(BOOT),cur=new Uint8Array(MAX_FRAMES);

// Per-frame trackers, part of each cell (restored with it).
let ended=0,dmg=0,swaps=0,last=null;
const label=b=>({phase:b[0x72],cp:b[0x81],x:b[0xa0]<<8|b[0xa1],y:b[0xa2]<<8|b[0xa3],
  scroll:b[0x58]<<8|b[0x59],armor:b[0xac],turn:b[0x27]&1,mode:b[0x02],
  lives:b[0x60]+b[0x440]});
const board=await labCreateBoard(join(selected.dir,'gngb_runtime.mjs'),
  manifest.files['gngb_runtime.mjs'],code,withGameOptions(blocks,OPTIONS),{frames:1,
    portRead:(a,c)=>a===0x3001&&c>=START*CPF?0xff^cur[Math.floor(c/CPF)-START]:
      readScheduledPort(base,a,c),
    onFrame:r=>{
      const i=board.state.records.length,b=r.record;board.state.records[i-1]=null;
      if(i<=START)return;
      if(b[0x02]!==2&&!ended)ended=i;
      const boss=BOSS.find(z=>z.phase===b[0x72]&&(b[0x58]<<8|b[0x59])>=z.from);
      if(last){
        if(b[0x72]!==last.phase)dmg=0;
        else if(boss)boss.bytes.forEach((a,j)=>{const d=last.boss[j]-b[a];
          if(last.inBoss&&d>=1&&d<=2)dmg+=d;});
        if((b[0x27]&1)!==last.turn)swaps++;
      }
      last={phase:b[0x72],turn:b[0x27]&1,inBoss:!!boss,boss:boss?boss.bytes.map(a=>b[a]):[]};
    }});
const view=()=>({...label(board.state.ramBytes(0,0x600).bytes),dmg,swaps});
let root=null;
const baseKey=s=>[s.phase,s.cp,s.x>>4,s.y>>3,s.armor,s.turn,s.dmg].join(':');
const stall=(k,frame)=>root&&frame>root.frame&&k===root.base?
  Math.min(12,Math.ceil((frame-root.frame)/100)):0;
const keyOf=(s,frame)=>{const k=baseKey(s);return k+':'+stall(k,frame);};
const turned=c=>Math.min(c.swaps-(root?.swaps??0),1);
const better=(c,o)=>!o||c.lives>o.lives||c.lives===o.lives&&
  (c.armor<o.armor||c.armor===o.armor&&c.frame<o.frame);
// With a turn bias the best cell is one where both players have played.
const rank=c=>[c.phase,TURN_BIAS>1?turned(c):0,c.dmg,c.scroll,c.x,c.lives,-c.frame];
const ahead=(a,b)=>{const x=rank(a),y=rank(b);
  for(let i=0;i<x.length;i++)if(x[i]!==y[i])return x[i]>y[i];return false;};
const keep=(s,frame)=>({...s,key:keyOf(s,frame),frame,masks:cur.slice(0,frame-START),
  snap:board.lab.save(),last:structuredClone(last),chosen:0});

function writeTape(c,tag){
  const events=defineInputSchedule([...BOOT,...masksToEvents(START,c.masks,0)]
    .sort((a,b)=>a.cycle-b.cycle)).events;
  const metadata={schema:B3_TAPE_SCHEMA,profile:'explorer-g4',frames:c.frame+60,events};
  board.lab.restore(c.snap);
  const file=join(OUT,'tape-s'+seed+(TURN_BIAS>1?'b'+TURN_BIAS:'')+'-'+c.frame+'-'+tag+'.json');
  writeFileSync(file,JSON.stringify({...metadata,sha256:sha256(JSON.stringify(metadata)),
    coop:{probe:'gng-coop-explore',bundle:selected.generation,seed,turnBias:TURN_BIAS,options:OPTIONS,
      goalFrame:c.frame,ramSha:sha256(board.state.ramBytes(0,0x3000).bytes),
      signal:{phase:c.phase,cp:c.cp,x:c.x,scroll:c.scroll,lives:c.lives,turn:c.turn,
        swaps:c.swaps},phases:c.phases}})+'\n',{mode:0o600});
  console.log('COOP_EXPLORE_TAPE '+file);
  return file;
}

mkdirSync(OUT,{recursive:true,mode:0o700});
const FROM=process.env.COOP_FROM?JSON.parse(readFileSync(process.env.COOP_FROM,'utf8')):null;
const first=FROM?FROM.coop.goalFrame:START;
if(FROM)cur.set(eventsToMasks(START,first,FROM.events));
if(board.lab.advanceTo(first).status!=='FRAMES_DONE')throw Error('COOP_EXPLORE_START');
if(FROM&&sha256(board.state.ramBytes(0,0x3000).bytes)!==FROM.coop.ramSha)
  throw Error('COOP_EXPLORE_FROM_MISMATCH');
const s0=view();
console.log('COOP_EXPLORE_START bundle=g'+selected.generation+' seed='+seed+' '+JSON.stringify(s0));
if(s0.mode!==2)throw Error('COOP_EXPLORE_NOT_IN_GAME');
root={...keep(s0,first),base:baseKey(s0),phases:FROM?FROM.coop.phases:[]};
let cells=new Map([[root.key,root]]),list=[root];
let best=root,goal=null,n=0,frames=0,cuts=0,lastPreview=null;
const rand=prng(seed),t0=Date.now();let tLog=t0;
while(!goal&&Date.now()-t0<minutes*60000){
  const top=Math.max(1,...list.map(c=>c.scroll));
  let total=0;const w=list.map(c=>{const v=(1+2*c.scroll/top)*2**c.dmg*TURN_BIAS**turned(c)/Math.sqrt(1+c.chosen);
    total+=v;return v;});
  let r=rand()*total,c=list.at(-1);
  for(let i=0;i<list.length;i++){r-=w[i];if(r<0){c=list[i];break;}}
  c.chosen++;n++;
  board.lab.restore(c.snap);ended=0;dmg=c.dmg;swaps=c.swaps;last=structuredClone(c.last);
  const len=c.masks.length;
  const down=BOSS.find(z=>z.phase===c.phase)?.life<=c.dmg;
  let chunk;
  if(down&&rand()<0.25){
    const hold=120+Math.floor(rand()*200);
    chunk=new Uint8Array(hold+SETTLE).fill(rand()<0.5?LEFT:RIGHT,0,hold);
  }else chunk=chunkMasks(rand,P.chunk,len?c.masks[len-1]:0,P);
  extendMasks(cur,c.masks,chunk);
  let advanced=null;
  for(let k=P.evalEvery;k<=chunk.length&&c.frame+k<MAX_FRAMES;k+=P.evalEvery){
    const f=c.frame+k,res=board.lab.advanceTo(f);frames+=P.evalEvery;
    if(res.status!=='FRAMES_DONE')throw Error('COOP_EXPLORE_HALT '+JSON.stringify({f,...res}));
    if(ended){cuts++;break;}
    const s={...view(),phases:c.phases};
    if(s.phase!==c.phase&&s.phase!==c.phase+1){cuts++;break;}
    // Both players must have played this phase before it counts.
    if(s.phase===c.phase+1&&s.swaps===root.swaps){cuts++;break;}
    if(s.phase===c.phase+1)s.phases=[...c.phases,{to:s.phase,frame:f,turn:s.turn}];
    const key=keyOf(s,f),old=cells.get(key),cand={...s,frame:f};
    if(!better(cand,old))continue;
    const cell={...keep(s,f),phases:s.phases,chosen:old?.chosen??0};
    if(old)Object.assign(old,cell);else{cells.set(key,cell);list.push(cell);}
    const kept=old??cell;
    if(ahead(kept,best))best=kept;
    if(s.phase>c.phase){advanced=kept;break;}
  }
  if(advanced){
    console.log('COOP_EXPLORE_PHASE '+JSON.stringify({iters:n,frame:advanced.frame,
      phase:advanced.phase,turn:advanced.turn,swaps:advanced.swaps,lives:advanced.lives}));
    if(advanced.phase>=GOAL_PHASE){goal=advanced;break;}
    writeTape(advanced,'phase'+advanced.phase);
    // The archive restarts from the completed phase.
    root={...advanced,chosen:0,base:baseKey(advanced)};root.key=keyOf(root,root.frame);
    cells=new Map([[root.key,root]]);list=[root];best=root;
  }
  if(Date.now()-tLog>=60000){tLog=Date.now();
    console.log('COOP_EXPLORE_PROGRESS '+JSON.stringify({s:Math.round((tLog-t0)/1000),iters:n,
      cells:list.length,cuts,fps:Math.round(frames/((tLog-t0)/1000)),best:{phase:best.phase,
        cp:best.cp,scroll:best.scroll,x:best.x,dmg:best.dmg,lives:best.lives,
        turn:best.turn,swaps:best.swaps,frame:best.frame}}));
    // The best route so far, so it can be watched while the search runs.
    if(best!==root){const at=best.frame,f=writeTape(best,'preview');
      if(lastPreview&&lastPreview!==f)rmSync(lastPreview,{force:true});lastPreview=f;
      board.lab.restore(best.snap);void at;}}
}
const file=writeTape(goal??best,goal?'goal':'best');
console.log((goal?'COOP_EXPLORE=GOAL ':'COOP_EXPLORE=NO_GOAL ')+JSON.stringify(
  {iters:n,minutes:+((Date.now()-t0)/60000).toFixed(1),tape:file}));
process.exitCode=goal?0:2;
