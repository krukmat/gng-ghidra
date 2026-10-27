import {test} from 'node:test';
import assert from 'node:assert/strict';
import {suffixEvents} from '../../bot/actions.mjs';
import {CYCLES_PER_FRAME as K} from '../../src/gngb_runtime.mjs';
import {defineInputSchedule,readScheduledPort} from '../../src/gngb_input_contract.mjs';

test('suffix releases held controls and replaces the prefix atomically',()=>{
  const events=suffixEvents([{cycle:10*K,control:'p1.right',pressed:true},
    {cycle:15*K,control:'p1.button2',pressed:true},
    {cycle:25*K,control:'p1.right',pressed:false}],20,
    [{duration:10,action:'left_fire'}],40);
  const schedule=defineInputSchedule(events);
  assert.equal(readScheduledPort(schedule,0x3001,19*K)&0x21,0);
  assert.equal(readScheduledPort(schedule,0x3001,20*K)&0x33,0x21);
  assert.equal(readScheduledPort(schedule,0x3001,39*K),0xff);
  assert.ok(events.every(e=>e.cycle<40*K));
});

test('suffix cannot insert extra credits and supports new tactics',()=>{
  for(const action of ['neutral','down_fire','left_fire_jump','stand_jump']){
    const events=suffixEvents([],2100,[{duration:50,action}],2200);
    assert.ok(events.every(e=>e.control.startsWith('p1.')));
  }
  assert.throws(()=>suffixEvents([],2100,[{duration:1,action:'coin1'}],2200));
});
