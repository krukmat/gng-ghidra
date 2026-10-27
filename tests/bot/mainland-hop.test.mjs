import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createMainlandHopPolicy} from '../../bot/policy/mainland-hop.mjs';
const options={flightFrames:12,runSpeedPxPerFrame:2,jumpHoldFrames:3};
const o=(frame,extra={})=>({frame,session:'s',lifeKey:'l',playing:true,
  arthur:{x:105,feetY:100,confidence:1,grounded:true},
  island:{left:88,right:122,topY:100,confidence:1},
  land:{left:124,right:220,topY:100,confidence:1},...extra});

test('second hop requires visual island landing before takeoff',()=>{
  const p=createMainlandHopPolicy(options);
  const obs=o(1,{arthur:{x:105,feetY:90,confidence:1,grounded:false}});
  assert.equal(p.observe(obs).reason,'NOT_GROUNDED_ON_ISLAND');
});
test('second jump confirms the far shore with two observed contacts',()=>{
  const p=createMainlandHopPolicy(options);
  const t=p.observe(o(1));
  assert.equal(t.phase,'TAKEOFF_MAINLAND');
  assert.equal(t.action,'right_jump');
  for(let f=2;f<=12;f++){
    const r=p.observe(o(f,{arthur:{x:105+(f-1)*2,feetY:90,
      confidence:1,grounded:false}}));
    assert.equal(r.phase,'AIRBORNE_MAINLAND');
  }
  const p1=p.observe(o(13,{arthur:{x:129,feetY:100,confidence:1,grounded:true}}));
  assert.equal(p1.reason,'VERIFY_BANK_CONTACT');
  assert.equal(p.observe(o(14,{arthur:{x:131,feetY:100,confidence:1,grounded:true}})).phase,'LANDED');
  assert.equal(p.observe(o(15)).phase,'LANDED');
});
test('out of range far shore causes WAIT and eventually STOP',()=>{
  const p=createMainlandHopPolicy({...options,maxWaitFrames:2});
  const land={left:180,right:240,topY:100,confidence:1};
  for(let f=1;f<=3;f++)assert.equal(p.observe(o(f,{land})).phase,'WAIT');
  assert.equal(p.observe(o(4,{land})).phase,'STOP');
});
test('no stage completion without contact',()=>{
  const p=createMainlandHopPolicy(options);p.observe(o(1));
  let last;
  for(let f=2;f<=23;f++)last=p.observe(o(f,{arthur:{x:110,feetY:80,
    confidence:1,grounded:false}}));
  assert.equal(last.phase,'STOP');
});
