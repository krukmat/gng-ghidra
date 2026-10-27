import {test} from 'node:test';
import assert from 'node:assert/strict';
import {waitForAttractGate} from '../../bot/live/wait-demo-gate.mjs';
const frame=(n,extra={})=>({sessionId:1,frame:n,
  operatorPause:false,halt:null,lastRenderedFrame:0,...extra});
const noDelay=async()=>{};
test('HTTP online before VBlank is expected; wait for actual pause',async()=>{
  const history=[frame(0),frame(1),frame(2),
    frame(3,{operatorPause:true,lastRenderedFrame:3})];
  let polls=0,sleeps=0;
  const result=await waitForAttractGate({
    readState:async()=>history[polls++],sleep:async()=>{sleeps++},
    maxPolls:6,
  });
  assert.equal(result.frame,3);
  assert.equal(result.lastRenderedFrame,3);
  assert.equal(result.polls,4);
  assert.equal(sleeps,3);
});
test('already paused does not wait or send any game input',async()=>{
  let calls=0;
  const result=await waitForAttractGate({
    readState:async()=>{calls++;return frame(12,{operatorPause:true})},
    sleep:async()=>{throw Error('UNEXPECTED_SLEEP');},
  });
  assert.equal(result.frame,12);assert.equal(calls,1);
});
test('missing rendered pause gives bounded informative timeout',async()=>{
  let calls=0;
  await assert.rejects(waitForAttractGate({
    readState:async()=>{calls++;return frame(0)},
    sleep:noDelay,maxPolls:3,
  }),/BOT_DEMO_GATE_WAIT_TIMEOUT/);
  assert.equal(calls,3);
});
test('halts, session resets and cancellation do not continue the CPU',async()=>{
  await assert.rejects(waitForAttractGate({
    readState:async()=>frame(8,{halt:{status:'UNCOMPILED'}}),
    sleep:noDelay,maxPolls:2,
  }),/BOT_DEMO_GATE_ENGINE_HALT_UNCOMPILED/);
  let calls=0;
  await assert.rejects(waitForAttractGate({
    readState:async()=>frame(++calls,{sessionId:calls}),
    sleep:noDelay,maxPolls:2,
  }),/BOT_DEMO_GATE_SESSION_CHANGED/);
  await assert.rejects(waitForAttractGate({
    readState:async()=>frame(0),sleep:noDelay,
    shouldStop:()=>true,
  }),/BOT_DEMO_GATE_OPERATOR_CANCELLED/);
});
test('invalid state cannot silently enable demo',async()=>{
  await assert.rejects(waitForAttractGate({
    readState:async()=>({operatorPause:true}),sleep:noDelay,
  }),/BOT_DEMO_GATE_INVALID_STATE/);
  await assert.rejects(waitForAttractGate({maxPolls:0}),
    /BOT_DEMO_GATE_OPTIONS/);
});
