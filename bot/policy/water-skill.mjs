/** First-platform skill driven only by temporal pixel observations.
 * Support is a measured visual candidate, never a claim about lives or kills.
 * Actions are held P1 buttons; the caller releases them on STOP or shutdown.
 */
export function createWaterSkill({flightFrames,runSpeedPxPerFrame,
  takeoffBufferPx=16,landingMarginPx=4,boardingInsetPx=8,
  boardingFraction=0.65,maxBoardingFrames=20,
  jumpHoldFrames=5,runLeadFrames=4,
  landingGraceFrames=14,maxWaitFrames=600,maxMissingFrames=12,
  motionWindowFrames=6,maxPlatformSpeedPxPerFrame=2,hopMaxDistancePx=null}={}){
  const positive=n=>Number.isFinite(n)&&n>0;
  if(!Number.isSafeInteger(flightFrames)||flightFrames<2||
    !positive(runSpeedPxPerFrame)||!positive(takeoffBufferPx)||
    !positive(landingMarginPx)||!positive(boardingInsetPx)||
    !positive(boardingFraction)||boardingFraction>=1||
    !Number.isSafeInteger(maxBoardingFrames)||maxBoardingFrames<1||
    !Number.isSafeInteger(jumpHoldFrames)||
    jumpHoldFrames<1||jumpHoldFrames>=flightFrames||
    !Number.isSafeInteger(runLeadFrames)||runLeadFrames<1||
    !Number.isSafeInteger(landingGraceFrames)||landingGraceFrames<1||
    !Number.isSafeInteger(maxWaitFrames)||maxWaitFrames<1||
    !Number.isSafeInteger(maxMissingFrames)||maxMissingFrames<1||
    !Number.isSafeInteger(motionWindowFrames)||motionWindowFrames<2||
    !positive(maxPlatformSpeedPxPerFrame)||
    (hopMaxDistancePx!==null&&!positive(hopMaxDistancePx)))throw Error('BOT_WATER_SKILL_CALIBRATION');
  let session=null,lastFrame=null,phase='ACQUIRE',waitStart=null,
    jumpStart=null,missingStart=null,positions=[],landingSamples=0,
    runStart=null,supportLostAt=null,boardingStart=null,centered=false;
  function reset(){session=null;lastFrame=null;phase='ACQUIRE';waitStart=null;
    jumpStart=null;missingStart=null;positions=[];landingSamples=0;
    runStart=null;supportLostAt=null;boardingStart=null;centered=false;}
  const result=(action,reason,extra={})=>({action,phase,reason,...extra});
  // After boarding the departure bank may scroll out; these phases use only
  // the body, the held island and the far bank.
  const AFTER_BOARDING=new Set(['LANDED','HOP_RUNUP','HOP_AIRBORNE','ASHORE']);
  function stop(reason){phase='STOP';return result('neutral',reason);}
  function step(o){
    if(!o||!Number.isSafeInteger(o.frame)||typeof o.session!=='string'||!o.session)
      throw Error('BOT_WATER_SKILL_OBSERVATION');
    if(phase==='STOP')return result('neutral','RESET_REQUIRED');
    if(session!==null&&session!==o.session)return stop('SESSION_CHANGED');
    if(lastFrame!==null&&(o.frame<=lastFrame||o.frame-lastFrame>maxMissingFrames))
      return stop('STALE_OR_GAPPED_FRAME');
    session=o.session;lastFrame=o.frame;
    const body=o.arthur,bank=o.terrain?.leftBank,island=o.terrain?.island;
    if(!body||!Number.isFinite(body.x)||(!bank&&!AFTER_BOARDING.has(phase))){
      positions=[];landingSamples=0;
      if(missingStart===null)missingStart=o.frame;
      if(o.frame-missingStart>=maxMissingFrames)return stop('PLAYER_OR_BANK_LOST');
      // A brief occlusion during an already committed jump does not invent
      // contact or trigger a second jump. The macro expires below.
      if((phase==='AIRBORNE'||phase==='HOP_AIRBORNE')&&
        o.frame-jumpStart<=flightFrames+landingGraceFrames)
        return result(o.frame-jumpStart<jumpHoldFrames?'right_jump':'right',
          'JUMP_OBSERVATION_TEMPORARILY_MISSING');
      return result('neutral','ACQUIRING_VISUAL_TRACK');
    }
    missingStart=null;
    if(phase==='LANDED'){
      if(o.support==='ISLAND'&&o.grounded===true)supportLostAt=null;
      else if(supportLostAt===null)supportLostAt=o.frame;
      if(supportLostAt!==null&&o.frame-supportLostAt>=maxMissingFrames)
        return stop('POST_LANDING_SUPPORT_LOST');
      // Second hop: only from observed island support, toward a far bank
      // whose visible edge is within the calibrated run-up + jump range.
      const far=o.terrain?.rightBank,distance=far?far.left-body.x:null;
      if(hopMaxDistancePx!==null&&supportLostAt===null&&Number.isFinite(distance)&&
        distance>=0&&distance<=hopMaxDistancePx){
        phase='HOP_RUNUP';runStart=o.frame;
        return result('right','RIGHT_BANK_IN_HOP_RANGE',{distance});
      }
      return result('neutral',supportLostAt===null?'ISLAND_SUPPORT_OBSERVED':
        'POST_LANDING_SUPPORT_UNCERTAIN');
    }
    if(phase==='HOP_RUNUP'){
      if(o.frame-runStart>=runLeadFrames){
        jumpStart=o.frame;phase='HOP_AIRBORNE';landingSamples=0;
        return result('right_jump','RUNUP_BEFORE_SECOND_JUMP');
      }
      return result('right','ESTABLISH_HORIZONTAL_MOVEMENT');
    }
    if(phase==='HOP_AIRBORNE'){
      const elapsed=o.frame-jumpStart;
      if(elapsed>flightFrames+landingGraceFrames)
        return stop('RIGHT_BANK_LANDING_NOT_OBSERVED');
      if(o.support==='RIGHT_BANK'&&o.grounded===true&&
        elapsed>=flightFrames-jumpHoldFrames){
        if(++landingSamples>=2){phase='ASHORE';supportLostAt=null;
          return result('right','TEMPORAL_RIGHT_BANK_SUPPORT',{jumpElapsed:elapsed});}
      }else landingSamples=0;
      return result(elapsed<jumpHoldFrames?'right_jump':'right',
        'COMMITTED_SECOND_JUMP',{jumpElapsed:elapsed});
    }
    if(phase==='ASHORE'){
      // Once the reached land touches the screen's left edge the observer
      // relabels it as the departure BANK: same land, same surface height.
      if((o.support==='RIGHT_BANK'||o.support==='BANK')&&o.grounded===true)
        supportLostAt=null;
      else if(supportLostAt===null)supportLostAt=o.frame;
      if(supportLostAt!==null&&o.frame-supportLostAt>=maxMissingFrames)
        return stop('RIGHT_BANK_SUPPORT_LOST');
      // Walking animation can briefly withhold grounded; the visible land
      // segment under the body still bounds the advance before the next gap.
      const land=(o.terrain?.landSegments??[]).find(s=>s.left<=body.x&&s.right>=body.x);
      if(!land)return result('neutral','LAND_UNDER_BODY_NOT_VISIBLE');
      if(land.right-body.x<=takeoffBufferPx)
        return result('neutral','HOLD_BEFORE_LAND_EDGE',{edgeDistance:land.right-body.x});
      return result('right',supportLostAt===null?'ADVANCE_ON_LAND':
        'ADVANCE_SUPPORT_UNCERTAIN');
    }
    if(island){
      const relative=(island.left+island.right)/2-bank.right;
      positions.push({frame:o.frame,relative});
      while(positions.length>1&&o.frame-positions[0].frame>motionWindowFrames)
        positions.shift();
    }else positions=[];
    const first=positions[0],latest=positions.at(-1);
    const span=first?latest.frame-first.frame:0;
    const velocity=span>=motionWindowFrames?
      (latest.relative-first.relative)/span:null;
    if(phase==='BOARDING'){
      if(o.frame-boardingStart>maxBoardingFrames)return stop('BOARDING_NOT_CENTERED');
      if(!island)return result('neutral','BOARDING_PLATFORM_NOT_VISIBLE');
      const target=island.left+(island.right-island.left)*boardingFraction;
      if(body.x>=target&&body.x<=island.right-landingMarginPx)centered=true;
      if(centered&&o.support==='ISLAND'&&o.grounded===true){phase='LANDED';
        return result('neutral','CENTERED_ISLAND_SUPPORT');}
      return result(centered?'neutral':'right',centered?
        'AWAIT_CENTERED_SUPPORT':'MOVE_CLEAR_OF_PLATFORM_EDGE');
    }
    if(phase==='RUNUP'){
      if(o.frame-runStart>=runLeadFrames){
        jumpStart=o.frame;phase='AIRBORNE';
        return result('right_jump','RUNUP_BEFORE_JUMP');
      }
      return result('right','ESTABLISH_HORIZONTAL_MOVEMENT');
    }
    if(phase==='AIRBORNE'){
      const elapsed=o.frame-jumpStart;
      if(elapsed>flightFrames+landingGraceFrames)return stop('LANDING_NOT_OBSERVED');
      const contactX=Number.isFinite(o.supportPointX)?o.supportPointX:body.x;
      const landed=o.support==='ISLAND'&&o.grounded===true&&island&&
        contactX>=island.left+boardingInsetPx&&contactX<=island.right-boardingInsetPx;
      if(landed&&elapsed>=flightFrames-jumpHoldFrames){
        landingSamples++;
        if(landingSamples>=2){phase='BOARDING';boardingStart=o.frame;
          return result('right','TEMPORAL_ISLAND_SUPPORT', {jumpElapsed:elapsed});}
      }else landingSamples=0;
      return result(elapsed<jumpHoldFrames?'right_jump':'right','COMMITTED_SINGLE_JUMP',
        {jumpElapsed:elapsed});
    }
    if(o.support!=='BANK'||o.grounded!==true)
      return result('neutral','BANK_SUPPORT_NOT_YET_OBSERVED');
    const distance=bank.right-body.x;
    if(distance<0)return stop('PLAYER_PAST_DEPARTURE_BANK');
    if(distance>takeoffBufferPx){phase='APPROACH';
      return result('right','APPROACH_VISUAL_EDGE',{distance});}
    phase='WAIT';
    if(waitStart===null)waitStart=o.frame;
    if(o.frame-waitStart>maxWaitFrames)return stop('INTERCEPT_WAIT_TIMEOUT');
    if(!island||velocity===null||Math.abs(velocity)>maxPlatformSpeedPxPerFrame)
      return result('neutral','PLATFORM_MOTION_NOT_TRACKED');
    const horizon=flightFrames+runLeadFrames;
    const landingRelative=-distance+runSpeedPxPerFrame*horizon;
    const left=island.left-bank.right+velocity*horizon+landingMarginPx;
    const right=island.right-bank.right+velocity*horizon-landingMarginPx;
    if(landingRelative<left||landingRelative>right)
      return result('neutral','WAIT_FOR_REACHABLE_PLATFORM',{velocity,distance});
    runStart=o.frame;phase='RUNUP';
    return result('right','PIXEL_INTERCEPT_WITH_RUNUP',{velocity,distance,landingRelative});
  }
  return {step,reset};
}
