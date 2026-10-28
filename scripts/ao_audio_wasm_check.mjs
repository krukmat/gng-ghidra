#!/usr/bin/env node
/** AO-5.3 (private): real YM commands from the AOT engine + Z80 session,
 * fed to the native renderer and to the WASM build; every PCM block must be
 * byte-identical. Usage: node scripts/ao_audio_wasm_check.mjs [frames]
 * Coin, Start, then scripted play until the run ends. Commands, PCM (WAV)
 * and the report go to out/android/check/ (private).
 */
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {selectB3Bundle} from '../src/v3_b3_bundle.mjs';
import {prepareAudioBundle} from '../src/gngb_audio_bundle_overlay.mjs';
import {loadFrozen} from '../src/v2_b1_frozen.mjs';
import {INPUT_DEFAULTS} from '../src/gngb_input_contract.mjs';
import {observeGameState} from '../src/ao_game_state.mjs';
import {loadYm2203,YM_SAMPLE_RATE} from '../src/ao_ym2203_wasm.mjs';
import {applyCommand,commandLine,createAudioCommandSource} from '../src/ao_audio_commands.mjs';

const ROOT=resolve(fileURLToPath(import.meta.url),'../..');
const OUT=join(ROOT,'out/android/check');
const FRAMES=Number(process.argv[2]??7500); // 7500 x 16.768 ms = 125.8 s
const ROM_SHA1='7ef9ec5c2072e21c787a6bbf700033f50c759c1d';
const sha256=b=>createHash('sha256').update(b).digest('hex');

// Active-low pulses on SYSTEM (0x3000) and P1 (0x3001), by frame number.
function portsFor(frame,state){
  const p=[...INPUT_DEFAULTS];
  if(frame>=900&&frame<906)p[0]&=~0x40;               // coin
  if(frame>=1000&&frame<1006)p[0]&=~0x01;             // start
  if(state.inGame&&frame>=1300){
    const t=frame%600;
    if(t<240)p[1]&=~0x01;else if(t<300)p[1]&=~0x02;   // right, then left
    if(frame%20<3)p[1]&=~0x10;                        // fire
    if(frame%90<4)p[1]&=~0x20;                        // jump
  }
  return p;
}

async function captureCommands(){
  const bundle=selectB3Bundle(ROOT);
  if(!bundle)throw Error('AO_AUDIO_B3_BUNDLE_MISSING');
  const {dir}=await prepareAudioBundle(ROOT,bundle.dir);
  const {code}=loadFrozen(dir);
  const {blocks}=await import(pathToFileURL(join(dir,'program.mjs')).href);
  const {createBoard,CYCLES_PER_FRAME}=
    await import(pathToFileURL(join(dir,'gngb_runtime.mjs')).href);
  const rom=readFileSync(join(ROOT,'out/audio/gg2.bin'));
  if(createHash('sha1').update(rom).digest('hex')!==ROM_SHA1)
    throw Error('AO_AUDIO_ROM_INVALID');
  const source=await createAudioCommandSource(Uint8Array.from(rom));
  const commands=[],states=[];
  let events=[],completed=0,frame=0,state={},ports=[...INPUT_DEFAULTS];
  const t0=performance.now();
  const cpu=createBoard(code,blocks,{frames:FRAMES,
    portRead:a=>ports[a-0x3000],
    onAudioEvent:e=>events.push({kind:e.kind,value:e.value,cycle:e.cycle}),
    // Same batching as the live engine worker: one batch per frame mark.
    onAudioComplete:m=>{
      if(m.frames<=completed)return;
      completed=m.frames;
      commands.push(...source.batch(m.frames*CYCLES_PER_FRAME,events).commands);
      events=[];
    },
    onFrame:r=>{
      frame=r.index;
      const s=observeGameState(r);
      if(s){
        const key=JSON.stringify(s);
        if(key!==JSON.stringify(state))states.push({frame,...s});
        state=s;
      }
      ports=portsFor(frame+1,state);
      cpu.state.records[r.index-1]=null;cpu.state.events.length=0;
    }});
  const result=cpu.run();
  if(result.status!=='FRAMES_DONE')throw Error('AO_AUDIO_ENGINE_'+result.status);
  return {commands,states,stats:source.snapshot(),
    captureMs:Math.round(performance.now()-t0)};
}

function nativeBlocks(text){
  const r=spawnSync(join(ROOT,'out/audio/ym2203_lab'),['--stream'],
    {input:text+'Q\n',maxBuffer:256*1024*1024});
  if(r.status!==0)throw Error('AO_AUDIO_NATIVE_STOP '+r.stderr);
  const blocks=[];let at=0;
  while(at<r.stdout.length){
    if(r.stdout[at]!==80)throw Error('AO_AUDIO_NATIVE_PACKET_INVALID');
    const n=r.stdout.readUInt32LE(at+9);
    blocks.push({first:Number(r.stdout.readBigUInt64LE(at+1)),
      bytes:r.stdout.subarray(at+13,at+13+2*n)});
    at+=13+2*n;
  }
  return blocks;
}
async function wasmBlocks(commands,keep=()=>true){
  const lib=await loadYm2203(readFileSync(join(ROOT,'out/android/audio/ym2203.wasm')));
  const ym=lib.create(),blocks=[];
  const t0=performance.now();
  for(const c of commands){
    if(c.kind==='U'&&!keep(c))continue;
    const b=applyCommand(ym,c);
    if(b)blocks.push({first:b.firstSample,bytes:Buffer.from(b.samples.buffer)});
  }
  const ms=performance.now()-t0;
  ym.destroy();
  return {blocks,ms,memoryBytes:lib.memoryBytes()};
}
const continuous=blocks=>blocks.every((b,i)=>
  b.first===(i?blocks[i-1].first+blocks[i-1].bytes.length/2:0));
function wav(pcm){
  const h=Buffer.alloc(44);
  h.write('RIFF',0);h.writeUInt32LE(36+pcm.length,4);h.write('WAVEfmt ',8);
  h.writeUInt32LE(16,16);h.writeUInt16LE(1,20);h.writeUInt16LE(1,22);
  h.writeUInt32LE(YM_SAMPLE_RATE,24);h.writeUInt32LE(YM_SAMPLE_RATE*2,28);
  h.writeUInt16LE(2,32);h.writeUInt16LE(16,34);h.write('data',36);
  h.writeUInt32LE(pcm.length,40);
  return Buffer.concat([h,pcm]);
}

const cap=await captureCommands();
const text=cap.commands.map(commandLine).join('\n')+'\n';
const native=nativeBlocks(text);
const wasm=await wasmBlocks(cap.commands);
// Fewer, larger blocks: keep one U in seven. Same PCM, other boundaries.
let u=0;
const regrouped=await wasmBlocks(cap.commands,()=>++u%7===0||
  u===cap.commands.filter(c=>c.kind==='U').length);
let firstDiff=null;
for(let i=0;i<Math.max(native.length,wasm.blocks.length)&&!firstDiff;i++){
  const a=native[i],b=wasm.blocks[i];
  if(!a||!b||a.first!==b.first||!a.bytes.equals(b.bytes))
    firstDiff={block:i,native:a&&{first:a.first,n:a.bytes.length/2},
      wasm:b&&{first:b.first,n:b.bytes.length/2}};
}
const nativePcm=Buffer.concat(native.map(b=>b.bytes));
const regroupedPcm=Buffer.concat(regrouped.blocks.map(b=>b.bytes));
const count=k=>cap.commands.filter(c=>c.kind===k).length;
const uTicks=new Set(cap.commands.filter(c=>c.kind==='U').map(c=>c.tick));
let nonzero=0;
for(let i=0;i<nativePcm.length;i+=2)if(nativePcm.readInt16LE(i))nonzero++;
const frames=count('U');
const report={
  frames,seconds:+(nativePcm.length/2/YM_SAMPLE_RATE).toFixed(2),
  commands:{W:count('W'),R:count('R'),U:frames,
    onFrontier:cap.commands.filter(c=>c.kind!=='U'&&uTicks.has(c.tick)).length},
  z80:cap.stats,gameStates:cap.states,
  blocks:{native:native.length,wasm:wasm.blocks.length,
    emptyBlocks:native.filter(b=>!b.bytes.length).length,
    maxSamples:Math.max(...native.map(b=>b.bytes.length/2))},
  identical:!firstDiff&&native.length===wasm.blocks.length,firstDiff,
  continuous:{native:continuous(native),wasm:continuous(wasm.blocks),
    regrouped:continuous(regrouped.blocks)},
  regroupedIdentical:regroupedPcm.equals(nativePcm),
  samples:nativePcm.length/2,nonzeroSamples:nonzero,
  pcmSha256:sha256(nativePcm),
  wasmMs:{total:+wasm.ms.toFixed(1),perFrame:+(wasm.ms/frames).toFixed(4)},
  wasmMemoryBytes:wasm.memoryBytes,captureMs:cap.captureMs,
  wasm:JSON.parse(readFileSync(join(ROOT,'out/android/audio/build.json'),'utf8')),
};
report.status=report.identical&&report.regroupedIdentical&&
  Object.values(report.continuous).every(Boolean)&&report.seconds>=120&&
  report.nonzeroSamples>0&&report.wasmMs.perFrame<2?'GO':'STOP';
mkdirSync(OUT,{recursive:true,mode:0o700});
writeFileSync(join(OUT,'ao5-ym-commands.txt'),text,{mode:0o600});
writeFileSync(join(OUT,'ao5-pcm.wav'),wav(nativePcm),{mode:0o600});
writeFileSync(join(OUT,'ao5-report.json'),JSON.stringify(report,null,1),{mode:0o600});
const {gameStates,z80,wasm:build,...summary}=report;
console.log(JSON.stringify(summary));
process.exitCode=report.status==='GO'?0:1;
