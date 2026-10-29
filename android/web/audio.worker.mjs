/** GnG audio worker entry: the verified sound ROM and the YM2203 bank WASM
 * feed the GnG audio producer (Z80 session -> two YM2203 -> Int16 PCM at
 * 62.5 kHz) behind the base browser audio worker host
 * (base/src/host/web/audio-worker.mjs), which owns batches, output sessions
 * and the save/restore protocol.
 */
import {startAudioWorker} from './base/src/host/web/audio-worker.mjs';

const ROM_SHA1='7ef9ec5c2072e21c787a6bbf700033f50c759c1d';
async function bytes(name){
  const res=await fetch(name);
  if(!res.ok)throw Error('AUDIO_FETCH_'+res.status);
  return new Uint8Array(await res.arrayBuffer());
}
startAudioWorker({async load(){
  const [{createGngAudioProducer},soundRom,wasm]=await Promise.all([
    import('./lib/gngb_audio_producer.mjs'),
    bytes('audio/gg2.bin'),bytes('audio/ym2203.wasm')]);
  const sha1=[...new Uint8Array(await crypto.subtle.digest('SHA-1',soundRom))]
    .map(b=>b.toString(16).padStart(2,'0')).join('');
  if(soundRom.length!==0x8000||sha1!==ROM_SHA1)throw Error('AUDIO_ROM_INVALID');
  return createGngAudioProducer({soundRom,wasm});
}});
