#!/usr/bin/env node
/** V3.B3 visual witness: renders chosen frames of a B3 tape from the
 * FROZEN bundle (plain block Map, no compiler) into one private PNG
 * montage under out/v3/b3/witness/. Never commit its output.
 * Usage: node scripts/v3_b3_witness.mjs <profile> <frame,frame,...>
 */
import {execFileSync} from 'node:child_process';
import {writeFileSync,mkdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import zlib from 'node:zlib';
import {loadFrozen} from '../src/v2_b1_frozen.mjs';
import {selectB3Bundle} from '../src/v3_b3_bundle.mjs';
import {rendererUnknownCount} from '../src/v2_b1_observable.mjs';
import {renderGngbRgba} from '../src/gngb_frame_renderer.mjs';
import {gngbGraphics,rendererInputs} from './r35_t5_render_check.mjs';
import {resolveB3LabTape} from '../src/v3_b3_external_tape.mjs';
import {parseLabPokes,applyLabPokes} from '../src/h3_lab_poke.mjs';

const ROOT=resolve(fileURLToPath(import.meta.url),'../..');
const SELECTED=selectB3Bundle(ROOT);
if(!SELECTED)throw Error('V3_B3_NO_CERTIFIED_BUNDLE');
const DIR=SELECTED.dir;
console.log('V3_B3_BUNDLE_GENERATION='+SELECTED.generation);
const [profile,list]=process.argv.slice(2);
const want=(list??'').split(',').map(Number);
if(!profile)throw Error('V3_B3_WITNESS_USAGE');
const tape=resolveB3LabTape(profile);
const POKES=parseLabPokes();
if(POKES.length)console.log('H3_LAB_POKE='+process.env.H3_POKE);
if(!want.length||want.some(f=>!Number.isInteger(f)||f<1||
   f>tape.frames))throw Error('V3_B3_WITNESS_USAGE');
const {code}=loadFrozen(DIR);
const {blocks}=await import(pathToFileURL(join(DIR,'program.mjs')).href);
const {createBoard}=await import(pathToFileURL(join(DIR,'gngb_runtime.mjs')).href);
const gfx=gngbGraphics(n=>execFileSync('unzip',['-p',join(ROOT,'roms/gng.zip'),n],
  {maxBuffer:1<<20,stdio:['ignore','pipe','ignore']}));
const crcTable=Int32Array.from({length:256},(_,n)=>{
  let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c;});
const crc=b=>{let c=-1;for(const x of b)c=crcTable[(c^x)&255]^(c>>>8);return (c^-1)>>>0;};
const chunk=(type,data)=>{
  const len=Buffer.alloc(4),sum=Buffer.alloc(4),body=Buffer.concat([Buffer.from(type),data]);
  len.writeUInt32BE(data.length);sum.writeUInt32BE(crc(body));
  return Buffer.concat([len,body,sum]);
};
const png=(w,h,rgba)=>{
  const raw=Buffer.alloc((w*4+1)*h);
  for(let y=0;y<h;y++)Buffer.from(rgba.buffer,y*w*4,w*4).copy(raw,y*(w*4+1)+1);
  const head=Buffer.alloc(13);
  head.writeUInt32BE(w,0);head.writeUInt32BE(h,4);head[8]=8;head[9]=6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',head),
    chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
};
const shots=new Map(),targets=new Set(want),last=Math.max(...want);
const board=createBoard(code,blocks,{frames:last,
  portRead:(addr,cycle)=>tape.read(addr,cycle),
  onFrame:r=>{
    const i=board.state.records.length;
    board.state.records[i-1]=null;
    applyLabPokes(POKES,board.state,i);
    if(!targets.has(i)||rendererUnknownCount(r))return;
    shots.set(i,Uint8Array.from(renderGngbRgba(rendererInputs(r.record,
      {scroll:r.scroll,latch:r.latch},gfx)).rgba));
  }});
const result=board.run();
const W=256,H=224,G=4,cols=4,order=want.filter(f=>shots.has(f));
const MW=cols*(W+G),MH=Math.ceil(order.length/cols)*(H+G);
const montage=new Uint8Array(MW*MH*4).fill(80);
order.forEach((f,n)=>{
  const ox=(n%cols)*(W+G),oy=Math.floor(n/cols)*(H+G),px=shots.get(f);
  for(let y=0;y<H;y++)montage.set(px.subarray(y*W*4,(y+1)*W*4),((oy+y)*MW+ox)*4);
});
const out=join(ROOT,'out/v3/b3/witness');
mkdirSync(out,{recursive:true,mode:0o700});
const file=join(out,tape.profile+'-'+order[0]+'-'+order.at(-1)+'.png');
writeFileSync(file,png(MW,MH,montage),{mode:0o600});
console.log('V3_B3_WITNESS_RUN='+result.status);
console.log('V3_B3_WITNESS_FRAMES='+order.join(','));
console.log('V3_B3_WITNESS_PNG='+file);
