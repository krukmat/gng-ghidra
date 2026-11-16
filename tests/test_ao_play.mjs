import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPlayStarter} from '../src/ao_play.mjs';

const title={mode:1,inGame:false,credits:0,canContinue:false};
function setup(t){
  t.mock.timers.enable({apis:['setTimeout']});
  const calls=[],timeouts=[];
  const play=createPlayStarter({pulse:key=>{calls.push(key);return true;},
    onTimeout:()=>timeouts.push(true)});
  return {play,calls,timeouts};
}
test('Jugar supplies one credit, waits for the ROM and ignores repeat requests',t=>{
  const {play,calls}=setup(t);
  assert.equal(play.request({...title,mode:0}),true);
  assert.equal(play.request(title),false);
  assert.deepEqual(calls,['coin1']);
  play.update({...title,mode:0,credits:1});
  assert.deepEqual(calls,['coin1']);
  play.update({...title,credits:1});play.update({...title,credits:1});
  assert.deepEqual(calls,['coin1','start1']);assert.equal(play.busy,true);
  play.update({mode:2,inGame:true});assert.equal(play.busy,false);
});
test('two players use only missing credits and start together',t=>{
  const {play,calls}=setup(t);
  play.request(title,2);assert.deepEqual(calls,['coin1','coin1']);
  play.update({...title,credits:1});assert.equal(calls.length,2);
  play.update({...title,credits:2});assert.equal(calls.at(-1),'start2');
  play.cancel();calls.length=0;
  play.request({...title,credits:1},2);
  assert.deepEqual(calls,['coin1']);
  play.update({...title,credits:2});assert.equal(calls.at(-1),'start2');
  play.cancel();calls.length=0;
  play.request({...title,credits:2},2);assert.deepEqual(calls,['start2']);
  play.cancel();
});
test('Continuar supplies a credit and uses the game continue combination',t=>{
  const {play,calls}=setup(t),state={...title,mode:2,canContinue:true};
  play.request(state);assert.deepEqual(calls,['coin1']);
  play.update({...state,credits:1});assert.deepEqual(calls,['coin1','continue1']);
  play.update({...state,credits:1});assert.equal(calls.length,2);
  play.update({...state,inGame:true,canContinue:false});assert.equal(play.busy,false);
});
test('cancel, timeout and an expired continue cannot start a later session',t=>{
  const {play,calls,timeouts}=setup(t);
  play.request(title);play.cancel();
  play.update({...title,credits:1});t.mock.timers.tick(6000);
  assert.deepEqual(calls,['coin1']);assert.deepEqual(timeouts,[]);
  play.request(title);t.mock.timers.tick(5000);
  assert.equal(play.busy,false);assert.equal(timeouts.length,1);
  play.update({...title,credits:1});assert.equal(calls.length,2);
  play.request({...title,mode:2,canContinue:true});
  play.update({...title,credits:1});assert.equal(play.busy,false);
  assert.deepEqual(calls,['coin1','coin1','coin1']);
});
test('playing, an unavailable input or a transition rejects the request',t=>{
  const {play,calls}=setup(t);
  for(const state of [{...title,inGame:true},{...title,mode:2},{...title,mode:3}])
    assert.equal(play.request(state),false);
  assert.deepEqual(calls,[]);
  const disabled=createPlayStarter({pulse:()=>false});
  assert.equal(disabled.request(title),false);assert.equal(disabled.busy,false);
});
