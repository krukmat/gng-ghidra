import {test} from 'node:test';
import assert from 'node:assert/strict';
import {renderGngbRgba} from '../src/gngb_frame_renderer.mjs';

// Frozen FNV-1a fingerprints independently obtained from the original R1
// HTML compositor at commit 65eace2 (before shared renderer extraction).
// Only deterministic synthetic graphics, RAM, palette and scroll are used.
const R1_GOLDENS=[
  ['72a283e8',1],['21fc27eb',2],['ba599bfc',3],['a21fcd35',4]
];
function rng(seed){
  let x=seed>>>0;
  return ()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return x>>>0;};
}
function fixture(seed){
  const next=rng(seed);
  const allocate=(size,random=true)=>{
    const a=new Uint8Array(size);
    if(random)for(let i=0;i<a.length;i++)a[i]=next()&255;
    return a;
  };
  const videoAddressSpace=allocate(65536,false);
  for(let a=0x2000;a<0x3000;a++)videoAddressSpace[a]=next()&255;
  return {
    videoAddressSpace,
    bufferedSprites:allocate(0x200),
    chars:allocate(0x4000),tiles:allocate(0x18000),
    sprites:allocate(0x20000),palette:allocate(0x400),
    scroll:{x:seed*77%512,y:seed*199%512}
  };
}
function fnv32(arr){
  let hash=2166136261;
  for(const value of arr)hash=Math.imul(hash^value,16777619);
  return (hash>>>0).toString(16).padStart(8,'0');
}
test('shared compositor preserves 4 frozen pre-extraction R1 RGBA fingerprints',()=>{
  for(const [expected,seed] of R1_GOLDENS){
    const frame=renderGngbRgba(fixture(seed));
    assert.equal(frame.width,256);
    assert.equal(frame.height,224);
    assert.equal(frame.rgba.length,229376);
    assert.equal(fnv32(frame.rgba),expected,'R1 pixel regression seed='+seed);
  }
});
