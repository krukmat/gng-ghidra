/** Water crossing policy: original P1 controls only, no engine/RAM access.
 * Consumes *visually confirmed* observations in screen pixels.
 * Does not detect sprites or platforms: calibrate upstream on private captures.
 * A moving target, jump duration and Arthur SCREEN-x speed must be demonstrated;
 * untrusted/late data causes STOP, never a blind attempt.
 */
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const integer=(x,min=1)=>Number.isSafeInteger(x)&&x>=min;
const unknown=(phase,reason)=>({phase,action:'neutral',reason});

export function createWaterCrossingPolicy({
  flightFrames,runSpeedPxPerFrame,minConfidence=0.90,
  approachRangePx=64,takeoffBufferPx=15,
  landingMarginPx=4,landingHeightTolerancePx=10,
  jumpHoldFrames=4,landingGraceFrames=8,
  maxObservationGap=12,maxPlatformSpeedPxPerFrame=3,
  minPlatformDisplacementPx=1,maxWaitFrames=120,
}={}){
  if(!integer(flightFrames)||!finite(runSpeedPxPerFrame)||runSpeedPxPerFrame<0||
    !finite(minConfidence)||minConfidence<0||minConfidence>1||
    !finite(approachRangePx)||approachRangePx<=0||
    !finite(takeoffBufferPx)||takeoffBufferPx<=0||takeoffBufferPx>=approachRangePx||
    !finite(landingMarginPx)||landingMarginPx<0||
    !finite(landingHeightTolerancePx)||landingHeightTolerancePx<0||
    !integer(jumpHoldFrames)||jumpHoldFrames>=flightFrames||
    !integer(landingGraceFrames,0)||!integer(maxObservationGap)||
    !finite(maxPlatformSpeedPxPerFrame)||maxPlatformSpeedPxPerFrame<=0||
    !finite(minPlatformDisplacementPx)||minPlatformDisplacementPx<0||
    !integer(maxWaitFrames))throw Error('BOT_WATER_CALIBRATION_REQUIRED');
  let state='OBSERVE',last=null,lastPlatform=null,velocity=null,motionEvidence=0;
  let landingEvidence=0;
  let waitStart=null,jumpStart=null,projectedLandingX=null;
  let completed=false,stopReason=null;
  const reset=()=>{
    state='OBSERVE';last=null;lastPlatform=null;velocity=null;motionEvidence=0;
    landingEvidence=0;
    waitStart=null;jumpStart=null;projectedLandingX=null;
    completed=false;stopReason=null;
  };
  function stop(reason){state='STOP';stopReason=reason;return unknown('STOP',reason);}
  function observe(o){
    if(!o||!integer(o.frame,0))throw Error('BOT_WATER_FRAME');
    if(state==='STOP')return unknown('STOP',stopReason);
    if(completed)return unknown('LANDED','LANDING_CONFIRMED_CONTROL_RETURNED');
    const {frame,session,lifeKey,arthur,water,platform,playing}=o;
    if(typeof session!=='string'||!session||
      !((typeof lifeKey==='string'&&lifeKey)||(integer(lifeKey,0)))||
      playing!==true||!arthur||!water||!platform||
      ![arthur.x,arthur.feetY,arthur.confidence,
        water.left,water.right,water.confidence,
        platform.left,platform.right,platform.topY,platform.confidence].every(finite)||
      arthur.confidence<minConfidence||water.confidence<minConfidence||
      platform.confidence<minConfidence||
      water.left>=water.right||platform.left>=platform.right||
      !Number.isFinite(frame)||typeof arthur.grounded!=='boolean')
      return stop('OBSERVATION_UNKNOWN');
    if(last&&(session!==last.session||lifeKey!==last.lifeKey))
      return stop('SESSION_OR_LIFE_CHANGED');
    const delta=last?frame-last.frame:0;
    if(last&&(delta<1||delta>maxObservationGap))
      return stop('STALE_FRAME');
    const center=(platform.left+platform.right)/2;
    if(lastPlatform){
      const instantaneous=(center-lastPlatform.center)/delta;
      if(Math.abs(instantaneous)>maxPlatformSpeedPxPerFrame)
        return stop('PLATFORM_TRACK_UNRELIABLE');
      // Detect velocity only when a physically meaningful displacement occurred.
      if(Math.abs(center-lastPlatform.center)>=minPlatformDisplacementPx&&
         Math.abs(instantaneous)>1e-6){
        motionEvidence=(velocity===null||Math.sign(velocity)===Math.sign(instantaneous))?
          motionEvidence+1:1;
        velocity=instantaneous;
      }else{
        motionEvidence=0;velocity=null;
      }
    }
    lastPlatform={center};
    last={frame,session,lifeKey};
    const distance=water.left-arthur.x;
    if(state==='OBSERVE'||state==='APPROACH'||state==='WAIT'){
      if(!arthur.grounded)return stop('TAKEOFF_NOT_GROUNDED');
      if(distance>approachRangePx){
        state='OBSERVE';waitStart=null;
        return unknown('OUTSIDE_ZONE','REGULAR_POLICY_RETAINS_CONTROL');
      }
      if(distance>takeoffBufferPx){
        state='APPROACH';waitStart=null;
        return {phase:'APPROACH',action:'right',reason:'APPROACH_FROM_SAFE_GROUND'};
      }
      // Negative distance past the bank means we may already be falling.
      if(distance<0)return stop('ALREADY_OVER_WATER');
      if(waitStart===null)waitStart=frame;
      state='WAIT';
      if(frame-waitStart>maxWaitFrames)return stop('PLATFORM_INTERCEPT_TIMEOUT');
      if(velocity===null||motionEvidence<2)
        return unknown('WAIT','PLATFORM_MOTION_UNCONFIRMED');
      if(Math.abs(platform.topY-arthur.feetY)>landingHeightTolerancePx)
        return unknown('WAIT','LANDING_HEIGHT_NOT_CALIBRATED');
      const shift=velocity*flightFrames;
      const projected=arthur.x+runSpeedPxPerFrame*flightFrames;
      const left=platform.left+shift+landingMarginPx;
      const right=platform.right+shift-landingMarginPx;
      if(left>right||projected<left||projected>right)
        return unknown('WAIT','NO_SAFE_INTERCEPT');
      jumpStart=frame;projectedLandingX=projected;state='AIRBORNE';
      return {phase:'TAKEOFF',action:'right_jump',reason:'PREDICTED_PLATFORM_INTERCEPT',
        projectedLandingX,platformVelocity:velocity};
    }
    if(state==='AIRBORNE'){
      const elapsed=frame-jumpStart;
      if(elapsed>flightFrames+landingGraceFrames)return stop('LANDING_NOT_CONFIRMED');
      const landingCandidate=elapsed>=flightFrames-jumpHoldFrames&&
        arthur.grounded&&
        arthur.x>=platform.left+landingMarginPx&&
        arthur.x<=platform.right-landingMarginPx&&
        Math.abs(arthur.feetY-platform.topY)<=landingHeightTolerancePx;
      if(landingCandidate){
        landingEvidence++;
        if(landingEvidence>=2){
          completed=true;state='LANDED';
          return {phase:'LANDED',action:'neutral',reason:'VISUAL_GROUNDED_ON_PLATFORM',
            projectedLandingX};
        }
        return unknown('AIRBORNE','LANDING_CONFIRMATION_PENDING');
      }
      landingEvidence=0;
      return {phase:'AIRBORNE',action:elapsed<jumpHoldFrames?'right_jump':'right',
        reason:'ONE_CONTROLLED_JUMP'};
    }
    return stop('UNEXPECTED_STATE');
  }
  return {observe,reset};
}
