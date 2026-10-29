/** Audio-led frame pacing and wall-clock fallback for a browser engine host.
 * All clock rates, frame/sample ratios and queue policy come from the board.
 */
export function createFramePacer({frameMs,sourceSampleRate,samplesPerFrame,
  leadFrames,maxBehindFrames=30,clockLostMs=250,startWaitMs=1000,
  initialFrame=0,now=()=>performance.now()}={}){
  const positive=x=>Number.isFinite(x)&&x>0;
  if(![frameMs,sourceSampleRate,samplesPerFrame,leadFrames,maxBehindFrames,
    clockLostMs,startWaitMs].every(positive)||
    !Number.isSafeInteger(initialFrame)||initialFrame<0||typeof now!=='function')
    throw Error('FRAME_PACER_CONFIG_INVALID');
  const sampleMs=1000/sourceSampleRate,lead=leadFrames*samplesPerFrame;
  let anchor=now()-initialFrame*frameMs,slips=0,paced=false,fillLead=false;
  let clock=null;
  const consumed=at=>clock.last.sample+Math.min(at-clock.last.at,40)/sampleMs;
  return Object.freeze({
    reset(frame,at=now()){
      if(!Number.isSafeInteger(frame)||frame<0)throw Error('FRAME_PACER_FRAME_INVALID');
      anchor=at-frame*frameMs;slips=0;paced=false;
    },
    open({sessionId,latencyMs=0,port=null}={}){
      clock?.port?.close();
      clock=sessionId==null?null:{sessionId,latency:latencyMs/sampleMs,
        port,last:null,startFrame:null,openedAt:null};
      fillLead=clock!==null;
      if(clock&&port)port.onmessage=({data:m})=>{
        if(m?.type!=='clock'||m.sessionId!==clock?.sessionId)return;
        clock.last=m.state==='PLAYING'?{sample:m.sample,at:now()}:null;
      };
    },
    latency(sessionId,latencyMs){
      if(clock?.sessionId===sessionId)clock.latency=latencyMs/sampleMs;
    },
    select(at,done,latest,heard,audioDead=false){
      let clockLost=false,frame=latest,due,lateMs=null;
      if(clock?.last&&at-clock.last.at>clockLostMs){
        clock.last=null;clockLost=true;
      }
      if(clock?.last&&!audioDead){
        const sample=consumed(at);
        due=Math.min(done+maxBehindFrames,Math.floor((sample+lead)/samplesPerFrame));
        const audible=Math.floor((sample-clock.latency)/samplesPerFrame)+1;
        frame=heard.findLast(f=>f.index<=audible)??null;
        paced=true;
      }else{
        if(paced){anchor=at-done*frameMs;paced=false;}
        if(fillLead){anchor-=leadFrames*frameMs;fillLead=false;}
        lateMs=at-(anchor+(done+1)*frameMs);
        due=Math.floor((at-anchor)/frameMs);
        if(due-done>maxBehindFrames){anchor=at-done*frameMs;due=done+1;slips++;}
        if(clock&&!audioDead&&clock.openedAt===null){
          clock.startFrame=done;clock.openedAt=at;
        }
        if(clock&&!audioDead&&at-clock.openedAt<startWaitMs)
          due=Math.min(due,clock.startFrame+leadFrames);
      }
      return {due,frame,paced,clockLost,lateMs,anchor,slips};
    },
    wait(at,done,audioDead=false){
      return clock?.last&&!audioDead?
        Math.min(frameMs,((done+1)*samplesPerFrame-lead-consumed(at))*sampleMs):
        anchor+(done+1)*frameMs-at;
    },
    get anchor(){return anchor;},
    get slips(){return slips;}
  });
}
