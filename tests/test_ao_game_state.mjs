import {test} from 'node:test';
import assert from 'node:assert/strict';
import {observeGameState} from '../src/ao_game_state.mjs';
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
