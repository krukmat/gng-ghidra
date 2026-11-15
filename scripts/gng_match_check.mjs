#!/usr/bin/env node
/** Private two-player gate on the shipped program bundle and board runtime:
 * a scripted game (two coins, Start 2, walk right and fire until both players
 * are out) through games/gngb/state.mjs and src/ao_match.mjs must report the
 * start with P1, alternating turns and, back at the title, the result with
 * both final scores; a one-player game reports nothing. Needs the
 * ROM-derived bundle (AO_BUNDLE, default out/rp4/build/bundle); no window.
 * Usage: node scripts/gng_match_check.mjs   (writes out/gng-match/check.json)
 */
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {gngCode} from '../boards/gng/bundle.mjs';
import {createBoard} from '../boards/gng/runtime.mjs';
import {defineInputSchedule,readScheduledPort} from '../src/gngb_input_contract.mjs';
import {observeGameState} from '../games/gngb/state.mjs';
import {createMatchTracker} from '../src/ao_match.mjs';

const ROOT=resolve(fileURLToPath(import.meta.url),'../..');
const BUNDLE=resolve(ROOT,process.env.AO_BUNDLE??'out/rp4/build/bundle');
const F=25152,FRAMES=13000;
const press=(f,control,n)=>[{cycle:f*F,control,pressed:true},
  {cycle:(f+n)*F,control,pressed:false}];
const manifest=JSON.parse(readFileSync(join(BUNDLE,'manifest.json'),'utf8'));
const code=gngCode(manifest,readFileSync(join(BUNDLE,'code.bin')),
  readFileSync(join(BUNDLE,'overlays.bin')));
const {blocks}=await import(pathToFileURL(join(BUNDLE,'program.mjs')).href);

function play(two){
  const events=[...press(560,'coin1',12),...(two?press(600,'coin1',12):[]),
    ...press(680,two?'start2':'start1',12)];
  for(let f=1240;f<FRAMES;f+=90)events.push(...press(f,'p1.right',30));
  for(let f=1300;f<FRAMES;f+=16)events.push(...press(f,'p1.button1',4));
  events.sort((a,b)=>a.cycle-b.cycle);
  const schedule=defineInputSchedule(events),match=createMatchTracker(),log=[];
  let key=null,last=null;
  const board=createBoard(code,blocks,{frames:FRAMES,
    portRead:(a,c)=>readScheduledPort(schedule,a,c),
    onFrame:r=>{
      // As the engine worker does: only changed states reach the app.
      const state=observeGameState(r),k=JSON.stringify(state);
      if(state&&k!==key){
        key=k;last=state;
        for(const e of match.update(state))log.push({frame:r.index,...e});
      }
      board.state.records[r.index-1]=null;board.state.events.length=0;
    }});
  assert.equal(board.run().status,'FRAMES_DONE');
  return {log,last};
}

const two=play(true),one=play(false);
const types=two.log.map(e=>e.type);
assert.equal(types[0],'start');assert.equal(two.log[0].player,1);
assert.equal(types.at(-1),'result','the game ends at the title');
assert.equal(types.filter(t=>t==='result').length,1);
const turns=two.log.filter(e=>e.type==='turn').map(e=>e.player);
assert.ok(turns.length>=2,'turns alternate');
turns.forEach((p,i)=>assert.equal(p,i%2===0?2:1,'turn '+i));
const result=two.log.at(-1);
assert.ok(result.scores.every(n=>Number.isInteger(n)&&n>0),'both players scored');
assert.equal(result.winner,result.scores[0]>result.scores[1]?1:
  result.scores[1]>result.scores[0]?2:0);
assert.deepEqual(one.log,[],'one player: no match events');
const report={schema:'gng.match-check.v1',bundle:manifest.files['program.mjs'],
  frames:FRAMES,events:two.log};
const out=join(ROOT,'out/gng-match');
mkdirSync(out,{recursive:true,mode:0o700});
writeFileSync(join(out,'check.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
console.log(JSON.stringify(report));
console.log('GNG_MATCH_CHECK PASS');
