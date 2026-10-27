/**
 * G5: bounded mono PCM queue. Transport only; NEVER synthesizes music itself.
 * A missing producer/underrun is observable and must not be declared audio PASS.
 */
export class AudioPCMStop extends Error {
  constructor(code){super(code);this.code=code;}
}
export class MonoPCMQueue {
  constructor(capacity=48000) {
    if(!Number.isInteger(capacity)||capacity<128||capacity>48000*20)
      throw new AudioPCMStop('AUDIO_PCM_BAD_CAPACITY');
    this.buffer=new Float32Array(capacity);
    this.read=0;this.write=0;this.length=0;
    this.underruns=0;
  }
  push(samples) {
    if(!(samples instanceof Float32Array) || samples.length>this.buffer.length-this.length)
      throw new AudioPCMStop('AUDIO_PCM_BAD_OR_OVERFLOW');
    for(const v of samples)if(!Number.isFinite(v)||v < -1 || v > 1)
      throw new AudioPCMStop('AUDIO_PCM_SAMPLE_INVALID');
    for(const v of samples) {
      this.buffer[this.write]=v;
      this.write=(this.write+1)%this.buffer.length;
      this.length++;
    }
    return this.length;
  }
  pull(target) {
    if(!(target instanceof Float32Array))
      throw new AudioPCMStop('AUDIO_PCM_TARGET_INVALID');
    const have=Math.min(target.length,this.length);
    for(let i=0;i<have;i++) {
      target[i]=this.buffer[this.read];
      this.read=(this.read+1)%this.buffer.length;
    }
    for(let i=have;i<target.length;i++)target[i]=0;
    this.length-=have;
    if(have<target.length)this.underruns+=(target.length-have);
    return {delivered:have,missing:target.length-have,queued:this.length};
  }
  clear() {this.read=0;this.write=0;this.length=0;}
}
