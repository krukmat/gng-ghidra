/** Second hop from visually confirmed moving island to right-hand land.
 * Single controlled jump; requires independently calibrated visual input.
 */
const num=x=>typeof x==='number'&&Number.isFinite(x);
const integer=(x,min=1)=>Number.isSafeInteger(x)&&x>=min;
const unknown=(phase,reason)=>({phase,action:'neutral',reason});
export function createMainlandHopPolicy({flightFrames,runSpeedPxPerFrame,
  minConfidence=0.9,landingMarginPx=4,landingHeightTolerancePx=12,
  jumpHoldFrames=4,maxWaitFrames=150,maxFrameGap=12,
  landingGraceFrames=8}={}){
  if(!integer(flightFrames)||!num(runSpeedPxPerFrame)||runSpeedPxPerFrame<0||
     !num(minConfidence)||minConfidence<=0||minConfidence>1||
     !num(landingMarginPx)||landingMarginPx<0||
     !num(landingHeightTolerancePx)||landingHeightTolerancePx<0||
     !integer(jumpHoldFrames)||jumpHoldFrames>=flightFrames||
     !integer(maxWaitFrames)||!integer(maxFrameGap)||
     !integer(landingGraceFrames,0))throw Error('BOT_MAINLAND_CALIBRATION_REQUIRED');
  let last=null,state='WAIT',waitStart=null,jumpStart=null,confirmed=0;
  let stopReason=null;
  const stop=reason=>{state='STOP';stopReason=reason;return unknown('STOP',reason);};
  function reset(){last=null;state='WAIT';waitStart=null;jumpStart=null;
    confirmed=0;stopReason=null;}
  function observe(o){
    if(!o||!integer(o.frame,0))throw Error('BOT_MAINLAND_FRAME');
    if(state==='STOP')return unknown('STOP',stopReason);
    if(state==='LANDED')return unknown('LANDED','RIGHT_BANK_CONFIRMED');
    const {frame,session,lifeKey,playing,arthur,island,land}=o;
    if(typeof session!=='string'||!session||
      !((typeof lifeKey==='string'&&lifeKey)||(integer(lifeKey,0)))||
      playing!==true||!arthur||!island||!land||
      ![arthur.x,arthur.feetY,arthur.confidence,
        island.left,island.right,island.topY,island.confidence,
        land.left,land.right,land.topY,land.confidence].every(num)||
      arthur.confidence<minConfidence||island.confidence<minConfidence||
      land.confidence<minConfidence||
      island.left>=island.right||land.left>=land.right||
      typeof arthur.grounded!=='boolean')return stop('OBSERVATION_UNKNOWN');
    if(last&&(last.session!==session||last.lifeKey!==lifeKey))
      return stop('SESSION_OR_LIFE_CHANGED');
    if(last&&(frame<=last.frame||frame-last.frame>maxFrameGap))
      return stop('STALE_FRAME');
    last={frame,session,lifeKey};
    if(state==='WAIT'){
      if(waitStart===null)waitStart=frame;
      if(frame-waitStart>maxWaitFrames)return stop('MAINLAND_INTERCEPT_TIMEOUT');
      if(!arthur.grounded||arthur.x<island.left+landingMarginPx||
         arthur.x>island.right-landingMarginPx||
         Math.abs(arthur.feetY-island.topY)>landingHeightTolerancePx)
        return stop('NOT_GROUNDED_ON_ISLAND');
      const projected=arthur.x+runSpeedPxPerFrame*flightFrames;
      if(projected<land.left+landingMarginPx||
         projected>land.right-landingMarginPx||
         Math.abs(land.topY-island.topY)>landingHeightTolerancePx)
        return unknown('WAIT','RIGHT_BANK_NOT_IN_JUMP_RANGE');
      state='AIRBORNE';jumpStart=frame;
      return {phase:'TAKEOFF_MAINLAND',action:'right_jump',
        reason:'PREDICTED_RIGHT_BANK_INTERCEPT',projectedLandingX:projected};
    }
    const elapsed=frame-jumpStart;
    if(elapsed>flightFrames+landingGraceFrames)
      return stop('RIGHT_BANK_LANDING_NOT_CONFIRMED');
    const onBank=elapsed>=flightFrames-jumpHoldFrames&&arthur.grounded&&
      arthur.x>=land.left+landingMarginPx&&
      arthur.x<=land.right-landingMarginPx&&
      Math.abs(arthur.feetY-land.topY)<=landingHeightTolerancePx;
    confirmed=onBank?confirmed+1:0;
    if(confirmed>=2){state='LANDED';return unknown('LANDED','RIGHT_BANK_CONFIRMED');}
    return {phase:'AIRBORNE_MAINLAND',action:elapsed<jumpHoldFrames?
      'right_jump':'right',reason:onBank?'VERIFY_BANK_CONTACT':'SINGLE_SECOND_JUMP'};
  }
  return {observe,reset};
}
