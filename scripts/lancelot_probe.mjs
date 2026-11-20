#!/usr/bin/env node
/** Lancelot phase 1 probe: runs a deterministic tape on the AOT board in
 * Node and lists the buffered sprites per captured frame, with Arthur's
 * object RAM (0x0500) and the armor byte, to find the player's sprites.
 * Usage: node scripts/lancelot_probe.mjs <profile> <frames,...> [outDir]
 */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {deflateSync} from 'node:zlib';
import {createBoard} from '../boards/gng/runtime.mjs';
import {gngCode} from '../boards/gng/bundle.mjs';
import {b3Tape} from '../src/v3_b3_tapes.mjs';
import {REC} from '../boards/gng/frame-record.mjs';
import {drawOrder} from '../src/sprite_memory.mjs';
import {renderGngbRgba} from '../src/gngb_frame_renderer.mjs';
import {rendererInputs} from '../src/gngb_render_inputs.mjs';
import {unpackGfx} from '../src/ao_web_assets.mjs';

const ASSETS=join(import.meta.dirname,'../out/android/assets');
export async function loadGame(){
  const read=n=>new Uint8Array(readFileSync(join(ASSETS,n)));
  const {blocks}=await import(pathToFileURL(join(ASSETS,'bundle/program.mjs')).href);
  const code=gngCode(JSON.parse(readFileSync(join(ASSETS,'bundle/manifest.json'),'utf8')),
    read('bundle/code.bin'),read('bundle/overlays.bin'));
  return {blocks,code,gfx:unpackGfx(read('gfx.bin'))};
}
/** Runs `tape.read` from reset and calls capture(frame) on the listed frames. */
export function runFrames({blocks,code},read,frames,capture){
  const want=new Set(frames),last=Math.max(...frames);
  const board=createBoard(code,blocks,{frames:last,portRead:read,
    onFrame:f=>{
      if(want.has(f.index))capture({index:f.index,record:f.record.slice(),
        known:f.known.slice(),scroll:[...f.scroll],latch:[...f.latch]});
      board.state.records[f.index-1]=null;board.state.events.length=0;
    }});
  return board.run(last);
}
export function writePng(file,width,height,rgba){
  const table=Uint32Array.from({length:256},(_,n)=>{
    let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
  const chunk=(type,data)=>{
    const body=Buffer.concat([Buffer.from(type),data]),head=Buffer.alloc(4),tail=Buffer.alloc(4);
    let c=0xffffffff;for(const b of body)c=table[(c^b)&255]^(c>>>8);
    head.writeUInt32BE(data.length);tail.writeUInt32BE((c^0xffffffff)>>>0);
    return Buffer.concat([head,body,tail]);};
  const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);
  header[8]=8;header[9]=6;
  const raw=Buffer.alloc((width*4+1)*height);
  for(let row=0;row<height;row++)raw.set(rgba.subarray(row*width*4,(row+1)*width*4),row*(width*4+1)+1);
  writeFileSync(file,Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),
    chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]));
}
const hex=(b,a,n)=>[...b.subarray(a,a+n)].map(v=>v.toString(16).padStart(2,'0')).join(' ');
if(import.meta.url===pathToFileURL(process.argv[1]).href){
  const [profile='arthurControls',list='1250,1300',out]=process.argv.slice(2);
  const game=await loadGame(),frames=list.split(',').map(Number);
  if(out)mkdirSync(out,{recursive:true});
  const result=runFrames(game,b3Tape(profile).read,frames,f=>{
    const r=f.record,sprites=drawOrder(r.slice(REC.buffered,REC.buffered+0x200));
    console.log(`F${f.index} armor=${r[0xac]} obj500: ${hex(r,0x500,0x30)}`);
    for(const s of sprites)console.log(`  slot${s.slot} g=${s.graphic.toString(16)} pal=${s.paletteGroup} x=${s.x} y=${s.y} fx=${+s.flipX} fy=${+s.flipY}`);
    if(out){const img=renderGngbRgba(rendererInputs(r,{scroll:f.scroll,latch:f.latch},game.gfx));
      writePng(join(out,`f${f.index}.png`),img.width,img.height,img.rgba);}
  });
  console.log('STATUS',result.status);
}

/** Arthur and Lancelot renders of one frame, plus the pixels that differ
 * and whether each lies on a player sprite (graphic-identified). */
export async function compareFrame(f,gfx){
  const {lancelotOverrides,playerSprites}=await import('../src/lancelot_skin.mjs');
  const inputs=rendererInputs(f.record,{scroll:f.scroll,latch:f.latch},gfx);
  const a=renderGngbRgba(inputs),l=renderGngbRgba({...inputs,spriteColors:lancelotOverrides});
  const player=new Uint8Array(a.width*a.height);
  for(const s of playerSprites(drawOrder(inputs.bufferedSprites))){
    for(let y=0;y<16;y++)for(let x=0;x<16;x++){
      const px=s.x+x,py=s.y+y-16;
      if(px>=0&&py>=0&&px<a.width&&py<a.height)player[py*a.width+px]=1;
    }
  }
  let changed=0,outside=0;
  for(let i=0;i<player.length;i++){
    const p=i*4;
    if(a.rgba[p]!==l.rgba[p]||a.rgba[p+1]!==l.rgba[p+1]||a.rgba[p+2]!==l.rgba[p+2]){
      changed++;if(!player[i])outside++;}
  }
  return {arthur:a,lancelot:l,changed,outside};
}
