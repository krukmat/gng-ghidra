// WebAudio playback transport; import as an AudioWorklet module, never in Node.
// It receives PCM only from a verified synthesis producer. Silence on
// underflow is accompanied by an underrun report (not a successful audio gate).
import {MonoPCMQueue} from './gngb_audio_pcm_queue.mjs';

class GngPCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue=new MonoPCMQueue(48000*2);
    this.underrunFrames=0;
    this.port.onmessage=e=>{
      const msg=e.data;
      try {
        if(msg?.kind==='PCM' && msg.samples instanceof Float32Array)
          this.queue.push(msg.samples);
        else if(msg?.kind==='RESET')this.queue.clear();
        else throw Error('AUDIO_WORKLET_BAD_MESSAGE');
      } catch(err) {
        this.port.postMessage({kind:'AUDIO_WORKLET_STOP',error:err.message});
      }
    };
  }
  process(_inputs, outputs) {
    const channels=outputs[0];
    if(!channels || !channels.length)return true;
    const result=this.queue.pull(channels[0]);
    for(let c=1;c<channels.length;c++)channels[c].set(channels[0]);
    if(result.missing>0) {
      this.underrunFrames+=result.missing;
      if(this.underrunFrames>=4800){
        this.port.postMessage({kind:'AUDIO_WORKLET_UNDERRUN',
          missingSamples:this.underrunFrames});
        this.underrunFrames=0;
      }
    }
    return true;
  }
}
registerProcessor('gng-pcm-sink',GngPCMProcessor);
