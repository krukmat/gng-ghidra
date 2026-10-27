import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildPracticePlayback,playbackDue}
  from '../../bot/live/practice-playback.mjs';
const C=100;
const events=[
  {cycle:0,control:'coin1',pressed:true},
  {cycle:2*C,control:'coin1',pressed:false},
  {cycle:5*C,control:'start1',pressed:true},
  {cycle:8*C,control:'start1',pressed:false},
  {cycle:2690*C,control:'p1.right',pressed:true},
  {cycle:2710*C,control:'p1.right',pressed:false},
  {cycle:2720*C,control:'p1.button2',pressed:true},
];
test('practice playback uses only pre-handoff validated transitions',()=>{
  const plan=buildPracticePlayback(events,C,2720);
  assert.equal(plan.length,6);
  assert.ok(plan.every(e=>e.frame<2720));
  assert.equal(plan.at(-1).frame,2710);
});
test('events become due at the same live scheduling margin as B3',()=>{
  const plan=buildPracticePlayback(events,C,2720);
  const first=playbackDue(plan,0,0,2720);
  assert.equal(first.status,'PLAYING');
  assert.equal(first.due[0].control,'coin1');
  const next=playbackDue(plan,first.index,1,2720);
  assert.equal(next.due[0].control,'coin1');
  assert.equal(next.due[0].pressed,false);
  assert.equal(playbackDue(plan,6,2720,2720).status,'HANDOFF');
});
test('excessively late scheduled inputs fail closed',()=>{
  const plan=buildPracticePlayback(events,C,2720);
  const r=playbackDue(plan,0,20,2720,{maxLagFrames:5});
  assert.equal(r.status,'LAG_STOP');
  assert.equal(r.due.length,0);
});
test('release first on equal-cycle direction changes',()=>{
  const e=[...events.slice(0,4),
    {cycle:2000*C,control:'p1.left',pressed:false},
    {cycle:2000*C,control:'p1.right',pressed:true}];
  const plan=buildPracticePlayback(e,C,2720);
  assert.equal(plan.at(-2).pressed,false);
  assert.equal(plan.at(-1).pressed,true);
});
test('invalid tape and target are rejected',()=>{
  assert.throws(()=>buildPracticePlayback([],C,2720),/NO_START/);
  assert.throws(()=>buildPracticePlayback(
    [{cycle:3,control:'start1',pressed:true}],C,2720),/TAPE_INVALID/);
  assert.throws(()=>buildPracticePlayback(events,C,1200-1),/CONFIG/);
  assert.throws(()=>playbackDue([],0,-1,2720),/BOT_PRACTICE_TICK/);
});
