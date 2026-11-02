import test from 'node:test';
import assert from 'node:assert/strict';
import {assertPhaseCandidate,transitionObserver,FRAME_CYCLES} from '../src/h3_phase_contract.mjs';
const e=(f,c,p)=>({cycle:f*FRAME_CYCLES,control:c,pressed:p});
function fixture(){
 const prefix=[e(50,'coin1',true),e(55,'coin1',false),e(75,'start1',true),e(80,'start1',false)];
 const initial={sha256:'a',h3:{goalFrame:200,signal:{phase:3,lives:4},ramSha:'f'.repeat(64)},events:prefix};
 const candidate={sha256:'b',frames:331,events:[...prefix,e(201,'p1.right',true),e(329,'p1.right',false)]};
 return {initial,candidate,visiblePhase:4,end:330,initialSha:'a',candidateSha:'b'};
}
test('Phase 4 validates seed, prefix, tail and horizon',()=>{
 assert.deepEqual(assertPhaseCandidate(fixture()),{from:3,to:4,start:200,end:330,cut:200*FRAME_CYCLES});
});
test('Reject changed prefix, non-player tail, held controls and late events',()=>{
 const a=fixture();a.candidate.events[0]={...a.candidate.events[0],cycle:51*FRAME_CYCLES};
 assert.throws(()=>assertPhaseCandidate(a),/PREFIX/);
 const b=fixture();b.candidate.events.push(e(205,'coin1',true));
 assert.throws(()=>assertPhaseCandidate(b),/NON_PLAYER/);
 const c=fixture();c.candidate.events.pop();
 assert.throws(()=>assertPhaseCandidate(c),/NOT_RELEASED/);
 const d=fixture();d.candidate.events.push(e(331,'p1.left',true));
 assert.throws(()=>assertPhaseCandidate(d),/TAIL_PAST_END/);
});
test('Reject poke, wrong starting phase and truncated horizon',()=>{
 const a=fixture();a.candidate.h3={poke:'abc'};
 assert.throws(()=>assertPhaseCandidate(a),/POKE/);
 const b=fixture();b.initial.h3.signal.phase=2;
 assert.throws(()=>assertPhaseCandidate(b),/INITIAL_SIGNAL/);
 const c=fixture();c.candidate.frames=330;
 assert.throws(()=>assertPhaseCandidate(c),/HORIZON/);
});
test('Only target transition after cut counts',()=>{
 const t=transitionObserver(3,200);
 for(const row of [[1,0],[100,1],[150,2],[180,3],[200,3],[219,3],[220,4],[221,4]])t.record(...row);
 assert.deepEqual(t.result(),{transition:220,count:1,otherChanges:[]});
 t.record(300,5);
 assert.deepEqual(t.result().otherChanges,[{frame:300,from:4,to:5}]);
});
