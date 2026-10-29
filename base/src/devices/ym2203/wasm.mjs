/** YM2203 bank from the standalone module built by build.mjs. Same API in
 * Node and in a browser worker: the caller supplies the .wasm bytes and the
 * board configuration. Ticks are board event-clock ticks. render returns
 * {firstSample, samples}, a copy of the mono Int16 PCM at `sampleRate`.
 * save()/load(bytes) use the GYM1 layout of bank.cpp.
 */
const CODES=['OK','AUDIO_YM_CLOCK_INVALID','AUDIO_YM_WRITE_INVALID',
  'AUDIO_YM_CHUNK_TOO_LARGE','AUDIO_YM_STOPPED','AUDIO_YM_SAVE_INVALID',
  'AUDIO_YM_LOAD_INVALID'];

export class AudioYmStop extends Error {
  constructor(code){super(code);this.code=code;}
}
// Larger load input never reaches a bank, which stays usable; any other
// wrong size stops it, as in the dual-YM reference wrapper.
const MAX_LOAD_BYTES=4096;
// Only libc's abort path imports stdio; reaching it is a STOP, never output.
const unreachable=()=>{throw new AudioYmStop('AUDIO_YM_WASM_ABORT');};
const IMPORTS={wasi_snapshot_preview1:{fd_close:unreachable,
  fd_write:unreachable,fd_seek:unreachable}};

/** chips 1..4; tickHz: the board's event clock; chipHz: a multiple of 24
 * (sample rate chipHz/24); gains: FM, SSG A, B, C in [0, 4], shared by every
 * chip; maxBlockSamples: 1..65536 samples between two renders. */
export function validateYm2203Config(c){
  const gains=c?.gains;
  if(!Number.isInteger(c?.chips)||c.chips<1||c.chips>4||
     !Number.isSafeInteger(c.tickHz)||c.tickHz<1||c.tickHz>0xffffffff||
     !Number.isSafeInteger(c.chipHz)||c.chipHz<24||c.chipHz>0xffffffff||
     c.chipHz%24||!Array.isArray(gains)||gains.length!==4||
     gains.some(g=>typeof g!=='number'||!(g>=0&&g<=4))||
     !Number.isInteger(c.maxBlockSamples)||c.maxBlockSamples<1||
     c.maxBlockSamples>65536)throw new AudioYmStop('AUDIO_YM_CONFIG_INVALID');
  return Object.freeze({chips:c.chips,tickHz:c.tickHz,chipHz:c.chipHz,
    gains:Object.freeze([...gains]),maxBlockSamples:c.maxBlockSamples,
    sampleRate:c.chipHz/24});
}

export async function loadYm2203Bank(bytes){
  const {instance}=await WebAssembly.instantiate(bytes,IMPORTS);
  const x=instance.exports;
  x._initialize();
  const create=config=>{
    const c=validateYm2203Config(config);
    let h=x.ym2203_create(c.chips,c.tickHz,c.chipHz,...c.gains,c.maxBlockSamples);
    if(!h)throw new AudioYmStop('AUDIO_YM_CONFIG_INVALID');
    const capacity=x.ym2203_checkpoint_capacity(h);
    const live=()=>{if(!h)throw new AudioYmStop('AUDIO_YM_DESTROYED');};
    const check=r=>{
      if(r<0)throw new AudioYmStop(CODES[-r]??'AUDIO_YM_UNKNOWN_STOP');
      return r;
    };
    return Object.freeze({
      config:c,sampleRate:x.ym2203_sample_rate(h),
      write(tick,chip,port,value){live();check(x.ym2203_write(h,tick,chip,port,value));},
      reset(tick){live();check(x.ym2203_reset(h,tick));},
      render(tick){
        live();
        const n=check(x.ym2203_render(h,tick));
        const at=x.ym2203_pcm(h);
        return {firstSample:x.ym2203_block_first(h),
          samples:new Int16Array(x.memory.buffer,at,n).slice()};
      },
      // After a render only; returns a copy of the checkpoint bytes.
      save(){
        live();
        const n=check(x.ym2203_save(h));
        return new Uint8Array(x.memory.buffer,x.ym2203_checkpoint(h),n).slice();
      },
      // Only as the first call on a fresh bank with the same chip count.
      load(bytes){
        live();
        if(!(bytes instanceof Uint8Array)||bytes.length>MAX_LOAD_BYTES)
          throw new AudioYmStop('AUDIO_YM_LOAD_INVALID');
        // The bank rejects a size other than its capacity before reading.
        if(bytes.length<=capacity)
          new Uint8Array(x.memory.buffer,x.ym2203_checkpoint(h),bytes.length).set(bytes);
        check(x.ym2203_load(h,bytes.length));
      },
      destroy(){if(h){x.ym2203_destroy(h);h=0;}},
    });
  };
  return {create,memoryBytes:()=>x.memory.buffer.byteLength};
}
