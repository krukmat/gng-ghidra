import {test} from 'node:test';
import assert from 'node:assert/strict';
import {deflateSync} from 'node:zlib';
import {renderGngbRgba} from '../src/gngb_frame_renderer.mjs';
import {decodePng,diffRgba,gngbGraphics,rendererInputs,REC}
  from '../scripts/r35_t5_render_check.mjs';

function png(width,height,rows,filter){
  const chunk=(type,data)=>{
    const b=Buffer.alloc(12+data.length);
    b.writeUInt32BE(data.length,0);b.write(type,4,'latin1');data.copy(b,8);
    return b; // CRC is not checked by the decoder
  };
  const ihdr=Buffer.alloc(13);
  ihdr.writeUInt32BE(width,0);ihdr.writeUInt32BE(height,4);
  ihdr[8]=8;ihdr[9]=2;
  const raw=Buffer.concat(rows.map(r=>Buffer.from([filter,...r])));
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),
    chunk('IHDR',ihdr),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}

test('PNG decoder applies sub and up filters', () => {
  const sub=decodePng(png(2,1,[[10,20,30,1,1,1]],1));
  assert.deepEqual([...sub.rgba],[10,20,30,255,11,21,31,255]);
  const up=decodePng(png(1,2,[[5,6,7],[1,1,1]],2));
  assert.deepEqual([...up.rgba],[5,6,7,255,6,7,8,255]);
});

test('gfx regions follow ROM_START(gngb) and erase sprite gaps to 0xff', () => {
  const names=[];
  const g=gngbGraphics(n=>{names.push(n);return new Uint8Array(0x4000).fill(names.length);});
  assert.equal(g.chars[0],1);
  assert.equal(g.tiles[0],2);       // gg11 first
  assert.equal(g.tiles[0x14000],7); // gg6 last
  assert.equal(g.sprites[0xc000],0xff);
  assert.equal(g.sprites[0x1c000],0xff);
  assert.equal(g.sprites[0x18000],13); // gg12
});

test('flip screen turns the visible raster 180 degrees', () => {
  const blank=new Uint8Array(REC.size);
  const meta={scroll:[null,null,null,null],latch:[1]};
  const gfx={chars:new Uint8Array(0x4000).fill(0xff),
    tiles:new Uint8Array(0x18000),sprites:new Uint8Array(0x20000).fill(0xff)};
  const inputs=rendererInputs(blank,meta,gfx);
  assert.equal(inputs.flipScreen,false);
  inputs.videoAddressSpace[0x2800]=1; // one non-blank BG tile at top-left
  for(let i=0;i<0x18000;i++)gfx.tiles[i]=i<256?0xff:0;
  inputs.palette[4]=200;
  const a=renderGngbRgba(inputs),b=renderGngbRgba({...inputs,flipScreen:true});
  const n=a.rgba.length;
  for(let i=0;i<n;i+=4)
    assert.equal(b.rgba[i],a.rgba[n-4-i]);
  assert.equal(rendererInputs(blank,{...meta,latch:[null]},gfx).flipScreen,true);
});

test('diff reports count and first differing pixel', () => {
  const a=new Uint8Array(16),b=new Uint8Array(16);
  b[9]=1;
  assert.deepEqual(diffRgba(a,b,2),{count:1,first:{x:0,y:1}});
});
