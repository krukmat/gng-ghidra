/** Pixel-derived displacement only. No RAM, no world-coordinate oracle.
 * screenX is Arthur's detected pixel x; scrollDelta is visual camera motion
 * since the previous accepted image (positive when the camera moves right).
 * lifeKey must come from independently confirmed visual life boundaries.
 */
export function createVisualProgressTracker({minConfidence=0.9,
  windowFrames=120,minAdvancePx=8,plateauTolerancePx=8,
  maxGapFrames=12,maxMotionPxPerFrame=12}={}){
  const finite=x=>typeof x==='number'&&Number.isFinite(x);
  if(!finite(minConfidence)||minConfidence<0||minConfidence>1||
     !Number.isSafeInteger(windowFrames)||windowFrames<1||
     !finite(minAdvancePx)||minAdvancePx<=0||
     !finite(plateauTolerancePx)||plateauTolerancePx<0||
     !Number.isSafeInteger(maxGapFrames)||maxGapFrames<1||
     !finite(maxMotionPxPerFrame)||maxMotionPxPerFrame<=0)
    throw Error('BOT_VISUAL_PROGRESS_OPTIONS');
  let last=null,relativeX=0,maxRelativeX=0,history=[];
  const clear=()=>{last=null;relativeX=0;maxRelativeX=0;history=[];};
  const unknown=(frame,reason)=>({frame,label:'UNKNOWN',reason,
    relativeX:null,maxRelativeX:null,windowFrames:0});
  function observe({frame,session,lifeKey,screenX,scrollDelta,
    confidence,playing}={}){
    if(!Number.isSafeInteger(frame)||frame<0)
      throw Error('BOT_VISUAL_PROGRESS_FRAME');
    const valid=(typeof session==='string'&&session.length>0)&&
      ((typeof lifeKey==='string'&&lifeKey.length>0)||
       (Number.isSafeInteger(lifeKey)&&lifeKey>=0))&&
      finite(screenX)&&screenX>=0&&screenX<256&&
      finite(scrollDelta)&&finite(confidence)&&
      confidence>=minConfidence&&confidence<=1&&playing===true;
    if(!valid){clear();return unknown(frame,'UNCONFIRMED_OBSERVATION');}
    if(!last||last.session!==session||last.lifeKey!==lifeKey){
      clear();
      last={frame,session,lifeKey,screenX};
      history.push({frame,x:0});
      return {frame,label:'UNKNOWN',reason:'NEW_ANCHOR',
        relativeX:0,maxRelativeX:0,windowFrames:0};
    }
    const gap=frame-last.frame;
    if(gap<=0||gap>maxGapFrames){
      clear();
      return unknown(frame,'STALE_OR_GAPPED_FRAME');
    }
    const dx=screenX-last.screenX+scrollDelta;
    if(Math.abs(dx)>maxMotionPxPerFrame*gap){
      clear();
      return unknown(frame,'IMPLAUSIBLE_MOTION');
    }
    const previousMax=maxRelativeX;
    relativeX+=dx;
    maxRelativeX=Math.max(maxRelativeX,relativeX);
    last={frame,session,lifeKey,screenX};
    history.push({frame,x:relativeX});
    const cutoff=frame-windowFrames;
    while(history.length>1&&history[1].frame<=cutoff)history.shift();
    const span=frame-history[0].frame;
    let label='UNKNOWN',reason='INSUFFICIENT_WINDOW';
    if(span>=windowFrames){
      const positions=history.map(x=>x.x);
      const spread=Math.max(...positions)-Math.min(...positions);
      const net=relativeX-history[0].x;
      if(net>=minAdvancePx&&relativeX>previousMax){
        label='ADVANCE_CANDIDATE';reason='VISUAL_NET_NEW_PROGRESS';
      }else if(spread<=plateauTolerancePx){
        label='PLATEAU_CANDIDATE';reason='VISUAL_WINDOW_STATIONARY';
      }else reason='NO_CONFIRMED_NEW_PROGRESS';
    }
    return {frame,label,reason,relativeX,maxRelativeX,
      windowFrames:span};
  }
  return {observe,reset:clear};
}
