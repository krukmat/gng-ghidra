import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createFrameLedger} from '../../bot/live/recording-ledger.mjs';
const payload=()=>new Uint8Array(256*224*4);
test('native pixel frames retain original engine frames and session',()=>{
  const l=createFrameLedger();
  l.accept({session:1,engineFrame:200,wallMs:0,bytes:payload()});
  l.accept({session:1,engineFrame:204,wallMs:50,bytes:payload()});
  l.accept({session:1,engineFrame:204,wallMs:100,bytes:payload()});
  const r=l.report();
  assert.equal(r.samples,3);
  assert.equal(r.skippedEngineFrames,3);
  assert.equal(r.duplicates,1);
  assert.deepEqual(r.frames.map(x=>x.engineFrame),[200,204,204]);
  assert.equal(r.frames[2].repeated,true);
});
test('session reset does not create bogus skipped-frame counts',()=>{
  const l=createFrameLedger();
  l.accept({session:1,engineFrame:150,wallMs:0,bytes:payload()});
  l.accept({session:2,engineFrame:30,wallMs:50,bytes:payload()});
  assert.equal(l.report().sessionChanges,1);
  assert.equal(l.report().skippedEngineFrames,0);
});
test('stale same-session frames and invalid lengths fail closed',()=>{
  const l=createFrameLedger();
  l.accept({session:1,engineFrame:30,wallMs:0,bytes:payload()});
  assert.throws(()=>l.accept({session:1,engineFrame:29,
    wallMs:50,bytes:payload()}),/REGRESSION/);
  assert.throws(()=>l.accept({session:1,engineFrame:31,
    wallMs:60,bytes:new Uint8Array(10)}),/FRAME_INVALID/);
  assert.throws(()=>l.accept({session:1,engineFrame:31,
    wallMs:-1,bytes:payload()}),/FRAME_INVALID/);
});
test('no accepted gameplay frames returns empty ledger, never fake frames',()=>{
  assert.deepEqual(createFrameLedger().report().frames,[]);
});
