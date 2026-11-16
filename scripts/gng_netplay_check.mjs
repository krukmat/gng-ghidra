#!/usr/bin/env node
/** Private netplay gate (src/netplay_turns.mjs) on the shipped program bundle
 * and board runtime: two boards, host (P1) and guest (P2), each with its own
 * scripted controls, joined by a simulated link with jitter and an outage.
 * The host inserts two coins and presses Start 2; each peer's controls only
 * count in its own turns. PASS = both boards end in the same state, equal to
 * a third board replaying the session's tape from reset; the turn passes at
 * the same frames on both; the game ends at the title with a result where
 * the guest's play scored; no desync. Needs the ROM-derived bundle
 * (AO_BUNDLE, default out/rp4/build/bundle); no window.
 * Usage: node scripts/gng_netplay_check.mjs [--coop]   (writes out/gng-netplay/check.json;
 * --coop plays the cooperative game of games/gngb/options.mjs)
 */
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {gngCode} from '../boards/gng/bundle.mjs';
import {createBoard} from '../boards/gng/runtime.mjs';
import {defineInputSchedule,readScheduledPort,INPUT_DEFAULTS}
  from '../src/gngb_input_contract.mjs';
import {createPortRecorder,liveTapeReader} from '../src/v3_b3_live_tape.mjs';
import {createTurnSession} from '../src/netplay_turns.mjs';
import {createGngTurnRule} from '../games/gngb/netplay.mjs';
import {observeGameState} from '../games/gngb/state.mjs';
import {createMatchTracker} from '../src/ao_match.mjs';
import {gameOptions,optionDips,withGameOptions} from '../games/gngb/options.mjs';

const ROOT=resolve(fileURLToPath(import.meta.url),'../..');
const BUNDLE=resolve(ROOT,process.env.AO_BUNDLE??'out/rp4/build/bundle');
const F=25152,FRAMES=14000,OUTAGE=[4000,4300];
const OPTIONS=gameOptions({difficulty:'hard',enemyPace:75,continues:false,
  coop:process.argv.includes('--coop')});
const press=(f,control,n)=>[{cycle:f*F,control,pressed:true},
  {cycle:(f+n)*F,control,pressed:false}];
const manifest=JSON.parse(readFileSync(join(BUNDLE,'manifest.json'),'utf8'));
const code=gngCode(manifest,readFileSync(join(BUNDLE,'code.bin')),
  readFileSync(join(BUNDLE,'overlays.bin')));
const {blocks:plain}=await import(pathToFileURL(join(BUNDLE,'program.mjs')).href);
const blocks=withGameOptions(plain,OPTIONS);

// Host: two coins, Start 2, then P1 walks and fires. Guest: P2 walks,
// jumps and fires on another rhythm.
function schedule(role){
  const e=role==='host'?[...press(560,'coin1',12),...press(600,'coin1',12),
    ...press(680,'start2',12)]:[];
  for(let f=1240;f<FRAMES;f+=role==='host'?90:70)e.push(...press(f,'p1.right',30));
  for(let f=1300;f<FRAMES;f+=role==='host'?16:12)e.push(...press(f,'p1.button1',4));
  if(role==='guest')for(let f=1500;f<FRAMES;f+=200)e.push(...press(f,'p1.button2',6));
  return defineInputSchedule(e.sort((a,b)=>a.cycle-b.cycle));
}
// Ordered link with seeded jitter; while down, sent messages are lost.
function network(){
  let r=11,up=true;const queue={host:[],guest:[]},clock={t:0};
  const jitter=()=>2+((r=(r*1103515245+12345)&0x7fffffff)%7);
  return {clock,set up(v){up=v;},
    send(from,m){
      if(!up)return;
      const q=queue[from==='host'?'guest':'host'];
      q.push({at:Math.max(q.at(-1)?.at??0,clock.t+jitter()),m:JSON.parse(JSON.stringify(m))});
    },
    deliver(peers){
      for(const to of ['host','guest'])
        while(queue[to].length&&queue[to][0].at<=clock.t)peers[to].session.receive(queue[to].shift().m);
    }};
}
function peer(role,net){
  const input=schedule(role),recorder=createPortRecorder(),tape=[],events=[];
  const session=createTurnSession({role,ownerAfter:createGngTurnRule(),
    defaults:INPUT_DEFAULTS.slice(0,3),send:m=>net.send(role,m),onEvent:e=>events.push(e)});
  let last=null,frame=0,waits=0;
  const board=createBoard(code,blocks,{frames:Number.MAX_SAFE_INTEGER,dips:optionDips(OPTIONS),
    portRead:(a,c)=>session.owns()?readScheduledPort(input,a,c):session.read(a-0x3000,c),
    onPortRead:x=>recorder.observe(x.addr,x.cycle,x.value),
    onFrame:x=>{last=x;board.state.records[x.index-1]=null;board.state.events.length=0;}});
  const states=[];
  return {session,events,tape,board,states,get frame(){return frame;},get waits(){return waits;},
    step(){
      if(!session.canRun(frame+1)){waits++;return false;}
      assert.equal(board.run(frame+1).status,'FRAMES_DONE');
      frame++;
      const changes=recorder.drain();tape.push(...changes);
      session.frameEnd(frame,last.record,changes);
      if(role==='host')states.push(observeGameState(last));
      return true;
    }};
}

const net=network(),peers={host:peer('host',net),guest:peer('guest',net)};
let maxLead=0;
for(let t=0;peers.host.frame<FRAMES||peers.guest.frame<FRAMES;t++){
  assert.ok(t<FRAMES*4,'the session keeps moving');
  net.clock.t=t;
  if(t===OUTAGE[0])net.up=false;
  if(t===OUTAGE[1]){net.up=true;peers.host.session.resend();peers.guest.session.resend();}
  // The owner plays in real time; the follower catches up a few frames.
  for(const p of Object.values(peers))
    for(let k=0;k<(p.session.owns()?1:4)&&p.frame<FRAMES;k++)if(!p.step())break;
  net.deliver(peers);
  for(const p of Object.values(peers))assert.equal(p.session.ended,null,JSON.stringify(p.session.ended));
  maxLead=Math.max(maxLead,Math.abs(peers.host.frame-peers.guest.frame));
}

const {host,guest}=peers;
const turns=p=>p.events.filter(e=>e.type==='owner').map(e=>e.owner+'@'+e.frame);
assert.deepEqual(turns(guest),turns(host),'turns at the same frames');
assert.ok(turns(host).length>=4,'several turns each');
assert.deepEqual(guest.tape,host.tape,'same session tape');
const state=host.board.exportState();
assert.deepStrictEqual(guest.board.exportState(),state,'guest equals host');
// The session is an ordinary tape: one board from reset reaches it too.
const replay=createBoard(code,blocks,{frames:FRAMES,dips:optionDips(OPTIONS),
  portRead:liveTapeReader(host.tape),
  onFrame:x=>{replay.state.records[x.index-1]=null;replay.state.events.length=0;}});
assert.equal(replay.run().status,'FRAMES_DONE');
assert.deepStrictEqual(replay.exportState(),state,'tape replay equals the session');
const match=createMatchTracker(),results=[];
let prev=null;
for(const s of host.states){
  const k=JSON.stringify(s);if(k===prev)continue;prev=k;
  for(const e of match.update(s))results.push(e);
}
const result=results.find(e=>e.type==='result');
assert.ok(result,'the game ended at the title');
assert.ok(result.scores[1]>0,'the guest scored in its turns');
const report={schema:'gng.netplay-check.v1',bundle:manifest.files['program.mjs'],
  options:OPTIONS,frames:FRAMES,outage:OUTAGE,turns:turns(host),result,
  tapeChanges:host.tape.length,maxLead,waits:{host:host.waits,guest:guest.waits},
  stats:{host:host.session.stats(),guest:guest.session.stats()}};
const out=join(ROOT,'out/gng-netplay');
mkdirSync(out,{recursive:true,mode:0o700});
writeFileSync(join(out,'check.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
console.log(JSON.stringify(report));
console.log('GNG_NETPLAY_CHECK PASS');
