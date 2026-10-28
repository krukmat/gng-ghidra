import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync,readFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadYm2203} from '../src/ao_ym2203_wasm.mjs';
import {applyCommand,commandLine} from '../src/ao_audio_commands.mjs';

// ROM-free: synthetic register writes, no game data.
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const WASM=join(ROOT,'out/android/audio/ym2203.wasm');
const NATIVE=join(ROOT,'out/audio/ym2203_lab');
const missing=!existsSync(WASM)?'run scripts/ao_build_audio_wasm.sh':
  !existsSync(NATIVE)?'native ym2203_lab missing':false;

const parse=line=>{
  const [kind,tick,addr,value]=line.split(' ');
  return kind==='W'?{kind,tick:+tick,addr:+addr,value:+value}:{kind,tick:+tick};
};
const W=(t,a,v)=>`W ${t} ${57344+a} ${v}`;
// Chip 0: FM channel 1 key-on with a fast envelope; chip 1: SSG tone.
const setup=[W(0,0,0x28),W(0,1,0),W(0,0,0xa4),W(0,1,0x22),W(0,0,0xa0),
  W(0,1,0x69),W(0,0,0xb0),W(0,1,0x32),W(0,0,0x30),W(0,1,0x71),
  W(0,0,0x40),W(0,1,0x05),W(0,0,0x50),W(0,1,0x1f),W(0,0,0x28),W(0,1,0x10),
  W(0,2,0),W(0,3,64),W(0,2,1),W(0,3,0),W(0,2,7),W(0,3,62),W(0,2,8),W(0,3,15)];

function native(lines){
  const r=spawnSync(NATIVE,['--stream'],{input:lines.join('\n')+'\nQ\n',
    maxBuffer:8*1024*1024});
  const blocks=[];let at=0;
  while(at<r.stdout.length){
    assert.equal(r.stdout[at],80);
    const n=r.stdout.readUInt32LE(at+9);
    blocks.push({firstSample:Number(r.stdout.readBigUInt64LE(at+1)),
      bytes:Buffer.from(r.stdout.subarray(at+13,at+13+2*n))});
    at+=13+2*n;
  }
  return {status:r.status,blocks};
}
async function wasm(lines){
  const ym=(await loadYm2203(readFileSync(WASM))).create();
  const blocks=[];
  try{
    for(const line of lines){
      const b=applyCommand(ym,parse(line));
      if(b)blocks.push({firstSample:b.firstSample,
        bytes:Buffer.from(b.samples.buffer)});
    }
    return {status:0,blocks};
  }catch(e){return {status:2,code:e.code,blocks};}
  finally{ym.destroy();}
}
const same=async lines=>{
  const [a,b]=[native(lines),await wasm(lines)];
  assert.equal(b.status,a.status);
  assert.deepEqual(b.blocks,a.blocks);
  return a;
};

test('WASM blocks equal native blocks byte for byte',{skip:missing},async()=>{
  const whole=await same([...setup,'U 2400000']);
  const pcm=whole.blocks[0].bytes;
  assert.equal(pcm.length/2,12500);
  assert.ok(pcm.some(b=>b!==0),'synthetic tone must be audible');
  // Uneven chunks, a chip reset mid-stream, an event exactly on a frontier
  // (accepted by the next request) and a reset exactly on a frontier.
  await same([...setup,'U 100001','U 198123','U 2400000']);
  await same([...setup,'U 800000','R 1000000','U 1000192','U 2400000']);
  await same([...setup,'U 960000',W(960000,0,0x28),W(960000,1,0),'U 2400000']);
  await same([...setup,'U 960000','R 960000','U 1920000',W(1920000,2,8),
    W(1920000,3,0),'U 2400000']);
  // Empty requests and sample-aligned ticks.
  await same([...setup,'U 0','U 0','U 192','U 191','U 384']);
});
test('WASM stops where native stops',{skip:missing},async()=>{
  for(const bad of [[...setup,'U 1000','W 999 57344 0'],
    [...setup,'U 1000','U 999'],[...setup,'W 10 57348 0'],
    [...setup,'W 10 57344 256'],[...setup,'U 2400193'],
    [...setup,'U 960000','R 959999']]){
    const [a,b]=[native(bad),await wasm(bad)];
    assert.equal(a.status,2,bad.at(-1));
    assert.equal(b.status,2,bad.at(-1));
    assert.deepEqual(b.blocks,a.blocks);
  }
  const ym=(await loadYm2203(readFileSync(WASM))).create();
  assert.throws(()=>ym.render(1.5),{code:'AUDIO_YM_CLOCK_INVALID'});
  assert.throws(()=>ym.render(192),{code:'AUDIO_YM_STOPPED'});
  ym.destroy();
  assert.throws(()=>ym.render(192),{code:'AUDIO_YM_DESTROYED'});
});
test('protocol text round-trips',()=>{
  for(const c of [{kind:'W',tick:5,addr:57345,value:7},{kind:'R',tick:9},
    {kind:'U',tick:12}])assert.deepEqual(parse(commandLine(c)),c);
});
