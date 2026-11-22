import {test} from 'node:test';
import assert from 'node:assert/strict';
import {observeGameState} from '../src/ao_game_state.mjs';
import {canAutosave,canResumeCheckpoint,lostLife,lifeTransitionEnded} from '../games/gngb/state.mjs';
import {REC} from '../src/gngb_render_inputs.mjs';

function frame(mode,phase=1,credits=0){
  const record=new Uint8Array(REC.size),known=new Uint8Array(REC.size).fill(255);
  record[2]=mode;record[5]=phase;record[0x22]=credits>>>8;record[0x23]=credits&255;
  return {record,known};
}
function gameOver(f,at=12*32+6){
  f.record.set(new TextEncoder().encode('GAME OVER'),REC.fg+at);
  return at;
}
test('Start waits for the title and credit while active play hides system controls',()=>{
  assert.equal(observeGameState(frame(0,1,1)).readyToStart,false);
  assert.equal(observeGameState(frame(1)).readyToStart,false);
  assert.equal(observeGameState(frame(1,1,1)).readyToStart,true);
  const playing=observeGameState(frame(2,1,1));
  assert.equal(playing.inGame,true);assert.equal(playing.readyToStart,false);
});
test('GAME OVER returns controls before the main mode leaves gameplay',()=>{
  const f=frame(2);gameOver(f);
  const state=observeGameState(f);
  assert.equal(state.inGame,false);assert.equal(state.gameOver,true);
  assert.equal(state.readyToStart,false);
  for(const phase of [2,3,4])assert.equal(observeGameState(frame(2,phase)).inGame,false);
});
test('CONTINUE accepts a credited start and the next round hides the controls again',()=>{
  const waiting=observeGameState(frame(2,4));
  assert.equal(waiting.canContinue,true);assert.equal(waiting.readyToStart,false);
  const credited=observeGameState(frame(2,4,1));
  assert.equal(credited.inGame,false);assert.equal(credited.readyToStart,true);
  const next=observeGameState(frame(2,1));
  assert.equal(next.inGame,true);assert.equal(next.canContinue,false);
  assert.equal(next.readyToStart,false);
});
test('unknown RAM, unknown characters and other font banks cannot claim Game Over',()=>{
  const f=frame(2);const at=gameOver(f);
  f.known[REC.fg+at]=0;assert.equal(observeGameState(f).inGame,true);
  f.known[REC.fg+at]=255;f.record[REC.fg+0x400+at]=0x40;
  assert.equal(observeGameState(f).inGame,true);
  const wrapped=frame(2);gameOver(wrapped,31);
  assert.equal(observeGameState(wrapped).inGame,true);
  f.known[5]=0;assert.equal(observeGameState(f),null);
});

test('players, turn and scores: the waiting player keeps a copy at 0x440',()=>{
  const f=frame(2,1,0);
  f.record[0x26]=1;f.record[0x27]=1;          // two players, P2's turn
  f.record.set([0x00,0x00,0x14,0x00],0x68);   // P2 (current): 1400
  f.record.set([0x00,0x00,0x46,0x00],0x448);  // P1 (waiting): 4600
  assert.deepEqual(observeGameState(f),{mode:2,credits:0,canContinue:false,gameOver:false,
    inGame:true,readyToStart:false,hurt:false,players:2,player:2,lives:[0,0],scores:[4600,1400]});
  f.record[0x26]=0;f.record[0x27]=0;
  assert.deepEqual(observeGameState(f).scores,[1400]);
  f.record[0x6b]=0x0a;assert.deepEqual(observeGameState(f).scores,[null],'not BCD');
  f.known[0x27]=0;assert.equal(observeGameState(f).players,undefined);
});

test('hits cannot be autosaved; armour loss alone does not trigger recovery',()=>{
  const f=frame(2);f.record[0x60]=3;
  const healthy=observeGameState(f);
  assert.equal(canAutosave(f),true);
  f.record[0x503]=3; // armoured collision
  assert.equal(observeGameState(f).hurt,true);
  assert.equal(canAutosave(f),false);
  assert.equal(lostLife(healthy,observeGameState(f)),null);
  f.record[0xac]=1;f.record[0x503]=0; // armour removed, still alive
  const unarmoured=observeGameState(f);
  assert.equal(canAutosave(f),true);
  assert.equal(lostLife(healthy,unarmoured),null);
  f.record[0x503]=3; // second hit, before the life counter or turn changes
  const fatal=observeGameState(f);
  assert.equal(lostLife(unarmoured,fatal),null,'an animation does not establish a lost life');
  f.record[0x60]=2;
  assert.equal(lostLife(unarmoured,observeGameState(f)),1);
  assert.equal(canAutosave(f),false);
  assert.equal(lostLife(fatal,fatal),null);
  f.record[0x503]=0;f.record[0x510]=0x9c;f.record[0x511]=0x64;
  assert.equal(canAutosave(f),false);
  f.known[0xac]=0;
  assert.equal(canAutosave(f),false,'unknown character state cannot replace a recovery point');
});

test('manual checkpoints resume only from stable gameplay or outside a match',()=>{
  const f=frame(2);f.record[0x60]=3;
  assert.equal(canResumeCheckpoint(f),true);
  f.record[0x503]=3;
  assert.equal(canResumeCheckpoint(f),false,'death animation is not resumable');
  f.record[0x503]=0;f.record[0x60]=0;
  assert.equal(canResumeCheckpoint(f),false,'spent last life is not resumable');
  f.record[0x60]=3;f.record[5]=4;
  assert.equal(canResumeCheckpoint(f),false,'game over is not resumable');
  f.record[2]=1;
  assert.equal(canResumeCheckpoint(f),true,'title saves remain valid');
  f.known[2]=0;
  assert.equal(canResumeCheckpoint(f),false,'unknown mode is not resumable');
});

test('life recovery waits for a living character after the native death sequence',()=>{
  const f=frame(2);f.record[0x60]=2;f.record[0x503]=3;
  assert.equal(lifeTransitionEnded(observeGameState(f)),false);
  f.record[0x503]=0;f.record[0x510]=0x9c;f.record[0x511]=0x64;
  assert.equal(lifeTransitionEnded(observeGameState(f)),false,'death handler still runs');
  f.record[0x510]=0x97;f.record[0x511]=0x39;
  assert.equal(lifeTransitionEnded(observeGameState(f)),true);
  f.record[5]=4;
  assert.equal(lifeTransitionEnded(observeGameState(f)),false,'game over is not a recovery');
  f.record[2]=1;
  assert.equal(lifeTransitionEnded(observeGameState(f)),false,'title is not gameplay');
  f.known[2]=0;
  assert.equal(lifeTransitionEnded(observeGameState(f)),false,'unknown state cannot finish a transition');
});

test('life counters remain attached to their players across turn swaps',()=>{
  const f=frame(2);f.record[0x26]=1;f.record[0x60]=3;f.record[0x440]=1;
  const p1=observeGameState(f);
  f.record[0x27]=1;f.record[0x60]=1;f.record[0x440]=3;
  const p2=observeGameState(f);
  assert.deepEqual(p2.lives,[3,1]);
  assert.equal(lostLife(p1,p2),null,'a smaller current-player counter is not itself a death');
  f.record[0x440]=2;
  assert.equal(lostLife(p1,observeGameState(f)),1,'departing player lost a life during swap');
  f.record[0x60]=0;
  assert.equal(lostLife(p2,observeGameState(f)),1);
  const last=observeGameState(f);last.lives=[3,0];
  assert.equal(lostLife(p2,last),2,'last life is detected');
  assert.equal(canAutosave(f),false);
  assert.equal(lostLife(observeGameState(frame(1)),p1),null,'new match is not a death');
  assert.equal(lostLife(p1,observeGameState(frame(1))),null,'leaving gameplay alone is not a death');
});

test('automatic capture rejects a life lost at the frame boundary and startup RAM patterns',()=>{
  const f=frame(2);f.record[0x60]=3;
  const before=observeGameState(f);
  f.record[0x60]=2;
  assert.equal(canAutosave(f),true,'living state in isolation');
  assert.equal(canAutosave(f,before),false,'pending save cannot capture a newly lost life');
  f.record[0x60]=0;f.record[2]=1;
  assert.equal(lostLife(before,observeGameState(f)),1,'last life and title in the same observation');
  for(const mode of [0,1,85,187,255]){
    f.record[2]=mode;f.record[0x60]=3;
    assert.equal(canAutosave(f),false);
  }
});
