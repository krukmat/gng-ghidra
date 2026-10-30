import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fourWayConflict,CONTINUE_CONTROLS,DIP_DEFAULTS} from '../games/gngb/inputs.mjs';
import {RAM,playerLabels,look} from '../games/gngb/state.mjs';
import {INPUT_DEFAULTS} from '../src/gngb_input_contract.mjs';
import {PORT_DEFAULTS} from '../boards/gng/runtime.mjs';
import {REC} from '../boards/gng/frame-record.mjs';

// ROM-free: the game owns the input policy and the RAM labels.
test('4-way policy, Continue combination and DIP defaults',()=>{
  assert.equal(fourWayConflict(new Set(['p1.left','p1.button1','p2.up'])),false);
  assert.equal(fourWayConflict(new Set(['p1.left','p1.up'])),true);
  assert.equal(fourWayConflict(new Set(['p2.down','p2.right'])),true);
  assert.deepEqual(CONTINUE_CONTROLS,['start1','p1.button1']);
  assert.deepEqual(INPUT_DEFAULTS,[0xff,0xff,0xff,...DIP_DEFAULTS]);
  assert.deepEqual(INPUT_DEFAULTS,PORT_DEFAULTS); // the board's unattached fallback
});

test('player labels report values and which bytes are known',()=>{
  const record=new Uint8Array(REC.size),known=new Uint8Array(REC.size).fill(255);
  record.set([0x12,0x34,0x00,0x80],RAM.world);record[RAM.lives]=3;record[RAM.stage]=1;
  assert.deepEqual(playerLabels({record,known}),
    {known:true,stageKnown:true,world:0x1234,y:0x80,lives:3,stage:1});
  known[RAM.y+1]=0;known[RAM.stage]=0;
  const l=playerLabels({record,known});
  assert.equal(l.known,false);assert.equal(l.stageKnown,false);
  assert.equal(look(record).x,0x1234);
});
