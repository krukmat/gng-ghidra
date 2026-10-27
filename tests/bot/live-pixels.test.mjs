import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createLivePixelObserver} from '../../bot/live/pixel-observer.mjs';
import {dispatchVerifiedP1} from '../../bot/live/safe-dispatch.mjs';
function fakeServer(){
  const requests=[],headers=new Headers({'X-GnG-Frame':'100','X-GnG-Session':'1'});
  const fetchImpl=async(path,opts={})=>{
    requests.push({path,method:opts.method??'GET'});
    if(path.endsWith('/state'))return Response.json({sessionId:1,frame:100,
      operatorPause:false,halt:null});
    if(path.endsWith('/pixels'))return new Response(
      new Uint8Array(256*224*4),{status:200,headers});
    if(path.endsWith('/input')||path.endsWith('/release'))
      return Response.json({ok:true});
    throw Error('UNEXPECTED_FETCH');
  };
  return {requests,fetchImpl};
}
test('live visual observer performs GETs only and has no false kill/landing',async()=>{
  const f=fakeServer(),o=createLivePixelObserver({fetchImpl:f.fetchImpl});
  const first=await o.sample();
  assert.equal(first.status,'OBSERVED_CANDIDATES');
  assert.equal(first.bossDefeated,'UNKNOWN');
  assert.equal(first.grounded,'UNKNOWN');
  assert.deepEqual(f.requests.map(r=>r.method),['GET','GET']);
  assert.equal((await o.sample()).status,'UNCHANGED_FRAME');
});
test('unverified observations never send P1 input',async()=>{
  const f=fakeServer();
  const r=await dispatchVerifiedP1({fetchImpl:f.fetchImpl,sessionId:1,
    decision:{stage:'ISLAND',commands:[{control:'p1.button2',pressed:true}]},
    evidence:{bossDefeated:true,terrainCalibrated:false}});
  assert.equal(r.status,'STOP_NO_INPUT');
  assert.equal(f.requests.length,0);
});
test('only proven evidence authorizes original P1 controls',async()=>{
  const f=fakeServer();
  const r=await dispatchVerifiedP1({fetchImpl:f.fetchImpl,sessionId:1,
    decision:{stage:'ISLAND',commands:[{control:'p1.button2',pressed:true}]},
    evidence:{bossDefeated:true,lifeConfirmed:true,pixelsCalibrated:true,
      terrainCalibrated:true,groundedConfirmed:true}});
  assert.equal(r.status,'COMMANDS_SENT');
  assert.deepEqual(f.requests.map(x=>x.method),['GET','POST']);
});
test('Coin/Start cannot be dispatched through water policy',async()=>{
  const f=fakeServer();
  const r=await dispatchVerifiedP1({fetchImpl:f.fetchImpl,sessionId:1,
    decision:{stage:'MAINLAND',commands:[{control:'coin1',pressed:true}]},
    evidence:{bossDefeated:true,lifeConfirmed:true,pixelsCalibrated:true,
      terrainCalibrated:true,groundedConfirmed:true}});
  assert.equal(r.status,'STOP_NO_INPUT');assert.equal(f.requests.length,0);
});
