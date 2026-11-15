#!/usr/bin/env node
/** Private game-options gate (games/gngb/options.mjs) on the shipped program
 * bundle and board runtime, as the app's engine worker runs them. Needs the
 * ROM-derived bundle (AO_BUNDLE, default out/rp4/build/bundle); no window.
 *  1. DIP: each difficulty sets the starting enemy rank (RAM 0x57: easy 0,
 *     normal 6, hard 24, hardest 32); each lives setting moves the starting
 *     lives (RAM 0x50) by the same amount.
 *  2. Enemy pace: stage 1 zombies walk slower at 75 % and 50 %, while Arthur
 *     (RAM 0xA0-0xA3) is at the same place every frame in all three paces.
 *  3. Replay: a paced session with other DIPs, recorded like the app (port
 *     recorder, DIP bytes at cycle 0 of the tape), replays from its tape to
 *     the same CPU state.
 *  4. Robustness: the true-ending tape (out/h3/loop2/l2-ending-96340.json)
 *     runs to its last frame at 75 % and 50 % without a runtime error (the
 *     enemies no longer match the inputs, so it does not reach the ending).
 * Usage: node scripts/gng_options_check.mjs [--quick]   (--quick: 20000 frames in 4)
 * Writes out/gng-options/check.json.
 */
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {gngCode} from '../boards/gng/bundle.mjs';
import {createBoard} from '../boards/gng/runtime.mjs';
import {defineInputSchedule,readScheduledPort} from '../src/gngb_input_contract.mjs';
import {createPortRecorder,liveTapeReader} from '../src/v3_b3_live_tape.mjs';
import {gameOptions,optionDips,withEnemyPace} from '../games/gngb/options.mjs';

const ROOT=resolve(fileURLToPath(import.meta.url),'../..');
const BUNDLE=resolve(ROOT,process.env.AO_BUNDLE??'out/rp4/build/bundle');
const TAPE=join(ROOT,'out/h3/loop2/l2-ending-96340.json');
const quick=process.argv.includes('--quick');
const F=25152;
const press=(f,control,n)=>[{cycle:f*F,control,pressed:true},
  {cycle:(f+n)*F,control,pressed:false}];
// Coin and Start, then walk right into the first zombies and fire.
const WALK=[...press(560,'coin1',12),...press(640,'start1',12),
  ...press(1240,'p1.right',60),...press(1305,'p1.button1',4)].sort((a,b)=>a.cycle-b.cycle);

const manifest=JSON.parse(readFileSync(join(BUNDLE,'manifest.json'),'utf8'));
const code=gngCode(manifest,readFileSync(join(BUNDLE,'code.bin')),
  readFileSync(join(BUNDLE,'overlays.bin')));
const {blocks}=await import(pathToFileURL(join(BUNDLE,'program.mjs')).href);

function run(options,{frames,events,portRead,onPortRead,onFrame}){
  const o=gameOptions(options),schedule=events&&defineInputSchedule(events);
  const board=createBoard(code,withEnemyPace(blocks,o.enemyPace),{frames,
    dips:optionDips(o),onPortRead,
    portRead:portRead??((a,c)=>readScheduledPort(schedule,a,c)),
    onFrame:r=>{
      onFrame?.(r.index,r.record);
      board.state.records[r.index-1]=null;board.state.events.length=0;
    }});
  const {status}=board.run();
  return {status,board};
}
const report={schema:'gng.options-check.v1',bundle:manifest.files['program.mjs']};

// 1. DIP switches, read at frame 1000 (the game started at 640).
const at1000=(options,addr)=>{
  let v=null;
  const {status}=run(options,{frames:1000,events:WALK,
    onFrame:(n,ram)=>{if(n===1000)v=ram[addr];}});
  assert.equal(status,'FRAMES_DONE');
  return v;
};
const RANK={easy:0,normal:6,hard:24,hardest:32};
report.rank={};
for(const difficulty of Object.keys(RANK)){
  report.rank[difficulty]=at1000({difficulty},0x57);
  assert.equal(report.rank[difficulty],RANK[difficulty],'base rank '+difficulty);
}
report.lives={};
for(const lives of [3,4,5,7])report.lives[lives]=at1000({lives},0x50);
for(const lives of [4,5,7])
  assert.equal(report.lives[lives]-report.lives[3],lives-3,'lives '+lives);

// 2. Enemy pace: zombie (object type 0x0b) x speed over frames 1200-1300 and
// Arthur's position over the walk.
report.pace={};
const arthur={};
for(const enemyPace of [100,75,50]){
  const tracks=new Map(),pos=[];
  run({enemyPace},{frames:1300,events:WALK,onFrame:(n,ram)=>{
    if(n>=1240)pos.push(Array.from(ram.subarray(0xa0,0xa4)).join(','));
    if(n<1200)return;
    for(let k=0;k<40;k++){
      const s=0x880+k*0x30;
      if(!ram[s]||ram[s+0x15]!==0x0b)continue;
      const t=tracks.get(k)??[];t.push([n,ram[s+6]<<16|ram[s+7]<<8|ram[s+8]]);tracks.set(k,t);
    }
  }});
  const speeds=[...tracks.values()].filter(t=>t.length>=30).map(t=>{
    const a=t[0],z=t.at(-1);return Math.abs(z[1]-a[1])/256/(z[0]-a[0]);
  });
  assert.ok(speeds.length>0,'zombies tracked at '+enemyPace);
  report.pace[enemyPace]={zombies:speeds.length,
    pxPerFrame:+(speeds.reduce((x,y)=>x+y,0)/speeds.length).toFixed(3)};
  arthur[enemyPace]=pos;
}
const sp=p=>report.pace[p].pxPerFrame;
assert.ok(sp(100)>sp(75)&&sp(75)>sp(50),'zombies slower at each pace');
assert.ok(Math.abs(sp(75)/sp(100)-0.75)<0.12&&Math.abs(sp(50)/sp(100)-0.5)<0.12,
  'zombie speed close to the chosen pace');
assert.notEqual(arthur[100][0],arthur[100].at(-1),'Arthur walked');
assert.deepStrictEqual(arthur[75],arthur[100],'Arthur unchanged at 75 %');
assert.deepStrictEqual(arthur[50],arthur[100],'Arthur unchanged at 50 %');
report.arthurFrames=arthur[100].length;

// 3. Record a paced session like the app, then replay its tape.
{
  const options={lives:5,difficulty:'hard',enemyPace:50},dips=optionDips(options);
  const recorder=createPortRecorder(),frames=3000;
  const live=run(options,{frames,events:WALK,
    onPortRead:r=>recorder.observe(r.addr,r.cycle,r.value)});
  const tape=[[3,0,dips[0]],[4,0,dips[1]],...recorder.drain()];
  // The replay takes its DIP bytes from the tape, as a tape importer would.
  const tapeDips=[3,4].map(p=>tape.find(c=>c[0]===p)[2]);
  assert.deepStrictEqual(tapeDips,dips);
  const replay=run(options,{frames,portRead:liveTapeReader(tape)});
  assert.equal(live.status,'FRAMES_DONE');assert.equal(replay.status,'FRAMES_DONE');
  assert.deepStrictEqual(replay.board.exportState(),live.board.exportState(),
    'paced replay from its tape');
  report.replay={options,frames,tapeChanges:tape.length};
}

// 4. The long tape at each slower pace.
{
  const t=JSON.parse(readFileSync(TAPE,'utf8')),frames=quick?20000:t.frames;
  report.tape={frames};
  for(const enemyPace of [75,50]){
    let last=0;
    const t0=Date.now();
    const {status}=run({enemyPace},{frames,events:t.events,onFrame:n=>{last=n;}});
    assert.equal(status,'FRAMES_DONE');assert.equal(last,frames);
    report.tape[enemyPace]={seconds:+((Date.now()-t0)/1000).toFixed(1)};
  }
}

const out=join(ROOT,'out/gng-options');
mkdirSync(out,{recursive:true,mode:0o700});
writeFileSync(join(out,'check.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
console.log(JSON.stringify(report));
console.log('GNG_OPTIONS_CHECK PASS');
