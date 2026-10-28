#!/usr/bin/env node
/** ROM-free local check of the pinned native incremental renderer. */
import {spawnSync} from 'node:child_process';
import {readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';

const binary=resolve('out/audio/ym2203_lab');
if(!existsSync(binary))throw Error('AUDIO_STREAM_RENDERER_MISSING');
const setup=[
  'W 0 57344 0','W 0 57345 64',
  'W 0 57344 1','W 0 57345 0',
  'W 0 57344 7','W 0 57345 62',
  'W 0 57344 8','W 0 57345 15'];
function render(commands){
  const r=spawnSync(binary,['--stream'],{
    input:commands.join('\n')+'\nQ\n',maxBuffer:2*1024*1024});
  if(r.status!==0)throw Error('AUDIO_STREAM_RENDER_STOP');
  const chunks=[];let offset=0,next=0;
  while(offset<r.stdout.length){
    if(r.stdout[offset]!==80||offset+13>r.stdout.length)
      throw Error('AUDIO_STREAM_PACKET_INVALID');
    const first=Number(r.stdout.readBigUInt64LE(offset+1));
    const n=r.stdout.readUInt32LE(offset+9);
    if(first!==next||offset+13+2*n>r.stdout.length)
      throw Error('AUDIO_STREAM_PACKET_GAP');
    chunks.push(r.stdout.subarray(offset+13,offset+13+2*n));
    next+=n;offset+=13+2*n;
  }
  return Buffer.concat(chunks);
}
const single=render([...setup,'U 2400000']);
const chunked=render([...setup,'U 100001','U 198123','U 2400000']);
if(!single.equals(chunked))throw Error('AUDIO_STREAM_CHUNK_MISMATCH');
const resetSingle=render([...setup,'R 1000000','U 2400000']);
const resetRepeat=render([...setup,'R 1000000','U 2400000']);
if(!resetSingle.equals(resetRepeat))throw Error('AUDIO_STREAM_NONDETERMINISTIC');
const resetChunked=render([...setup,'U 800000','R 1000000',
  'U 1000192','U 2400000']);
if(!resetSingle.subarray(0,10000).equals(single.subarray(0,10000)))
  throw Error('AUDIO_STREAM_RESET_RETROACTIVE first='+
    resetSingle.subarray(0,10000).findIndex((byte,i)=>byte!==single[i]));
if(!resetSingle.equals(resetChunked))
  throw Error('AUDIO_STREAM_RESET_CHUNK_MISMATCH first='+
    resetSingle.findIndex((byte,i)=>byte!==resetChunked[i])+ 
    ' sizes='+resetSingle.length+','+resetChunked.length);
let nonzero=0;
for(let i=0;i<single.length;i+=2)
  if(single.readInt16LE(i)!==0)nonzero++;
console.log(JSON.stringify({status:'PASS',sampleRate:62500,
  samples:single.length/2,nonzeroSamples:nonzero,
  chunksEqual:true,resetChunksEqual:true}));
