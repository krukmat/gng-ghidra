#!/usr/bin/env node
/** Private cooperative two-player gate (games/gngb/options.mjs, `coop`) on
 * the shipped program bundle and board runtime, as the app's engine worker
 * runs them. Needs the ROM-derived bundle (AO_BUNDLE, default
 * out/rp4/build/bundle) and the true-ending tape; no window.
 * A two-player game where P1 follows the tape past the first checkpoint of
 * stage 1 and then both players only walk right until their lives run out,
 * played twice (cooperative and by turns, identical until the first turn
 * change):
 *  1. First turn change, cooperative: P2 enters with P1's game (every shared
 *     byte of the player block, checkpoint reached) and its own lives, extra
 *     lives and score; P1's block waits untouched. By turns, P2 enters with
 *     its own game from the start of the stage. Arthur's x when that turn
 *     ends shows it: past the checkpoint, or still near the start.
 *  2. Every later turn change keeps stage and checkpoint with the team; the
 *     turns alternate and the match ends at the title with both scores.
 *  3. Replay: the cooperative session, recorded like the app, replays from
 *     its tape to the same CPU state.
 * Usage: node scripts/gng_coop_check.mjs   (writes out/gng-coop/check.json)
 */
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {gngCode} from '../boards/gng/bundle.mjs';
import {createBoard} from '../boards/gng/runtime.mjs';
import {defineInputSchedule,readScheduledPort} from '../src/gngb_input_contract.mjs';
import {createPortRecorder,liveTapeReader} from '../src/v3_b3_live_tape.mjs';
import {observeGameState,RAM} from '../games/gngb/state.mjs';
import {createMatchTracker} from '../src/ao_match.mjs';
import {gameOptions,optionDips,withGameOptions,SHARED_PROGRESS}
  from '../games/gngb/options.mjs';

const ROOT=resolve(fileURLToPath(import.meta.url),'../..');
const BUNDLE=resolve(ROOT,process.env.AO_BUNDLE??'out/rp4/build/bundle');
const TAPE=join(ROOT,'out/h3/loop2/l2-ending-96340.json');
const F=25152,CUT=3600,FRAMES=30000;
const PLAYER=0x60,WAITING=0x440,BYTES=0x30,STAGE=0x12,CHECKPOINT=0x21;
const PERSONAL=Array.from({length:BYTES},(_,i)=>i).filter(i=>!SHARED_PROGRESS.includes(i));
const press=(f,control,n)=>[{cycle:f*F,control,pressed:true},
  {cycle:(f+n)*F,control,pressed:false}];

const manifest=JSON.parse(readFileSync(join(BUNDLE,'manifest.json'),'utf8'));
const code=gngCode(manifest,readFileSync(join(BUNDLE,'code.bin')),
  readFileSync(join(BUNDLE,'overlays.bin')));
const {blocks}=await import(pathToFileURL(join(BUNDLE,'program.mjs')).href);

// The tape's own coin, a second one, Start 2 where the tape pressed Start 1,
// P1's inputs up to CUT (all released there), then walking right.
function matchEvents(){
  const tape=JSON.parse(readFileSync(TAPE,'utf8')).events,held=new Set(),events=[];
  for(const e of tape){
    if(e.cycle>=CUT*F)break;
    events.push(e.control==='start1'?{...e,control:'start2'}:e);
    if(e.pressed)held.add(e.control);else held.delete(e.control);
  }
  for(const control of held)events.push({cycle:CUT*F,control,pressed:false});
  events.push(...press(600,'coin1',12));
  for(let f=CUT+30;f<FRAMES;f+=90)events.push(...press(f,'p1.right',60));
  return events.sort((a,b)=>a.cycle-b.cycle);
}
const EVENTS=matchEvents();

function play(options,{portRead,onPortRead}={}){
  const o=gameOptions({...options,continues:false}),schedule=defineInputSchedule(EVENTS);
  const match=createMatchTracker(),log=[],swaps=[];
  let key=null,turn=0,cut=null,p2x=null;
  const board=createBoard(code,withGameOptions(blocks,o),{frames:FRAMES,
    dips:optionDips(o),onPortRead,
    portRead:portRead??((a,c)=>readScheduledPort(schedule,a,c)),
    onFrame:r=>{
      const b=r.record,state=observeGameState(r),k=JSON.stringify(state);
      if(state&&k!==key){
        key=k;
        for(const e of match.update(state))log.push({frame:r.index,...e});
      }
      if(r.index===CUT)cut={mode:b[RAM.mode],turn:b[RAM.turn],
        twoPlayers:b[RAM.twoPlayers],checkpoint:b[PLAYER+CHECKPOINT]};
      if(r.index>CUT&&b[RAM.mode]>=2&&b[RAM.turn]!==turn){
        turn=b[RAM.turn];
        swaps.push({frame:r.index,turn,player:Array.from(b.subarray(PLAYER,PLAYER+BYTES)),
          waiting:Array.from(b.subarray(WAITING,WAITING+BYTES))});
      }
      if(swaps.length===1)p2x=b[RAM.world]<<8|b[RAM.world+1];
      board.state.records[r.index-1]=null;board.state.events.length=0;
    }});
  const {status}=board.run();
  assert.equal(status,'FRAMES_DONE');
  return {board,log,swaps,cut,p2x};
}

const recorder=createPortRecorder();
const coop=play({coop:true},{onPortRead:r=>recorder.observe(r.addr,r.cycle,r.value)});
const turns=play({});
for(const run of [coop,turns])
  assert.deepEqual(run.cut,{mode:2,turn:0,twoPlayers:1,checkpoint:1},
    'P1 is past the first checkpoint when the tape is cut');

// 1. The first turn change.
const [c,t]=[coop.swaps[0],turns.swaps[0]];
assert.ok(c&&t,'the turn passes to P2');
assert.equal(c.frame,t.frame,'both games are the same until the first turn change');
assert.equal(c.turn,1);
assert.deepEqual(c.waiting,t.waiting,'P1 waits with its own game in both');
for(const i of SHARED_PROGRESS)
  assert.equal(c.player[i],c.waiting[i],'P2 enters with P1\'s game, +0x'+i.toString(16));
for(const i of PERSONAL)
  assert.equal(c.player[i],t.player[i],'P2 keeps its own +0x'+i.toString(16));
assert.equal(c.player[CHECKPOINT],1);assert.equal(t.player[CHECKPOINT],0);
assert.ok(c.waiting[0x0a]|c.waiting[0x09],'P1 scored on the way');
assert.deepEqual(c.player.slice(8,12),[0,0,0,0],'P2 starts with no score');
assert.ok(coop.p2x>0x700,'cooperative P2 plays from the checkpoint');
assert.ok(turns.p2x<0x200,'by turns P2 plays from the start of the stage');

// 2. Later turn changes, and the end of the match.
for(const run of [coop,turns]){
  assert.ok(run.swaps.length>=3,'turns keep passing');
  run.swaps.forEach((s,i)=>assert.equal(s.turn,i%2===0?1:0,'turn '+i));
  const types=run.log.map(e=>e.type);
  assert.equal(types[0],'start');assert.equal(types.at(-1),'result');
  assert.equal(types.filter(x=>x==='result').length,1);
}
for(const s of coop.swaps)for(const i of [STAGE,CHECKPOINT])
  assert.equal(s.player[i],s.waiting[i],'the team keeps +0x'+i.toString(16)+' at '+s.frame);

// 3. The cooperative session replays from its tape.
{
  const dips=optionDips(gameOptions({coop:true}));
  const tape=[[3,0,dips[0]],[4,0,dips[1]],...recorder.drain()];
  const replay=play({coop:true},{portRead:liveTapeReader(tape)});
  assert.deepStrictEqual(replay.board.exportState(),coop.board.exportState(),
    'cooperative replay from its tape');
}

const brief=run=>({swaps:run.swaps.map(s=>({frame:s.frame,player:s.turn+1,
  lives:s.player[0],stage:s.player[STAGE],checkpoint:s.player[CHECKPOINT]})),
  p2FirstTurnEndX:run.p2x,result:run.log.at(-1)});
const report={schema:'gng.coop-check.v1',bundle:manifest.files['program.mjs'],
  frames:FRAMES,cut:CUT,coop:brief(coop),turns:brief(turns)};
const out=join(ROOT,'out/gng-coop');
mkdirSync(out,{recursive:true,mode:0o700});
writeFileSync(join(out,'check.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
console.log(JSON.stringify(report));
console.log('GNG_COOP_CHECK PASS');
