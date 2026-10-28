#!/usr/bin/env node
/** H3-S1 TAS probe: Go-Explore from reset to the phase-1 cyclops arena.
 * Base tape titleCoinStart, then only P1 port masks from frame 1200; no
 * pokes and no RAM or state writes (save/restore only between branches).
 * A branch is cut on an impact without armour, a death handler or a lost
 * life (maneuverFatal); an impact with armour simply yields another cell.
 * Usage:
 *   node scripts/h3_explore.mjs explore [seed=1] [iters=Infinity] [minutes=30]
 *   node scripts/h3_explore.mjs replay <tape.json> [every=0]
 * explore writes out/h3/explore/cells-s<seed>-i<iters>.json (no snapshots)
 * and the best tape (inputs only, sha256, seed and parameters); exit 0 on GO.
 * replay runs a fresh board from reset without restore, prints label rows
 * every `every` frames, and checks the tape's RAM hash and signal if present.
 */
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {basename,dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {loadFrozen} from '../src/v2_b1_frozen.mjs';
import {selectB3Bundle} from '../src/v3_b3_bundle.mjs';
import {CYCLES_PER_FRAME as CPF} from '../src/gngb_runtime.mjs';
import {defineInputSchedule,readScheduledPort} from '../src/gngb_input_contract.mjs';
import {B3_TAPE_SCHEMA,b3Tape} from '../src/v3_b3_tapes.mjs';
import {labCreateBoard} from '../src/v3_b3_lab_board.mjs';
import {resolveB3LabTape} from '../src/v3_b3_external_tape.mjs';
import {EXPLORE_DEFAULTS as P,prng,chunkMasks,masksToEvents,look,isFatal,cellKey,better,
  pickCell,sha256,cellsListing} from '../src/h3_explore.mjs';

const ROOT=resolve(fileURLToPath(import.meta.url),'../..');
const selected=selectB3Bundle(ROOT);
if(!selected)throw Error('V3_B3_NO_CERTIFIED_BUNDLE');
const GEN=basename(dirname(selected.dir));
const {manifest,code}=loadFrozen(selected.dir);
const {blocks}=await import(pathToFileURL(join(selected.dir,'program.mjs')).href);
const START=1200,ARENA=3072,MAX_FRAMES=60000;
const OUT=join(ROOT,'out/h3/explore');

async function makeBoard(portRead,perFrame){
  const board=await labCreateBoard(join(selected.dir,'gngb_runtime.mjs'),
    manifest.files['gngb_runtime.mjs'],code,blocks,{frames:1,portRead,
      onFrame:r=>{const i=board.state.records.length;board.state.records[i-1]=null;perFrame(i,r.record);}});
  return board;
}
const ram=(board,n=0x600)=>board.state.ramBytes(0,n).bytes;
const fail=m=>{console.log(m);process.exit(3);};

async function explore(seed,iters,minutes){
  const rand=prng(seed),base=defineInputSchedule(b3Tape('titleCoinStart').events);
  const cur=new Uint8Array(MAX_FRAMES);
  let fatalAt=0,livesRef=null;
  const board=await makeBoard((addr,cycle)=>addr===0x3001&&cycle>=START*CPF?
    0xff^cur[Math.floor(cycle/CPF)-START]:readScheduledPort(base,addr,cycle),
  (i,rec)=>{if(livesRef!==null&&!fatalAt&&isFatal(look(rec),livesRef))fatalAt=i;});
  if(board.lab.advanceTo(START).status!=='FRAMES_DONE')fail('H3_EXPLORE_START_FAILED');
  const s0=look(ram(board));
  console.log('H3_EXPLORE_START gen='+GEN+' seed='+seed+' '+JSON.stringify(s0));
  const root={...s0,key:cellKey(s0),frame:START,masks:new Uint8Array(0),snap:board.lab.save(),chosen:0};
  const cells=new Map([[root.key,root]]),list=[root];
  const rank=c=>[c.phase===0?c.scroll:-1,c.x,-c.frame];
  const ahead=(a,b)=>{const x=rank(a),y=rank(b);for(let i=0;i<3;i++)if(x[i]!==y[i])return x[i]>y[i];return false;};
  let best=root,goal=null,halt=null,n=0,cuts=0,frames=0;
  const t0=Date.now();let tLog=t0;
  while(n<iters&&Date.now()-t0<minutes*60000&&!goal&&!halt){
    const c=pickCell(list,rand,P.scrollBonus);c.chosen++;n++;
    board.lab.restore(c.snap);fatalAt=0;livesRef=c.lives;
    const len=c.masks.length;
    cur.set(c.masks);cur.set(chunkMasks(rand,P.chunk,len?c.masks[len-1]:0,P),len);cur.fill(0,len+P.chunk);
    for(let k=P.evalEvery;k<=P.chunk;k+=P.evalEvery){
      const f=c.frame+k,res=board.lab.advanceTo(f);frames+=P.evalEvery;
      if(res.status!=='FRAMES_DONE'){halt={frame:f,...res};break;}
      if(fatalAt){cuts++;break;}
      const s=look(ram(board)),cand={...s,key:cellKey(s),frame:f},old=cells.get(cand.key);
      if(better(cand,old)){
        const cell={...cand,masks:cur.slice(0,f-START),snap:board.lab.save(),chosen:old?.chosen??0};
        if(old)Object.assign(old,cell);else{cells.set(cell.key,cell);list.push(cell);}
        const kept=old??cell;
        if(ahead(kept,best))best=kept;
        if(s.phase===0&&s.scroll>=ARENA){goal=kept;break;}
      }
    }
    if(Date.now()-tLog>=30000){tLog=Date.now();
      console.log('H3_EXPLORE_PROGRESS s='+Math.round((tLog-t0)/1000)+' iters='+n+' cells='+list.length+
        ' fps='+Math.round(frames/((tLog-t0)/1000))+' best='+JSON.stringify({x:best.x,scroll:best.scroll,frame:best.frame,armor:best.armor}));}
  }
  const seconds=(Date.now()-t0)/1000;
  mkdirSync(OUT,{recursive:true,mode:0o700});
  const params={...P,start:START,arena:ARENA};
  const cellsText=JSON.stringify({seed,params,iters:n,cells:cellsListing(list)})+'\n';
  const cellsFile=join(OUT,'cells-s'+seed+'-i'+n+'.json');
  writeFileSync(cellsFile,cellsText,{mode:0o600});
  const win=goal??best;
  board.lab.restore(win.snap);
  const signal={phase:win.phase,cp:win.cp,x:win.x,y:win.y,scroll:win.scroll,lives:win.lives,armor:win.armor};
  const metadata={schema:B3_TAPE_SCHEMA,profile:'explorer-g4',frames:win.frame+60,
    events:defineInputSchedule([...b3Tape('titleCoinStart').events,...masksToEvents(START,win.masks)]).events};
  const tapeSha=sha256(JSON.stringify(metadata));
  const tapeFile=join(OUT,'tape-s'+seed+'-'+win.frame+(goal?'-arena':'-best')+'.json');
  writeFileSync(tapeFile,JSON.stringify({...metadata,sha256:tapeSha,h3:{probe:'h3-s1',bundle:GEN,seed,params,
    iters:n,goalFrame:win.frame,signal,livesStart:s0.lives,ramSha:sha256(ram(board,0x3000))}})+'\n',{mode:0o600});
  const result=halt?'STOP_HALT':goal?'GO_ARENA':'NOT_REACHED';
  console.log('H3_EXPLORE_RESULT '+result+' iters='+n+' cells='+list.length+' cuts='+cuts+' frames='+frames+
    ' seconds='+seconds.toFixed(1)+' maxX='+Math.max(...list.map(c=>c.x))+' maxScroll='+Math.max(...list.map(c=>c.scroll))+
    ' win='+JSON.stringify({frame:win.frame,...signal})+(halt?' halt='+JSON.stringify(halt):''));
  console.log('H3_EXPLORE_CELLS='+cellsFile+' sha256='+sha256(cellsText));
  console.log('H3_EXPLORE_TAPE='+tapeFile+' sha256='+tapeSha);
  process.exitCode=goal?0:2;
}

async function replay(path,every){
  const tape=resolveB3LabTape(path),meta=JSON.parse(readFileSync(path,'utf8')).h3??null;
  const end=meta?.goalFrame??tape.frames;
  let lives0=null,firstFatal=null,maxX=0,maxScroll=0,minLives=99;
  const board=await makeBoard(tape.read,(i,rec)=>{
    const s=look(rec);
    if(i===START)lives0=s.lives;
    if(i>=START){maxX=Math.max(maxX,s.x);maxScroll=Math.max(maxScroll,s.scroll);minLives=Math.min(minLives,s.lives);
      if(i>START&&firstFatal===null&&isFatal(s,lives0))firstFatal={frame:i,...s};}
    if(every&&i%every===0)console.log('H3_REPLAY_ROW '+i+' '+JSON.stringify(s));
  });
  const res=board.lab.advanceTo(end);
  if(res.status!=='FRAMES_DONE')fail('H3_REPLAY_HALT '+JSON.stringify(res));
  const s=look(ram(board)),ramSha=sha256(ram(board,0x3000));
  const signal={phase:s.phase,cp:s.cp,x:s.x,y:s.y,scroll:s.scroll,lives:s.lives,armor:s.armor};
  const match=meta?ramSha===meta.ramSha&&JSON.stringify(signal)===JSON.stringify(meta.signal):null;
  console.log('H3_REPLAY_RESULT '+(match===null?'NO_REFERENCE':match?'MATCH':'MISMATCH')+' gen='+GEN+' frame='+end+
    ' tape='+tape.sha256+' ram='+ramSha+' signal='+JSON.stringify(signal)+' maxX='+maxX+' maxScroll='+maxScroll+
    ' lives0='+lives0+' minLives='+minLives+' firstFatal='+JSON.stringify(firstFatal));
  process.exitCode=match===false?1:0;
}

const [cmd,a,b,c]=process.argv.slice(2);
if(cmd==='explore')await explore(Number(a??1),Number(b??Infinity),Number(c??30));
else if(cmd==='replay')await replay(a,Number(b??0));
else fail('usage: h3_explore.mjs explore [seed] [iters] [minutes] | replay <tape> [every]');
