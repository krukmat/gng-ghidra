/** Read-only episode metrics. Stage bytes are candidates, never clear signals. */

const integer=(value,name,min=0)=>{
  if(!Number.isSafeInteger(value)||value<min)
    throw Error('BOT_EVALUATION_INVALID_'+name);
  return value;
};

export function createEvaluation({startFrame,initialLives=3,initialStage=1,
  checkpointEvery=100}={}){
  integer(startFrame,'START_FRAME');
  integer(initialLives,'INITIAL_LIVES');
  integer(initialStage,'INITIAL_STAGE');
  integer(checkpointEvery,'CHECKPOINT_EVERY',1);
  let lastFrame=null,previousWorld=null,endLives=initialLives,
    endStage=initialStage,maxWorld=null,finalWorld=null,firstLifeLossFrame=null,
    livesLost=0,positionResets=0,knownSamples=0,allKnown=true,
    nextCheckpoint=startFrame,finished=false;
  const stageCandidateChanges=[],checkpoints=[];

  function observe({frame,world,y,lives,stage,known=true}={}){
    if(finished)throw Error('BOT_EVALUATION_FINISHED');
    integer(frame,'FRAME');
    // The reset-to-prefix replay is intentionally outside this segment.
    if(frame<startFrame)return;
    if(lastFrame!==null&&frame<=lastFrame)
      throw Error('BOT_EVALUATION_FRAME_ORDER');
    if(typeof known!=='boolean')throw Error('BOT_EVALUATION_INVALID_KNOWN');
    lastFrame=frame;
    if(!known){allKnown=false;return;}
    integer(world,'WORLD');
    if(!Number.isSafeInteger(y))throw Error('BOT_EVALUATION_INVALID_Y');
    integer(lives,'LIVES');
    integer(stage,'STAGE');
    knownSamples++;
    const lost=Math.max(0,endLives-lives);
    if(lost){
      livesLost+=lost;
      if(firstLifeLossFrame===null)firstLifeLossFrame=frame;
    }
    // A later respawn or credit must not extend this life's spatial maximum.
    if(firstLifeLossFrame===null)
      maxWorld=maxWorld===null?world:Math.max(maxWorld,world);
    if(previousWorld!==null&&previousWorld-world>256)positionResets++;
    if(stage!==endStage)stageCandidateChanges.push({frame,from:endStage,to:stage});
    previousWorld=world;finalWorld=world;endLives=lives;endStage=stage;
    if(frame>=nextCheckpoint){
      checkpoints.push({frame,world,y,lives,stage});
      nextCheckpoint=startFrame+
        (Math.floor((frame-startFrame)/checkpointEvery)+1)*checkpointEvery;
    }
  }

  function finish({status,frames,pc=null,bank=null}={}){
    if(finished)throw Error('BOT_EVALUATION_FINISHED');
    if(typeof status!=='string'||!status)throw Error('BOT_EVALUATION_INVALID_STATUS');
    integer(frames,'FRAMES');
    if(lastFrame!==null&&frames<lastFrame)throw Error('BOT_EVALUATION_FRAME_ORDER');
    finished=true;
    return {
      status,frames,pc,bank,startFrame,initialLives,endLives,
      known:allKnown&&knownSamples>0,maxWorld,finalWorld,
      firstLifeLossFrame,livesLost,
      survivalFrames:Math.max(0,(firstLifeLossFrame??frames)-startFrame),
      positionResets,
      stageCandidateChanges:stageCandidateChanges.map(x=>({...x})),
      checkpoints:checkpoints.map(x=>({...x})),
    };
  }
  return {observe,finish};
}

/** Array.sort comparator: negative means a is preferable. No victory inference. */
export function compareEvaluations(a,b){
  const complete=x=>Number(x.status==='FRAMES_DONE');
  const observed=x=>Number(x.known===true);
  const value=x=>Number.isFinite(x)?x:-Infinity;
  return complete(b)-complete(a)||observed(b)-observed(a)||
    a.livesLost-b.livesLost||value(b.finalWorld)-value(a.finalWorld)||
    value(b.maxWorld)-value(a.maxWorld)||b.survivalFrames-a.survivalFrames||0;
}
