/** Node client of `audio_ym2203_lab --stream`: text commands in, binary
 * packets out. 'P' u64 first, u32 n, n Int16 samples (one per U);
 * 'S' u32 size, checkpoint bytes (one per S, see src/ym2203_checkpoint.h).
 * The PCM sample position must be contiguous, else AUDIO_LIVE_PCM_GAP.
 */
import {spawn} from 'node:child_process';

export function createYmNativeStream(renderer,{onPcm,onStop,nextSample=0}){
  const native=spawn(renderer,['--stream'],{stdio:['pipe','pipe','pipe']});
  let stdout=Buffer.alloc(0),stopped=false;
  const saves=[],drains=[];
  const stop=e=>{
    if(stopped)return;
    stopped=true;
    for(const s of [...saves.splice(0),...drains.splice(0)])s.reject(e);
    onStop(e);native.kill();
  };
  const parse=chunk=>{
    stdout=Buffer.concat([stdout,chunk]);
    if(stdout.length>1024*1024)throw Error('AUDIO_LIVE_OUTPUT_OVERFLOW');
    for(;;){
      if(stdout.length>=5&&stdout[0]===83){
        const n=stdout.readUInt32LE(1);
        if(n>65536||!saves.length)throw Error('AUDIO_LIVE_OUTPUT_INVALID');
        if(stdout.length<5+n)break;
        saves.shift().resolve(Uint8Array.from(stdout.subarray(5,5+n)));
        stdout=stdout.subarray(5+n);continue;
      }
      if(stdout.length<13)break;
      if(stdout[0]!==80)throw Error('AUDIO_LIVE_OUTPUT_INVALID');
      const first=Number(stdout.readBigUInt64LE(1)),n=stdout.readUInt32LE(9);
      if(n>12500||!Number.isSafeInteger(first))
        throw Error('AUDIO_LIVE_OUTPUT_INVALID');
      const length=13+n*2;
      if(stdout.length<length)break;
      if(first!==nextSample)throw Error('AUDIO_LIVE_PCM_GAP');
      nextSample+=n;
      onPcm(first,Uint8Array.from(stdout.subarray(13,length)));
      stdout=stdout.subarray(length);
    }
  };
  native.stdout.on('data',chunk=>{try{parse(chunk)}catch(e){stop(e)}});
  // stderr may contain private diagnostics; only a fixed code escapes.
  native.stderr.resume();
  native.on('error',()=>stop(Error('AUDIO_LIVE_NATIVE_STOP')));
  native.stdin.on('error',()=>stop(Error('AUDIO_LIVE_NATIVE_STOP')));
  native.on('exit',code=>{
    if(!stopped&&code!==0)stop(Error('AUDIO_LIVE_NATIVE_STOP'));
  });
  const write=text=>new Promise((resolve,reject)=>{
    if(stopped||native.exitCode!==null)
      return reject(Error('AUDIO_LIVE_NATIVE_STOP'));
    if(native.stdin.write(text))return resolve();
    const waiter={resolve,reject};
    drains.push(waiter);
    native.stdin.once('drain',()=>{drains.splice(drains.indexOf(waiter),1);resolve();});
  });
  return Object.freeze({write,
    // Resolves with the synthesizer state once every earlier U is rendered.
    save:()=>new Promise((resolve,reject)=>{
      saves.push({resolve,reject});
      write('S\n').catch(reject);
    }),
    // Only as the first command of a fresh process.
    load:bytes=>write('L '+Buffer.from(bytes).toString('hex')+'\n'),
    kill:()=>{stopped=true;native.kill();}});
}
