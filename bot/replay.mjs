#!/usr/bin/env node
/** Read-only replay, scalar report and optional private engine screenshots. */
import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {deflateSync} from 'node:zlib';
import {resolveB3LabTape} from '../src/v3_b3_external_tape.mjs';
import {renderGngbRgba} from '../src/gngb_frame_renderer.mjs';
import {rendererUnknownCount} from '../src/v2_b1_observable.mjs';
import {gngbGraphics,rendererInputs} from '../scripts/r35_t5_render_check.mjs';
import {loadEngine} from './engine-evaluation.mjs';

const ROOT=resolve(fileURLToPath(import.meta.url),'../..');
const [source,endArg='5000',framesArg='',label='replay']=process.argv.slice(2);
const endFrame=Number(endArg),captureFrames=framesArg?framesArg.split(',').map(Number):[];
if(!source||!Number.isSafeInteger(endFrame)||endFrame<1200||endFrame>216000||
   captureFrames.some(f=>!Number.isSafeInteger(f)||f<1||f>endFrame)||
   !/^[-\w]+$/.test(label))throw Error('BOT_REPLAY_USAGE');
const tape=resolveB3LabTape(source),engine=await loadEngine(ROOT);
const result=engine.run(tape.events,{startFrame:1200,endFrame,captureFrames});
const out=join(ROOT,'out/bot',label);mkdirSync(out,{recursive:true,mode:0o700});
writeFileSync(join(out,'replay.json'),JSON.stringify({source,bundleHash:engine.bundleHash,
  tapeHash:tape.sha256,metrics:result.metrics},null,2)+'\n',{mode:0o600});
console.log('BOT_REPLAY='+JSON.stringify(result.metrics));
if(captureFrames.length){
  const gfx=gngbGraphics(n=>execFileSync('unzip',['-p',join(ROOT,'roms/gng.zip'),n],
    {maxBuffer:1<<20,stdio:['ignore','pipe','ignore']}));
  const W=256,H=224,G=4,cols=4,width=cols*(W+G),height=Math.ceil(captureFrames.length/cols)*(H+G);
  const rgba=new Uint8Array(width*height*4).fill(80);
  for(const [index,frame] of captureFrames.entries()){
    const r=result.captures.get(frame);
    if(!r||rendererUnknownCount(r))throw Error('BOT_WITNESS_MISSING_FRAME_'+frame);
    const pixels=renderGngbRgba(rendererInputs(r.record,{scroll:r.scroll,latch:r.latch},gfx)).rgba;
    const x=index%cols*(W+G),y=Math.floor(index/cols)*(H+G);
    for(let row=0;row<H;row++)rgba.set(pixels.subarray(row*W*4,(row+1)*W*4),
      ((y+row)*width+x)*4);
  }
  const table=Uint32Array.from({length:256},(_,n)=>{
    let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;
  });
  const chunk=(type,data)=>{
    const body=Buffer.concat([Buffer.from(type),data]),head=Buffer.alloc(4),tail=Buffer.alloc(4);
    let c=0xffffffff;for(const b of body)c=table[(c^b)&255]^(c>>>8);
    head.writeUInt32BE(data.length);tail.writeUInt32BE((c^0xffffffff)>>>0);
    return Buffer.concat([head,body,tail]);
  };
  const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);
  header[8]=8;header[9]=6;
  const raw=Buffer.alloc((width*4+1)*height);
  for(let row=0;row<height;row++)raw.set(rgba.subarray(row*width*4,(row+1)*width*4),row*(width*4+1)+1);
  const file=join(out,'frames.png');
  writeFileSync(file,Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),
    chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]),{mode:0o600});
  console.log('BOT_WITNESS_FRAMES='+captureFrames.join(','));
  console.log('BOT_WITNESS='+file);
}
if(result.metrics.status!=='FRAMES_DONE')process.exitCode=2;
