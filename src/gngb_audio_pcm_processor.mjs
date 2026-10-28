import {PCMStreamResampler} from './gngb_audio_resampler.mjs';

class GngPCMProcessor extends AudioWorkletProcessor {
  constructor(){
    super();
    this.stream=new PCMStreamResampler(sampleRate);
    this.reportCountdown=0;
    this.port.onmessage=e=>{
      try{
        const m=e.data;
        if(m?.kind==='PCM')this.stream.push(m);
        else if(m?.kind==='RESET'){
          this.stream.reset(m.sessionId??null);
          this.reportCountdown=0;
        }
        else if(m?.kind==='STOP')this.stream.state='STOP';
        else throw Error('AUDIO_WORKLET_BAD_MESSAGE');
      }catch(err){
        this.stream.state='STOP';
        this.port.postMessage({kind:'AUDIO_WORKLET_STOP',
          code:err.code??err.message});
      }
    };
  }
  process(_inputs,outputs){
    const channels=outputs[0];
    if(!channels?.length)return true;
    const report=this.stream.pull(channels[0]);
    for(let c=1;c<channels.length;c++)channels[c].set(channels[0]);
    if(report.state==='STOP'&&report.missingOutputSamples>0&&
       this.reportCountdown>=0){
      this.port.postMessage({kind:'AUDIO_WORKLET_STOP',
        code:'AUDIO_WORKLET_UNDERRUN',...report});
      this.reportCountdown=-1;
    }
    if(this.reportCountdown>=0){
      this.reportCountdown+=channels[0].length;
      if(this.reportCountdown>=sampleRate/4){
        this.reportCountdown=0;
        this.port.postMessage({kind:'AUDIO_WORKLET_STATS',
          contextTime:currentTime,...report});
      }
    }
    return true;
  }
}
registerProcessor('gng-pcm-sink',GngPCMProcessor);
