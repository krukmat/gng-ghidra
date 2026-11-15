import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createMatchTracker} from '../src/ao_match.mjs';

const s=(mode,inGame,player,scores,players=2)=>({mode,inGame,players,player,scores});
test('a two-player game: start, turns when play resumes, result at the title',()=>{
  const m=createMatchTracker();
  assert.deepEqual(m.update(s(1,false,1,[0,0])),[]);
  assert.deepEqual(m.update(s(2,true,1,[0,0])),[{type:'start',player:1}]);
  assert.deepEqual(m.update(s(2,true,1,[200,0])),[]);
  // P1's life ends; the turn flips during the death, play resumes with P2.
  assert.deepEqual(m.update(s(2,false,2,[1600,0])),[]);
  assert.deepEqual(m.update(s(2,true,2,[1600,0])),[{type:'turn',player:2}]);
  assert.deepEqual(m.update(s(2,true,2,[1600,1400])),[]);
  assert.deepEqual(m.update(s(2,true,1,[1600,1400])),[{type:'turn',player:1}]);
  assert.deepEqual(m.update(s(2,false,2,[4600,4000])),[]);
  assert.deepEqual(m.update(s(1,false,2,[4600,4000])),
    [{type:'result',scores:[4600,4000],winner:1}]);
  assert.deepEqual(m.update(s(1,false,2,[0,0])),[],'one result per game');
});
test('only games started from the title count: not the power-on RAM test',()=>{
  const m=createMatchTracker();
  const noise=[99999999,99999999];
  assert.deepEqual(m.update(s(2,true,2,noise)),[]);
  assert.deepEqual(m.update(s(2,true,1,noise)),[]);
  assert.deepEqual(m.update(s(0,false,1,noise)),[]);
  m.update(s(1,false,1,[0,0]));
  assert.deepEqual(m.update(s(2,true,1,[0,0],1)),[],'a one-player game');
  assert.deepEqual(m.update(s(2,true,1,[100],1)),[]);
  assert.deepEqual(m.update(s(1,false,1,[100],1)),[]);
});
test('ties, unreadable scores and reset',()=>{
  const m=createMatchTracker();
  m.update(s(1,false,1,[0,0]));m.update(s(2,true,1,[0,0]));m.update(s(2,true,1,[500,500]));
  assert.deepEqual(m.update(s(1,false,1,[500,500])),
    [{type:'result',scores:[500,500],winner:0}]);
  m.update(s(2,true,1,null));
  assert.deepEqual(m.update(s(1,false,1,null)),[],'no scores, no result');
  m.update(s(2,true,1,[0,0]));m.reset();
  assert.deepEqual(m.update(s(2,true,2,[0,0])),[],'reset forgets the game and the title');
  assert.deepEqual(m.update(null),[]);
});
