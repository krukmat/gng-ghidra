import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compareEvents} from '../scripts/r35_t5_run.mjs';
const sync=(cycle)=>['SYNC_ENTER',0x6016,0x50,cycle];
test('native capped SYNC must not silently accept fewer JS events',()=>{
 const expected=[sync(8),sync(16)];
 const got=[sync(8)];
 const r=compareEvents(got,expected,30);
 assert.equal(r.SYNC_ENTER.first_divergence.i,1);
});
test('native capped SYNC comparison accepts extra JS after native log cap',()=>{
 const expected=[sync(8)];
 const got=[sync(8),sync(16)];
 const r=compareEvents(got,expected,30);
 assert.equal(r.SYNC_ENTER.first_divergence,null);
 assert.equal(r.SYNC_ENTER.compared,1);
});
test('no native SYNC proof cannot count as matched',()=>{
 const r=compareEvents([sync(8)],[],20);
 assert.notEqual(r.SYNC_ENTER.first_divergence,null);
});
