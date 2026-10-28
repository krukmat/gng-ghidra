#!/usr/bin/env node
/**
 * R3.5.B2.T5 phase A: is the JS compositor pixel-exact against MAME?
 * Feeds each private T4.3 reference record (VRAM, DMA sprite buffer, pen
 * RGBA, scroll) to renderGngbRgba and compares with the PNG MAME saved at
 * the same VBLANK boundary. This validates only the renderer: no CPU runs.
 * Prints counts and fixed statuses; per-frame details stay in out/.
 */
import {execFileSync} from 'node:child_process';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {inflateSync} from 'node:zlib';
import {renderGngbRgba} from '../src/gngb_frame_renderer.mjs';
import {REC,rendererInputs} from '../src/gngb_render_inputs.mjs';

export {REC,rendererInputs};

/** gngb gfx regions exactly as MAME's ROM_START(gngb) loads them. */
export function gngbGraphics(read){
  const put=(region,name,at)=>{
    const b=read(name);
    if(b.length!==0x4000)throw Error('R35_T5_GFX_ROM_SIZE');
    region.set(b,at);
  };
  const chars=new Uint8Array(0x4000);
  put(chars,'gg1.bin',0);
  const tiles=new Uint8Array(0x18000);
  ['gg11.bin','gg10.bin','gg9.bin','gg8.bin','gg7.bin','gg6.bin']
    .forEach((n,i)=>put(tiles,n,i*0x4000));
  // ROMREGION_ERASEFF: the unpopulated quarter of each half reads 0xff.
  const sprites=new Uint8Array(0x20000).fill(0xff);
  [['gg17.bin',0],['gg16.bin',0x4000],['gg15.bin',0x8000],
   ['gg14.bin',0x10000],['gg13.bin',0x14000],['gg12.bin',0x18000]]
    .forEach(([n,at])=>put(sprites,n,at));
  return {chars,tiles,sprites};
}

/** Minimal PNG decoder for MAME snapshots: 8-bit RGB or RGBA, no interlace. */
export function decodePng(buf){
  const sig=[137,80,78,71,13,10,26,10];
  if(!sig.every((v,i)=>buf[i]===v))throw Error('R35_T5_PNG_SIGNATURE');
  let p=8,width=0,height=0,channels=0;
  const idat=[];
  while(p<buf.length){
    const len=buf.readUInt32BE(p),type=buf.toString('latin1',p+4,p+8);
    const data=buf.subarray(p+8,p+8+len);
    if(type==='IHDR'){
      width=data.readUInt32BE(0);height=data.readUInt32BE(4);
      const depth=data[8],color=data[9],interlace=data[12];
      if(depth!==8||interlace!==0||(color!==2&&color!==6))
        throw Error('R35_T5_PNG_FORMAT');
      channels=color===2?3:4;
    }else if(type==='IDAT')idat.push(data);
    else if(type==='IEND')break;
    p+=12+len;
  }
  const raw=inflateSync(Buffer.concat(idat)),stride=width*channels;
  const out=new Uint8Array(width*height*4),prev=new Uint8Array(stride);
  const row=new Uint8Array(stride);
  for(let y=0;y<height;y++){
    const f=raw[y*(stride+1)],src=raw.subarray(y*(stride+1)+1,(y+1)*(stride+1));
    for(let i=0;i<stride;i++){
      const a=i>=channels?row[i-channels]:0,b=prev[i];
      const c=i>=channels?prev[i-channels]:0;
      let v=src[i];
      if(f===1)v+=a;
      else if(f===2)v+=b;
      else if(f===3)v+=(a+b)>>1;
      else if(f===4){
        const q=a+b-c,pa=Math.abs(q-a),pb=Math.abs(q-b),pc=Math.abs(q-c);
        v+=pa<=pb&&pa<=pc?a:pb<=pc?b:c;
      }else if(f!==0)throw Error('R35_T5_PNG_FILTER');
      row[i]=v&255;
    }
    for(let x=0;x<width;x++){
      const o=(y*width+x)*4,s=x*channels;
      out[o]=row[s];out[o+1]=row[s+1];out[o+2]=row[s+2];out[o+3]=255;
    }
    prev.set(row);
  }
  return {width,height,rgba:out};
}

export function diffRgba(a,b,width){
  let count=0,first=null;
  for(let i=0;i<a.length;i+=4){
    if(a[i]!==b[i]||a[i+1]!==b[i+1]||a[i+2]!==b[i+2]){
      count++;
      if(!first)first={x:(i>>2)%width,y:((i>>2)/width)|0};
    }
  }
  return {count,first};
}

function main(){
  const [refDir='out/r35/t43-ref',zip='roms/gng.zip']=process.argv.slice(2);
  const ref=resolve(refDir);
  const gfx=gngbGraphics(n=>execFileSync('unzip',['-p',zip,n],
    {maxBuffer:1<<20}));
  const bin=readFileSync(resolve(ref,'frames.bin'));
  const metas=readFileSync(resolve(ref,'frames.jsonl'),'utf8')
    .split('\n').filter(Boolean).map(l=>JSON.parse(l));
  const pngs=new Set(readdirSync(resolve(ref,'png')));
  const rows=[];
  let exact=0,flipFrames=0;
  for(const [i,meta] of metas.entries()){
    const record=bin.subarray(i*REC.size,(i+1)*REC.size);
    const name=`${String(meta.frame).padStart(4,'0')}.png`;
    if(!pngs.has(name))throw Error('R35_T5_PNG_MISSING');
    const png=decodePng(readFileSync(resolve(ref,'png',name)));
    const ours=renderGngbRgba(rendererInputs(record,meta,gfx));
    if(png.width!==ours.width||png.height!==ours.height)
      throw Error('R35_T5_PNG_GEOMETRY');
    const flip=rendererInputs(record,meta,gfx).flipScreen;
    if(flip)flipFrames++;
    const d=diffRgba(ours.rgba,png.rgba,png.width);
    if(d.count===0)exact++;
    rows.push({index:meta.index,frame:meta.frame,flip,diff:d.count,first:d.first});
  }
  writeFileSync(resolve(ref,'render-check.json'),
    JSON.stringify({schema:'gng.r35.t5-render-check.v1',rows},null,1)+'\n');
  const bad=rows.filter(r=>r.diff);
  console.log(`R35_T5_RENDER_FRAMES=${rows.length}`);
  console.log(`R35_T5_RENDER_EXACT=${exact}`);
  console.log(`R35_T5_RENDER_FLIP_FRAMES=${flipFrames}`);
  console.log(`R35_T5_RENDER_FIRST_BAD_INDEX=${bad[0]?.index??'NONE'}`);
  console.log(`R35_T5_RENDER=${bad.length?'BLOCKED_PIXEL_MISMATCH':'PASS_ALL_FRAMES_EXACT'}`);
  if(bad.length)process.exitCode=2;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main();
