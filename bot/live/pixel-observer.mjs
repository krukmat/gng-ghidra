#!/usr/bin/env node
/** Read-only pixel observer against existing gngb HTTP. Only GET /state
 * and GET /pixels; no gameplay commands, privileged RAM, ROM or engine edits.
 */
import {detectWaterTerrain,createIslandVelocityTracker}
  from '../perception/terrain-water.mjs';
import {detectArthurSkin} from '../perception/arthur-skin.mjs';
export function createLivePixelObserver({base='http://127.0.0.1:18609',
  fetchImpl=fetch,maxFrameGap=24}={}){
  const tracker=createIslandVelocityTracker({maxGapFrames:maxFrameGap});
  let prior=null;
  async function sample(){
    const s=await fetchImpl(base+'/state',{cache:'no-store'});
    if(!s.ok)throw Error('BOT_LIVE_STATE_HTTP_'+s.status);
    const state=await s.json();
    if(state.halt)return {status:'HALT',frame:state.frame,
      halt:state.halt,gameplay:'STOP'};
    if(state.operatorPause)return {status:'PAUSED',gameplay:'STOP'};
    const response=await fetchImpl(base+'/pixels',{cache:'no-store'});
    if(response.status===204)return {status:'NO_FRAME',gameplay:'STOP'};
    if(!response.ok)throw Error('BOT_LIVE_PIXELS_HTTP_'+response.status);
    const frame=Number(response.headers.get('X-GnG-Frame'));
    const session=Number(response.headers.get('X-GnG-Session'));
    if(!Number.isSafeInteger(frame)||frame<1||
      !Number.isSafeInteger(session)||session!==state.sessionId)
      return {status:'SESSION_OR_FRAME_UNKNOWN',gameplay:'STOP'};
    const bytes=new Uint8Array(await response.arrayBuffer());
    if(bytes.length!==256*224*4)throw Error('BOT_LIVE_RGBA_SIZE');
    if(prior&&(prior.session!==session||frame<=prior.frame)){
      if(prior.session!==session){tracker.reset();prior=null;}
      else return {status:'UNCHANGED_FRAME',frame,gameplay:'STOP'};
    }
    const terrain=detectWaterTerrain({rgba:bytes});
    const arthur=detectArthurSkin({rgba:bytes,roiLeft:96,roiRight:165});
    const motion=tracker.observe({frame,session:String(session),terrain});
    prior={frame,session};
    return {status:'OBSERVED_CANDIDATES',frame,session,
      bankX:terrain.leftBank?.right??null,
      islandLeft:terrain.island?.left??null,
      islandRight:terrain.island?.right??null,
      arthurX:arthur.kind==='ARTHUR_SKIN_CANDIDATE'?arthur.x:null,
      islandVelocity:motion.status==='MOTION_CANDIDATE'?motion.velocity:null,
      bossDefeated:'UNKNOWN',grounded:'UNKNOWN',rightBank:'UNKNOWN',
      gameplay:'STOP_UNCALIBRATED'};
  }
  return {sample};
}
if(process.argv[1]?.endsWith('/pixel-observer.mjs')){
  const max=Number(process.argv[2]??20);
  if(!Number.isSafeInteger(max)||max<1||max>500)
    throw Error('BOT_LIVE_PIXEL_OBSERVER_USAGE');
  const obs=createLivePixelObserver();
  for(let i=0;i<max;i++){
    const frame=await obs.sample();
    console.log('BOT_LIVE_OBSERVATION='+JSON.stringify(frame));
    if(frame.status==='HALT')break;
    await new Promise(resolve=>setTimeout(resolve,60));
  }
}
