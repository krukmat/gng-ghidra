import test from 'node:test';
import assert from 'node:assert/strict';
import {assertPhaseCandidate,transitionObserver,phase6Evidence,FRAME_CYCLES} from '../src/h3_phase_contract.mjs';
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
const p6=(n,over={})=>{
 const rows=[];for(let f=100;f<=n;f++)rows.push({frame:f,phase:f<120?5:6,weapon:3,mode:f<160?2:1,loop:2,f7f:0,de:0,lives:4});
 for(const [f,v] of Object.entries(over))Object.assign(rows[f-100],v);
 return rows;
};
test('Phase 6 needs shield before 5→6 and a playable rest window',()=>{
 assert.deepEqual(phase6Evidence(p6(200),{transition:120,end:200}),
  {weaponAtTransition:3,firstPlayableRoomFrame:160,restFrames:41,loop:[2],f7f:[0],de:[0]});
 assert.throws(()=>phase6Evidence(p6(200,{119:{weapon:4}}),{transition:120,end:200}),/NO_SHIELD/);
 assert.throws(()=>phase6Evidence(p6(170),{transition:120,end:170}),/REST_SHORT/);
 assert.throws(()=>phase6Evidence(p6(200,{200:{mode:2}}),{transition:120,end:200}),/NOT_PLAYABLE/);
 assert.throws(()=>phase6Evidence(p6(200,{190:{lives:3}}),{transition:120,end:200}),/LIFE_LOST/);
 assert.equal(phase6Evidence(p6(200,{100:{lives:5}}),{transition:120,end:200}).restFrames,41);
 assert.throws(()=>phase6Evidence(p6(200),{transition:120,end:201}),/ROWS_MISSING/);
 assert.equal(phase6Evidence(p6(200,{170:{phase:5}}),{transition:120,end:200}).firstPlayableRoomFrame,171);
});
test('Phase 6 rollback 5→4 or extra stage change is rejected by the observer',()=>{
 const t=transitionObserver(5,100);
 for(const row of [[100,5],[110,4],[115,5],[120,6]])t.record(...row);
 assert.deepEqual(t.result().otherChanges,[{frame:110,from:5,to:4},{frame:115,from:4,to:5}]);
});
