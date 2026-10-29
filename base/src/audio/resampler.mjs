/** Stateful, bounded PCM input and linear output-rate conversion. */
export class AudioStreamStop extends Error {
  constructor(code){super(code);this.code=code;}
}
export class PCMStreamResampler {
  constructor(outputRate,{inputRate,capacity,prebuffer}={}) {
    if(!Number.isFinite(outputRate)||outputRate<8000||outputRate>192000||
       !Number.isInteger(inputRate)||inputRate<8000||
       !Number.isInteger(capacity)||capacity<256||
       !Number.isInteger(prebuffer)||prebuffer<2||prebuffer>capacity)
      throw new AudioStreamStop('AUDIO_RESAMPLE_CONFIG_INVALID');
    this.rate=outputRate;this.inputRate=inputRate;
    this.capacity=capacity;this.prebuffer=prebuffer;
    this.buffer=new Float32Array(capacity);
    this.read=0;this.length=0;this.base=0;this.expected=null;
    this.position=null;this.sessionId=null;this.state='WAITING';
    this.produced=0;this.missing=0;this.lastInputSample=null;
  }
  reset(sessionId=null){
    this.read=0;this.length=0;this.base=0;this.expected=null;
    this.position=null;this.sessionId=sessionId;this.state='WAITING';
    this.produced=0;this.missing=0;this.lastInputSample=null;
  }
  push({sessionId,firstSample,sampleRate,samples}){
    if(!Number.isSafeInteger(sessionId)||sessionId<1||
       !Number.isSafeInteger(firstSample)||firstSample<0||
       sampleRate!==this.inputRate||!(samples instanceof Int16Array)||
       samples.length<1||samples.length>this.capacity)
      throw new AudioStreamStop('AUDIO_PCM_PACKET_INVALID');
    if(this.sessionId===null)this.sessionId=sessionId;
    if(sessionId!==this.sessionId)
      throw new AudioStreamStop('AUDIO_PCM_STALE_SESSION');
    if(this.expected===null){
      this.expected=firstSample;this.base=firstSample;this.position=firstSample;
    }
    if(firstSample!==this.expected)
      throw new AudioStreamStop('AUDIO_PCM_GAP_OR_DUPLICATE');
    if(samples.length>this.capacity-this.length)
      throw new AudioStreamStop('AUDIO_PCM_QUEUE_OVERFLOW');
    for(let i=0;i<samples.length;i++)
      this.buffer[(this.read+this.length+i)%this.capacity]=samples[i]/32768;
    this.length+=samples.length;this.expected+=samples.length;
    return this.length;
  }
  pull(target){
    if(!(target instanceof Float32Array))
      throw new AudioStreamStop('AUDIO_PCM_TARGET_INVALID');
    target.fill(0);
    if(this.state==='STOP')return this.snapshot();
    if(this.state==='WAITING'){
      if(this.length<this.prebuffer+1)return this.snapshot();
      this.state='PLAYING';
    }
    for(let i=0;i<target.length;i++){
      const index=Math.floor(this.position),frac=this.position-index;
      const offset=index-this.base;
      if(offset<0||offset+1>=this.length){
        this.missing+=target.length-i;this.state='STOP';break;
      }
      const a=this.buffer[(this.read+offset)%this.capacity];
      const b=this.buffer[(this.read+offset+1)%this.capacity];
      target[i]=a+(b-a)*frac;
      this.lastInputSample=this.position;
      this.position+=this.inputRate/this.rate;
      this.produced++;
    }
    const drop=Math.max(0,Math.min(this.length,Math.floor(this.position)-this.base));
    this.read=(this.read+drop)%this.capacity;
    this.base+=drop;this.length-=drop;
    return this.snapshot();
  }
  snapshot(){return {state:this.state,sessionId:this.sessionId,
    queuedSourceSamples:this.length,producedOutputSamples:this.produced,
    missingOutputSamples:this.missing,lastInputSample:this.lastInputSample};}
}
