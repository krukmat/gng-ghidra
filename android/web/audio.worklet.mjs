/** AO-6 AudioWorklet: PCM from the audio worker on a MessagePort, converted
 * to the context rate by the G5 resampler (50 ms prebuffer, 200 ms capacity,
 * STOP at the first underrun). Packets of an older session are dropped, not
 * played. While playing it tells the engine worker, every ~10 ms, which
 * source sample has been consumed; that count paces the CPU.
 */
import {PCMStreamResampler} from './lib/gngb_audio_resampler.mjs';

const CLOCK_EVERY=512; // output frames: 10.7 ms at 48 kHz

class AoPCMProcessor extends AudioWorkletProcessor {
  constructor(){
    super();
    this.stream=new PCMStreamResampler(sampleRate);
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
      this.clockCountdown=CLOCK_EVERY;
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
}
registerProcessor('ao-pcm-sink',AoPCMProcessor);
