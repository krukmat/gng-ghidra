/** AO-5: dual-YM2203 producer from out/android/audio/ym2203.wasm. Same API in
 * Node and in a WebView Worker: the caller supplies the .wasm bytes. write,
 * reset and render match the native W, R and U commands; render returns
 * {firstSample, samples}, a copy of the Int16 PCM at 62.5 kHz.
 */
export const YM_SAMPLE_RATE=62500;
const CODES=['OK','AUDIO_YM_CLOCK_INVALID','AUDIO_YM_WRITE_INVALID',
  'AUDIO_YM_CHUNK_TOO_LARGE','AUDIO_YM_STOPPED'];

export class AudioYmStop extends Error {
  constructor(code){super(code);this.code=code;}
}
// Only libc's abort path imports stdio; reaching it is a STOP, never output.
const unreachable=()=>{throw new AudioYmStop('AUDIO_YM_WASM_ABORT');};
const IMPORTS={wasi_snapshot_preview1:{fd_close:unreachable,
  fd_write:unreachable,fd_seek:unreachable}};

export async function loadYm2203(bytes){
  const {instance}=await WebAssembly.instantiate(bytes,IMPORTS);
  const x=instance.exports;
  x._initialize();
  const create=()=>{
    let h=x.ao_ym_create();
    if(!h)throw new AudioYmStop('AUDIO_YM_CREATE_FAILED');
    const live=()=>{if(!h)throw new AudioYmStop('AUDIO_YM_DESTROYED');};
    const check=r=>{
      if(r<0)throw new AudioYmStop(CODES[-r]??'AUDIO_YM_UNKNOWN_STOP');
      return r;
    };
    return Object.freeze({
      write(tick,addr,value){live();check(x.ao_ym_write(h,tick,addr,value));},
      reset(tick){live();check(x.ao_ym_reset(h,tick));},
      render(tick){
        live();
        const n=check(x.ao_ym_render(h,tick));
        const at=x.ao_ym_pcm(h);
        return {firstSample:x.ao_ym_block_first(h),
          samples:new Int16Array(x.memory.buffer,at,n).slice()};
      },
      destroy(){if(h){x.ao_ym_destroy(h);h=0;}},
    });
  };
  return {create,memoryBytes:()=>x.memory.buffer.byteLength};
}
