import {test} from 'node:test';
import assert from 'node:assert/strict';
import {deflateSync} from 'node:zlib';
import {readReplayContactPng,replayContactFrame}
  from '../../bot/perception/png-contact.mjs';
const signature=Buffer.from([137,80,78,71,13,10,26,10]);
const chunk=(type,data)=>{
  const h=Buffer.alloc(8);h.writeUInt32BE(data.length);h.write(type,4);
  return Buffer.concat([h,data,Buffer.alloc(4)]);
};
function samplePng(){
  const w=256,h=224,ihdr=Buffer.alloc(13),raw=Buffer.alloc((w*4+1)*h);
  ihdr.writeUInt32BE(w);ihdr.writeUInt32BE(h,4);ihdr[8]=8;ihdr[9]=6;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const i=y*(w*4+1)+1+x*4;raw[i]=x;raw[i+1]=y;raw[i+3]=255;
  }
  return Buffer.concat([signature,chunk('IHDR',ihdr),
    chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
test('reads narrow contact-sheet PNG format and exact RGBA pixel',()=>{
  const sheet=readReplayContactPng(samplePng()),f=replayContactFrame(sheet,0);
  assert.equal(f.rgba.length,256*224*4);
  assert.deepEqual([...f.rgba.slice((10*256+20)*4,(10*256+20)*4+4)],
    [20,10,0,255]);
});
test('invalid files and nonexistent frames are rejected',()=>{
  assert.throws(()=>readReplayContactPng(Buffer.from('no')),/SIGNATURE/);
  assert.throws(()=>replayContactFrame(readReplayContactPng(samplePng()),2),/MISSING/);
});
