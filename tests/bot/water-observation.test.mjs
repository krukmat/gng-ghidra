import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWaterObservationTracker} from '../../bot/perception/water-observation.mjs';

// Synthetic pixels encode terrain separation and the real corpus's 187..191
// ground-height body-bottom variation, without shipping protected graphics.
function pixels({x=80,top=169,bottom=189,shore=140,island=180,islandWidth=32,visible=true,
  secondBody=false,islandFragments=null}={}){
  const rgba=new Uint8Array(256*224*4);
  const paint=(left,right,y0,y1,color)=>{
    for(let y=y0;y<=y1;y++)for(let at=left;at<=right;at++)
      rgba.set([...color,255],(y*256+at)*4);
  };
  paint(0,shore,192,206,[85,119,0]);
  for(const [left,right] of islandFragments??[[island,island+islandWidth-1]])
    paint(left,right,196,200,[0,119,0]);
  if(visible)paint(x-8,x+8,top,bottom,[170,136,102]);
  if(secondBody)paint(20,36,top,bottom,[170,136,102]);
  return rgba;
}
const configured=()=>createWaterObservationTracker({bodyBottomToFeetPx:3});
const sample=(tracker,frame,options={},session='s')=>tracker.observe({frame,
  session,rgba:pixels(options)});

test('separate visible feet can support the body at the platform edge',()=>{
  const t=configured();
  const rgba=pixels({x:127,bottom:193,shore:90,island:126});
  for(let y=191;y<=193;y++)for(let x=119;x<=135;x++){
    const foot=x<=123||x>=131;
    rgba.set(foot?[170,136,102,255]:[0,0,0,255],(y*256+x)*4);
  }
  let r;
  for(let frame=1;frame<=3;frame++)r=t.observe({frame,session:'s',rgba});
  assert.deepEqual(r.arthur.feetXEstimates,[121,133]);
  assert.equal(r.arthur.x,127);
  assert.equal(r.support,'ISLAND');
  assert.equal(r.supportPointX,133);
  assert.equal(r.calibrated,false);
});

test('ground-height animation yields only a temporal BANK support candidate',()=>{
  const t=configured();
  assert.equal(sample(t,1,{bottom:189}).grounded,null);
  assert.equal(sample(t,2,{bottom:191}).grounded,null);
  const r=sample(t,3,{bottom:187});
  assert.equal(r.grounded,true);
  assert.equal(r.support,'BANK');
  assert.equal(r.arthur.bodyBottom,187);
  assert.equal(r.arthur.feetYEstimate,190);
  assert.equal(r.calibrated,false);
  assert.equal(r.confidence,null);
  assert.equal(r.playing,'UNKNOWN');
  assert.equal(r.lifeKey,'UNKNOWN');
  assert.equal(r.bossDefeated,'UNKNOWN');
});

test('ISLAND support is distinct from BANK and needs a new stable history',()=>{
  const t=configured();
  for(let frame=1;frame<=3;frame++)sample(t,frame);
  assert.equal(sample(t,4,{x:195,bottom:193}).grounded,null);
  assert.equal(sample(t,5,{x:195,bottom:193}).grounded,null);
  const r=sample(t,6,{x:195,bottom:193});
  assert.equal(r.support,'ISLAND');
  assert.equal(r.grounded,true);
});

test('clear vertical displacement makes grounded false, including below old scan',()=>{
  const t=configured();
  sample(t,1);sample(t,2);sample(t,3);
  let r=sample(t,4,{top:160,bottom:180});
  assert.equal(r.grounded,false);
  assert.equal(r.support,null);
  r=sample(t,5,{x:160,top:185,bottom:207});
  assert.equal(r.arthur.bodyBottom,207);
  assert.equal(r.grounded,false);
  assert.equal(r.support,null);
});

test('standing-height sprite over the gap is not a landing',()=>{
  const t=configured();
  for(let f=1;f<=4;f++){
    const r=sample(t,f,{x:160,bottom:189});
    assert.equal(r.grounded,null);
    assert.equal(r.support,null);
  }
});

test('descent ending near support awaits landing stability',()=>{
  const t=configured();
  sample(t,1,{top:145,bottom:165});
  const landing=sample(t,2,{top:169,bottom:189});
  assert.equal(landing.grounded,null);
  assert.equal(landing.support,null);
  assert.equal(sample(t,3,{top:169,bottom:189}).grounded,null);
  assert.equal(sample(t,4,{top:169,bottom:189}).support,'BANK');
});

test('unconfigured foot offset never makes up contact',()=>{
  const t=createWaterObservationTracker();
  for(let f=1;f<=4;f++){
    const r=sample(t,f);
    assert.equal(r.arthur.feetYEstimate,null);
    assert.equal(r.grounded,null);
    assert.equal(r.reason,'FOOT_OFFSET_UNCALIBRATED');
  }
});

test('occluded or ambiguous bodies reset support and recover without a terminal STOP',()=>{
  const t=configured();
  sample(t,1);sample(t,2);sample(t,3);
  let r=sample(t,4,{visible:false});
  assert.equal(r.kind,'UNKNOWN');
  assert.equal(r.grounded,null);
  assert.equal(r.arthur,null);
  r=sample(t,5,{secondBody:true});
  assert.equal(r.reason,'AMBIGUOUS_BODY_PALETTE');
  assert.equal(sample(t,6).grounded,null);
  assert.equal(sample(t,7).grounded,null);
  assert.equal(sample(t,8).support,'BANK');
});

test('session, frame gap, stale input and explicit reset invalidate continuity',()=>{
  const t=configured();
  sample(t,1);sample(t,2);sample(t,3);
  let r=sample(t,1,{},'new');
  assert.equal(r.grounded,null);
  assert.equal(r.evidence.resetReason,'SESSION_CHANGED');
  sample(t,2,{},'new');assert.equal(sample(t,3,{},'new').support,'BANK');
  r=sample(t,20,{},'new');
  assert.equal(r.grounded,null);
  assert.equal(r.evidence.resetReason,'FRAME_GAP');
  assert.equal(sample(t,20,{},'new').reason,'STALE_FRAME');
  assert.equal(sample(t,21,{},'new').grounded,null);
  t.reset();assert.equal(sample(t,22,{},'new').grounded,null);
});

test('invalid calibration and frame/session contracts are rejected',()=>{
  assert.throws(()=>createWaterObservationTracker({bodyBottomToFeetPx:NaN}),/OPTIONS/);
  assert.throws(()=>createWaterObservationTracker({minVerticalTravelPx:4}),/OPTIONS/);
  assert.throws(()=>createWaterObservationTracker({minSupportSamples:1}),/OPTIONS/);
  const t=configured();
  assert.throws(()=>t.observe({frame:1,session:1,rgba:pixels()}),/FRAME/);
  assert.throws(()=>t.observe({frame:-1,session:'s',rgba:pixels()}),/FRAME/);
});

test('opt-in reconstruction uses a visible edge plus previously observed width',()=>{
  const t=createWaterObservationTracker({bodyBottomToFeetPx:3,inferOccludedIsland:true});
  sample(t,1);sample(t,2);sample(t,3);
  const covered={x:205,bottom:193,islandFragments:[[180,184]]};
  let r=sample(t,4,covered);
  assert.deepEqual([r.terrain.island.left,r.terrain.island.right],[180,211]);
  assert.equal(r.terrain.island.extentEstimated,true);
  assert.equal(r.terrain.island.pixelEvidence,25);
  assert.equal(r.terrain.island.calibrated,false);
  assert.equal(r.grounded,null);
  sample(t,5,covered);r=sample(t,6,covered);
  assert.equal(r.support,'ISLAND');
  assert.equal(r.calibrated,false);
});

test('occlusion reconstruction follows camera-relative observed fragments',()=>{
  const t=createWaterObservationTracker({bodyBottomToFeetPx:3,inferOccludedIsland:true});
  sample(t,1);sample(t,2);sample(t,3);
  const r=sample(t,4,{shore:130,island:170,x:195,bottom:193,
    islandFragments:[[170,174],[198,201]]});
  assert.deepEqual([r.terrain.island.left,r.terrain.island.right],[170,201]);
  assert.equal(r.terrain.island.extentEstimated,true);
});

test('shortened components do not overwrite the full width during occlusion',()=>{
  const t=createWaterObservationTracker({bodyBottomToFeetPx:3,inferOccludedIsland:true});
  sample(t,1);sample(t,2);sample(t,3);
  const r=sample(t,4,{x:205,bottom:193,islandFragments:[[180,198]]});
  assert.equal(r.terrain.island.observedWidthPx,32);
  assert.equal(r.terrain.island.right,211);
  assert.equal(r.terrain.island.extentEstimated,true);
});

test('trial-2 fragment geometry keeps the 31px island beneath Arthur',()=>{
  const t=createWaterObservationTracker({bodyBottomToFeetPx:3,
    supportHeightTolerancePx:5,inferOccludedIsland:true});
  sample(t,1,{shore:99,island:114,islandWidth:31});
  sample(t,2,{shore:97,island:112,islandWidth:31});
  const r=sample(t,3,{shore:95,x:130,bottom:190,
    islandFragments:[[110,113],[123,130]]});
  assert.deepEqual([r.terrain.island.left,r.terrain.island.right],[110,140]);
  assert.equal(r.terrain.island.extentEstimated,true);
  assert.equal(r.terrain.island.visibleFragments.length,2);
  assert.equal(r.grounded,null); // Geometry alone does not establish landing.
});

test('no reconstruction when the island vanishes or both outer edges are hidden',()=>{
  const t=createWaterObservationTracker({bodyBottomToFeetPx:3,inferOccludedIsland:true});
  sample(t,1);sample(t,2);sample(t,3);
  for(const [index,islandFragments] of [[],[[199,202]],[[242,246]]].entries()){
    const r=sample(t,4+index,{x:205,bottom:193,islandFragments});
    assert.equal(r.terrain?.island??null,null);
    assert.equal(r.support,null);
    assert.equal(r.grounded,null);
  }
});

test('reconstruction is disabled by default and cannot survive a session change',()=>{
  const covered={x:205,bottom:193,islandFragments:[[180,184]]};
  const off=configured();sample(off,1);sample(off,2);sample(off,3);
  assert.equal(sample(off,4,covered).terrain.island,null);
  const on=createWaterObservationTracker({bodyBottomToFeetPx:3,inferOccludedIsland:true});
  sample(on,1);sample(on,2);sample(on,3);
  assert.equal(sample(on,1,covered,'new').terrain.island,null);
});
