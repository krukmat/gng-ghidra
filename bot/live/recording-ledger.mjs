/** Deterministic bookkeeping for a recorded native RGBA session.
 * No game control, ROM, rendering or privileged memory access.
 */
const integer=(v,min=0)=>Number.isSafeInteger(v)&&v>=min;
export function createFrameLedger({width=256,height=224}={}){
  if(!integer(width,1)||!integer(height,1))throw Error('BOT_RECORD_SIZE');
  let last=null;
  let duplicates=0,skippedEngineFrames=0,sessionChanges=0;
  const frames=[];
  function accept({session,engineFrame,wallMs,bytes}={}){
    if(!integer(session)||!integer(engineFrame,1)||!integer(wallMs)||
       !(bytes instanceof Uint8Array)&&!Buffer.isBuffer(bytes)||
       bytes?.length!==width*height*4)
      throw Error('BOT_RECORD_FRAME_INVALID');
    if(last&&last.session===session&&engineFrame<last.engineFrame)
      throw Error('BOT_RECORD_FRAME_REGRESSION');
    if(last&&last.session!==session)sessionChanges++;
    if(last&&last.session===session){
      if(engineFrame===last.engineFrame)duplicates++;
      else skippedEngineFrames+=Math.max(0,engineFrame-last.engineFrame-1);
    }
    frames.push({index:frames.length,session,engineFrame,wallMs,
      repeated:!!last&&last.session===session&&engineFrame===last.engineFrame});
    last={session,engineFrame};
    return frames.length-1;
  }
  function report(){return {width,height,samples:frames.length,duplicates,
    skippedEngineFrames,sessionChanges,frames:[...frames]};}
  return {accept,report};
}
