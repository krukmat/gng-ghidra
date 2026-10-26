import {test} from 'node:test';
import assert from 'node:assert/strict';
import {certifyV2Coverage,MIN_V2_CONTIGUOUS_PIXEL_FRAMES}
  from '../src/v2_b1_coverage.mjs';
const SHA_A='a'.repeat(64),SHA_B='b'.repeat(64);
function example({firstDMA=311,firstFull=7,noDMA=null,change=true}={}){
  const observed=Array.from({length:600},(_,i)=>({
    frame:i+1,state_complete:i+1>=firstFull,
    renderer_known:i+1>=firstDMA&&(i+1!==noDMA)
  }));
  const pixelHashes=observed.map((r,i)=>r.renderer_known
    ?(change&&i+1>=492?SHA_B:SHA_A):null);
  return {observed,pixelHashes};
}
test('290 fully observed, pixel-equal frames in contiguous 311..600 certify V2',()=>{
  const x=example();
  const p=certifyV2Coverage(x.observed,x.pixelHashes);
  assert.equal(p.state_exact_frames,594);
  assert.equal(p.pixel_exact_frames,290);
  assert.equal(p.first_fully_known,7);
  assert.equal(p.first_renderer_known,311);
  assert.equal(p.prior_frames_pixel_unverified,310);
  assert.equal(p.pixel_interval_start,311);
  assert.equal(p.pixel_interval_end,600);
  assert.equal(p.pixels_distinct,2);
});
test('must not count a pre-DMA buffer as a pixel-equal frame',()=>{
  const x=example();
  x.pixelHashes[309]=SHA_A;
  assert.throws(()=>certifyV2Coverage(x.observed,x.pixelHashes),
    /V2_B1_CERT_PIXEL_PROVENANCE_INCOMPLETE/);
});
test('too-short real DMA interval cannot certify V2',()=>{
  const x=example({firstDMA:346});
  assert.equal(600-346+1,255);
  assert.throws(()=>certifyV2Coverage(x.observed,x.pixelHashes),
    /V2_B1_CERT_PIXEL_INTERVAL_INSUFFICIENT/);
});
test('one unexpected missing valid sprite buffer breaks contiguity',()=>{
  const x=example({noDMA:500});
  assert.throws(()=>certifyV2Coverage(x.observed,x.pixelHashes),
    /V2_B1_CERT_PIXEL_INTERVAL_INSUFFICIENT/);
});
test('no animation or all-static pixels cannot certify autonomous game frame',()=>{
  const x=example({change:false});
  assert.throws(()=>certifyV2Coverage(x.observed,x.pixelHashes),
    /V2_B1_CERT_NO_VISUAL_CHANGE/);
});
test('unknown state after frame 6 is not silently accepted',()=>{
  const x=example({firstFull:8});
  assert.throws(()=>certifyV2Coverage(x.observed,x.pixelHashes),
    /V2_B1_CERT_STATE_COVERAGE_INSUFFICIENT/);
});
test('policy maintains meaningful minimum, not zero or one sampled pixel',()=>{
  assert.equal(MIN_V2_CONTIGUOUS_PIXEL_FRAMES,256);
  const x=example();
  assert.throws(()=>certifyV2Coverage(x.observed,x.pixelHashes,{minimumPixels:0}),
    /V2_B1_CERT_COVERAGE_INPUT_INVALID/);
});
