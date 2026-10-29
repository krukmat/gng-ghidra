/** Browser output transport. The board supplies a resampler configured for its
 * source rate and queue policy; this module owns only the port/clock protocol.
 */
export function createPCMWorkletProcessor(Resampler,{clockEvery=512}={}){
  if(typeof Resampler!=='function'||!Number.isSafeInteger(clockEvery)||clockEvery<1)
    throw Error('PCM_WORKLET_CONFIG_INVALID');
  return class PCMWorkletProcessor extends AudioWorkletProcessor {
    constructor(){
      super();
      this.stream=new Resampler(sampleRate);
      this.pcm=null;this.clock=null;
      this.stale=0;this.outputNonzero=0;this.stopSent=false;
      this.clockCountdown=0;this.statsCountdown=0;
      this.port.onmessage=({data:m})=>{
        if(m?.kind!=='RESET')return this.fail('AUDIO_WORKLET_BAD_MESSAGE');
        this.pcm?.close();this.clock?.close();
        this.pcm=m.pcm??null;this.clock=m.clock??null;
        this.stream.reset(m.sessionId??null);
        this.stopSent=false;this.clockCountdown=0;
        if(this.pcm)this.pcm.onmessage=({data})=>this.push(data);
      };
    }
    fail(code,report={}){
      this.stream.state='STOP';
      if(this.stopSent)return;
      this.stopSent=true;
      this.port.postMessage({kind:'STOP',code,sessionId:this.stream.sessionId,...report});
      this.clock?.postMessage({type:'clock',sessionId:this.stream.sessionId,
        state:'STOP'});
    }
    push(m){
      if(m?.kind!=='PCM')return this.fail('AUDIO_WORKLET_BAD_MESSAGE');
      if(m.sessionId!==this.stream.sessionId||this.stream.state==='STOP'){
        this.stale++;return;
      }
      try{this.stream.push(m);}
      catch(e){this.fail(e.code??'AUDIO_WORKLET_PUSH_FAILED');}
    }
    process(_inputs,outputs){
      const channels=outputs[0];
      if(!channels?.length)return true;
      const out=channels[0];
      const report=this.stream.pull(out);
      for(let c=1;c<channels.length;c++)channels[c].set(out);
      for(let i=0;i<out.length;i++)if(out[i]!==0)this.outputNonzero++;
      const endTime=currentTime+out.length/sampleRate;
      if(report.state==='STOP'&&report.missingOutputSamples>0)
        this.fail('AUDIO_WORKLET_UNDERRUN',report);
      if(report.state==='PLAYING'&&
         (this.clockCountdown-=out.length)<=0){
        this.clockCountdown=clockEvery;
        this.clock?.postMessage({type:'clock',sessionId:report.sessionId,
          state:report.state,sample:report.lastInputSample,
          queued:report.queuedSourceSamples});
      }
      if((this.statsCountdown-=out.length)<=0){
        this.statsCountdown=sampleRate/4;
        this.port.postMessage({kind:'STATS',endTime,sampleRate,
          stale:this.stale,outputNonzero:this.outputNonzero,...report});
      }
      return true;
    }
  };
}
