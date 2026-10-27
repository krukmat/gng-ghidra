/** Temporal stage-1 pixel CANDIDATES, not a gameplay authorization.
 * No RAM, life/death, playing or boss-kill inference. Body colors do not
 * locate feet: a caller must explicitly supply bodyBottomToFeetPx before
 * a support candidate can be emitted. Even then calibrated stays false.
 * The private 2400..2800 corpus has body bottoms 187..191 at the same
 * ground-height label. A 4px spread is animation noise; coherent movement
 * of BOTH bbox edges by >=6px is stronger airborne evidence.
 */
import {detectArthurSkin} from './arthur-skin.mjs';
import {detectWaterTerrain,createIslandVelocityTracker} from './terrain-water.mjs';

const integer=(n,min=0)=>Number.isSafeInteger(n)&&n>=min;
const finite=n=>typeof n==='number'&&Number.isFinite(n);

export function createWaterObservationTracker({bodyBottomToFeetPx=null,
  supportHeightTolerancePx=2,bankSurfaceY=192,supportInsetPx=2,
  minSupportSamples=3,maxBodyBottomSpreadPx=4,minVerticalTravelPx=6,
  maxGapFrames=12,historySamples=3,roiLeft=0,roiRight=255,
  bodyScanTop=96,bodyScanBottom=215,terrainOptions={},inferOccludedIsland=false,
  minIslandWidthSamples=2,islandWidthTolerancePx=2,occlusionBodyPaddingPx=8,
  occlusionPositionTolerancePx=5,maxIslandSpeedPxPerFrame=4,
  maxOcclusionHoldFrames=240}={}){
  if((bodyBottomToFeetPx!==null&&(!finite(bodyBottomToFeetPx)||
      Math.abs(bodyBottomToFeetPx)>32))||
    !finite(supportHeightTolerancePx)||supportHeightTolerancePx<0||
    !finite(bankSurfaceY)||bankSurfaceY<0||
    !finite(supportInsetPx)||supportInsetPx<0||
    !integer(minSupportSamples,2)||!integer(historySamples,2)||
    !finite(maxBodyBottomSpreadPx)||maxBodyBottomSpreadPx<0||
    !finite(minVerticalTravelPx)||minVerticalTravelPx<=maxBodyBottomSpreadPx||
    !integer(maxGapFrames,1)||!integer(roiLeft)||!integer(roiRight)||
    roiLeft>=roiRight||!integer(bodyScanTop)||!integer(bodyScanBottom)||
    bodyScanTop>=bodyScanBottom||terrainOptions===null||typeof terrainOptions!=='object'||
    Array.isArray(terrainOptions)||typeof inferOccludedIsland!=='boolean'||
    !integer(minIslandWidthSamples,2)||!finite(islandWidthTolerancePx)||
    islandWidthTolerancePx<0||!finite(occlusionBodyPaddingPx)||
    occlusionBodyPaddingPx<0||!finite(occlusionPositionTolerancePx)||
    occlusionPositionTolerancePx<0||!finite(maxIslandSpeedPxPerFrame)||
    maxIslandSpeedPxPerFrame<=0||!integer(maxOcclusionHoldFrames,1))
    throw Error('BOT_WATER_OBSERVATION_OPTIONS');
  const velocity=createIslandVelocityTracker({maxGapFrames});
  let identity=null,lastFrame=null,history=[],supportHistory=[];
  let islandWidth=null,widthSamples=0,islandTrack=null,pose=null;
  function clearBody(){history=[];supportHistory=[];}
  function clearIsland(){islandWidth=null;widthSamples=0;islandTrack=null;pose=null;}
  function reset(){identity=null;lastFrame=null;clearBody();clearIsland();velocity.reset();}
  const unknown=(frame,session,reason)=>({kind:'UNKNOWN',frame,session,reason,
    arthur:null,support:null,grounded:null,terrain:null,motion:null,
    confidence:null,calibrated:false,playing:'UNKNOWN',lifeKey:'UNKNOWN',
    bossDefeated:'UNKNOWN'});

  function trackIsland(terrain,frame){
    const island=terrain.island,bank=terrain.leftBank?.right;
    if(!island||!finite(bank))return;
    const relativeLeft=island.left-bank,dt=islandTrack?frame-islandTrack.frame:0;
    const speed=dt>0?(relativeLeft-islandTrack.relativeLeft)/dt:null;
    islandTrack={frame,relativeLeft,
      velocity:speed!==null&&Math.abs(speed)<=maxIslandSpeedPxPerFrame?speed:null};
  }

  // Body-relative extent from the latest frame whose island had edge evidence.
  function rememberPose(island,body,frame){
    pose=body.kind==='ARTHUR_SKIN_CANDIDATE'&&body.right>=island.left&&
      body.left<=island.right&&body.top<=island.topY&&
      body.bottom+occlusionBodyPaddingPx>=island.topY?
      {frame,seen:frame,offset:island.left-body.x,width:island.right-island.left+1,
        topY:island.topY,bodyTop:body.top}:null;
  }

  // Arthur plus a sprite drawn under him can hide BOTH outer edges for a
  // whole ride. Hold the last edge-anchored body-relative extent only while
  // current green pixels stay inside it and under the body, the head keeps
  // its height, and the time limit holds. Never a support claim by itself.
  function holdUnderOcclusion(terrain,body,frame){
    const missing={...terrain,island:null,hasWaterGap:false},held=pose;
    pose=null;
    // Body-relative, so it survives the departure bank scrolling out.
    if(!held||body.kind!=='ARTHUR_SKIN_CANDIDATE'||
      frame-held.seen<1||frame-held.seen>maxGapFrames||
      frame-held.frame>maxOcclusionHoldFrames||
      Math.abs(body.top-held.bodyTop)>maxBodyBottomSpreadPx)return missing;
    const left=Math.round(body.x+held.offset),right=left+held.width-1;
    const tolerance=islandWidthTolerancePx;
    const fragments=(terrain.islandFragments??[]).filter(f=>f.pixelEvidence>0&&
      f.right>=left-tolerance&&f.left<=right+tolerance);
    if(!fragments.length||
      fragments.some(f=>f.left<left-tolerance||f.right>right+tolerance)||
      !fragments.some(f=>f.right>=body.left&&f.left<=body.right))return missing;
    pose={...held,seen:frame};
    const island={left,right,topY:held.topY,
      pixelEvidence:fragments.reduce((n,f)=>n+f.pixelEvidence,0),
      extentEstimated:true,extentSource:'HELD_BODY_RELATIVE_UNDER_OCCLUSION',
      observedWidthPx:held.width,widthSamples,visibleFragments:fragments,
      edgeEvidenceFrame:held.frame,occludedFrames:frame-held.frame,calibrated:false};
    const result={...terrain,island,hasWaterGap:true};
    trackIsland(result,frame);return result;
  }

  function withOccludedIsland(terrain,body,frame){
    if(!inferOccludedIsland)return terrain;
    const observed=terrain.island;
    if(observed){
      const width=observed.right-observed.left+1;
      if(islandWidth===null||Math.abs(width-islandWidth)>islandWidthTolerancePx){
        if(widthSamples<minIslandWidthSamples){islandWidth=width;widthSamples=1;}
      }else widthSamples++;
      if(widthSamples<minIslandWidthSamples||
        Math.abs(width-islandWidth)<=islandWidthTolerancePx){
        trackIsland(terrain,frame);rememberPose(observed,body,frame);return terrain;
      }
      // A shortened >=14px component may itself be an occluded island.
      // Keep the previously established full width rather than relearning it.
    }
    const missing=()=>holdUnderOcclusion(terrain,body,frame);
    const bank=terrain.leftBank?.right,dt=islandTrack?frame-islandTrack.frame:0;
    if(widthSamples<minIslandWidthSamples||!islandTrack||!finite(bank)||
      dt<1||dt>maxGapFrames||body.kind!=='ARTHUR_SKIN_CANDIDATE')return missing();
    const topY=terrain.islandFragments?.[0]?.topY??196;
    const pad=occlusionBodyPaddingPx;
    if(body.top>topY||body.bottom+pad<topY)return missing();
    const predictedLeft=bank+islandTrack.relativeLeft+(islandTrack.velocity??0)*dt;
    const predictedRight=predictedLeft+islandWidth-1;
    const tolerance=occlusionPositionTolerancePx+maxIslandSpeedPxPerFrame*dt;
    if(body.right+pad<predictedLeft||body.left-pad>predictedRight)return missing();
    const fragments=(terrain.islandFragments??[]).filter(f=>
      f.left>=predictedLeft-tolerance&&f.right<=predictedRight+tolerance&&
      f.pixelEvidence>0).sort((a,b)=>a.left-b.left);
    if(!fragments.length)return missing();
    const leftEdge=fragments[0],rightEdge=fragments.at(-1),candidates=[];
    // A visible outer edge anchors position NOW; only the opposite, body-
    // covered edge is inferred from the old width. Never extrapolate without
    // current green pixels or when both outer edges are hidden by Arthur.
    if(leftEdge.left<body.left){
      const right=leftEdge.left+islandWidth-1;
      if(right>=body.left-pad&&right<=body.right+pad)
        candidates.push({left:leftEdge.left,right});
    }
    if(rightEdge.right>body.right){
      const left=rightEdge.right-islandWidth+1;
      if(left>=body.left-pad&&left<=body.right+pad)
        candidates.push({left,right:rightEdge.right});
    }
    const estimate=candidates.find(c=>Math.abs(c.left-predictedLeft)<=tolerance&&
      fragments.every(f=>f.left>=c.left-islandWidthTolerancePx&&
        f.right<=c.right+islandWidthTolerancePx));
    if(!estimate)return missing();
    const island={...estimate,topY,pixelEvidence:fragments.reduce((n,f)=>n+f.pixelEvidence,0),
      extentEstimated:true,extentSource:'CURRENT_FRAGMENTS_AND_PREVIOUS_WIDTH',
      observedWidthPx:islandWidth,widthSamples,visibleFragments:fragments,calibrated:false};
    const result={...terrain,island,hasWaterGap:true};
    trackIsland(result,frame);rememberPose(island,body,frame);return result;
  }

  function observe({frame,session,rgba,width=256,height=224}={}){
    if(!integer(frame)||typeof session!=='string'||!session)
      throw Error('BOT_WATER_OBSERVATION_FRAME');
    let resetReason=null;
    if(identity!==session){resetReason=identity===null?'FIRST_FRAME':'SESSION_CHANGED';
      clearBody();clearIsland();velocity.reset();lastFrame=null;identity=session;}
    if(lastFrame!==null&&frame<=lastFrame){
      clearBody();clearIsland();velocity.reset();return unknown(frame,session,'STALE_FRAME');
    }
    if(lastFrame!==null&&frame-lastFrame>maxGapFrames){
      resetReason='FRAME_GAP';clearBody();clearIsland();velocity.reset();
    }
    lastFrame=frame;
    const detectedTerrain=detectWaterTerrain({...terrainOptions,rgba,width,height});
    const body=detectArthurSkin({rgba,width,height,top:bodyScanTop,
      bottom:Math.min(bodyScanBottom,height-1),roiLeft,roiRight});
    const terrain=withOccludedIsland(detectedTerrain,body,frame);
    const motion={...velocity.observe({frame,session,terrain}),calibrated:false};
    const result={...unknown(frame,session,resetReason),terrain,motion};
    if(body.kind!=='ARTHUR_SKIN_CANDIDATE'){
      clearBody();return {...result,reason:body.reason};
    }
    const arthur={left:body.left,right:body.right,top:body.top,bottom:body.bottom,
      x:body.x,bodyBottom:body.bottom,
      feetYEstimate:bodyBottomToFeetPx===null?null:body.bottom+bodyBottomToFeetPx,
      confidence:null,verified:false};
    // The center of the body can be outside a platform while one visible
    // foot is supported. Keep separate bottom-pixel clusters rather than
    // treating the entire body rectangle as a contact point.
    const footGroups=[];
    for(let x=body.left;x<=body.right;x++){
      let hit=false;
      for(let y=Math.max(body.top,body.bottom-2);y<=body.bottom;y++){
        const i=(y*width+x)*4,r=rgba[i],g=rgba[i+1],b=rgba[i+2];
        if((r===170&&g===136&&b===102)||(r===204&&g===170&&b===136))hit=true;
      }
      if(!hit)continue;
      const group=footGroups.at(-1);
      if(!group||x-group.at(-1)>1)footGroups.push([x]);else group.push(x);
    }
    arthur.feetXEstimates=footGroups.map(xs=>xs.reduce((sum,x)=>sum+x,0)/xs.length);
    const coherentDirection=direction=>history.some(old=>{
      const top=body.top-old.top,bottom=body.bottom-old.bottom;
      return Math.abs(top)>=minVerticalTravelPx&&
        Math.abs(bottom)>=minVerticalTravelPx&&
        Math.sign(top)===direction&&Math.sign(bottom)===direction;
    });
    const upward=coherentDirection(-1),downward=coherentDirection(1);
    history.push({top:body.top,bottom:body.bottom});
    if(history.length>=historySamples)history.shift();
    let supportCandidate=null,supportPointX=null,supportSurface=null;
    if(arthur.feetYEstimate!==null){
      const near=y=>Math.abs(arthur.feetYEstimate-y)<=supportHeightTolerancePx;
      const bankFoot=arthur.feetXEstimates.find(x=>
        terrain.leftBank&&x<=terrain.leftBank.right-supportInsetPx);
      if(bankFoot!==undefined&&near(bankSurfaceY)){
        supportCandidate='BANK';supportPointX=bankFoot;
      }
      // Land beyond the departure bank, or any land once it has scrolled out.
      for(const segment of terrain.landSegments??[]){
        if(terrain.leftBank&&segment.left<=terrain.leftBank.right)continue;
        const landFoot=arthur.feetXEstimates.find(x=>
          x>=segment.left+supportInsetPx&&x<=segment.right-supportInsetPx);
        if(landFoot===undefined||!near(bankSurfaceY))continue;
        supportCandidate=supportCandidate===null?'RIGHT_BANK':'AMBIGUOUS';
        supportPointX=landFoot;supportSurface=segment;break;
      }
      const island=terrain.island;
      const islandFoot=arthur.feetXEstimates.find(x=>island&&
        x>=island.left+supportInsetPx&&x<=island.right-supportInsetPx);
      if(islandFoot!==undefined&&near(island.topY)){
        supportCandidate=supportCandidate===null?'ISLAND':'AMBIGUOUS';
        supportPointX=islandFoot;
      }
    }
    // A descending interval may end at a landing. Near a possible support,
    // await stability instead of calling the CURRENT frame airborne solely
    // because the previous image was higher. Upward motion remains airborne.
    const airborne=upward||(downward&&supportCandidate===null);
    if(airborne||supportCandidate===null||supportCandidate==='AMBIGUOUS')supportHistory=[];
    else{
      if(supportHistory[0]?.support!==supportCandidate)supportHistory=[];
      supportHistory.push({support:supportCandidate,bottom:body.bottom});
      if(supportHistory.length>minSupportSamples)supportHistory.shift();
    }
    const bottoms=supportHistory.map(o=>o.bottom);
    const stable=bottoms.length>=minSupportSamples&&
      Math.max(...bottoms)-Math.min(...bottoms)<=maxBodyBottomSpreadPx;
    const grounded=airborne?false:stable?true:null;
    const support=grounded===true?supportCandidate:null;
    return {...result,kind:'WATER_OBSERVATION_CANDIDATE',arthur,support,grounded,
      supportPointX:support===null?null:supportPointX,
      supportSurface:support==='RIGHT_BANK'?supportSurface:null,
      reason:airborne?'COHERENT_VERTICAL_MOTION':stable?'TEMPORAL_SUPPORT_CANDIDATE':
        bodyBottomToFeetPx===null?'FOOT_OFFSET_UNCALIBRATED':
        supportCandidate===null?'NO_SUPPORT_CANDIDATE':'SUPPORT_NOT_YET_STABLE',
      evidence:{supportSamples:supportHistory.length,supportCandidate,
        bodyBottomSpreadPx:bottoms.length?Math.max(...bottoms)-Math.min(...bottoms):null,
        bodyBottomToFeetPx,resetReason}};
  }
  return {observe,reset};
}
