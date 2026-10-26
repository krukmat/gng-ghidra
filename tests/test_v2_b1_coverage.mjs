import {test} from 'node:test';
import assert from 'node:assert/strict';
import {summarizeCoverage,FRAME_BYTES} from '../src/v2_b1_coverage.mjs';

function sample({frames=8,allDma=true,unknownFrames=[1,2,3,4,5,6]}={}){
 const known=new Uint8Array(frames*FRAME_BYTES).fill(255);
 const unknowns=Array(frames).fill(0);
 const visible_unknowns=Array(frames).fill(0);
 const rows=Array.from({length:frames},(_,i)=>({index:i+1,sprite_buffer_valid:allDma}));
 for(const frame of unknownFrames){
   known[(frame-1)*FRAME_BYTES+0x100]=0;
   unknowns[frame-1]=1;
 }
 if(!allDma)visible_unknowns.fill(512);
 return {report:{frames,unknowns,visible_unknowns},known,rows};
}
test('baseline of first six unknown frames and two known frames is correctly counted',()=>{
 const x=summarizeCoverage(sample(),{required:2});
 assert.equal(x.state_exact,2);
 assert.equal(x.renderer_known,8);
 assert.equal(x.first_state_exact,7);
 assert.equal(x.first_renderer_known,1);
 assert.equal(x.first_unready_frame_after_six,null);
 assert.equal(x.cause,'COVERAGE_COUNTS_OK');
});
test('missing state known after sixth frame is distinguished from pixel readiness',()=>{
 const input=sample({unknownFrames:[1,2,3,4,5,6,7]});
 const x=summarizeCoverage(input,{required:2});
 assert.equal(x.cause,'STATE_KNOWN_FRAMES_BELOW_GATE');
 assert.equal(x.first_unready_frame_after_six,7);
 assert.equal(x.inspected_unknowns_by_region.MAIN_RAM,1);
 assert.equal(x.inspected_unknowns_by_region.FG,0);
});
test('pre-DMA sprite buffer is not silently counted as observed',()=>{
 const x=summarizeCoverage(sample({allDma:false}),{required:2});
 assert.equal(x.cause,'DMA_NOT_VALID_FOR_ENOUGH_FRAMES');
 assert.equal(x.dma_valid,0);
 assert.equal(x.first_dma_valid,null);
 assert.equal(x.inspected_sprite_buffer_valid,false);
});
test('invalid summary arguments reject and do not invent frames',()=>{
 assert.throws(()=>summarizeCoverage({report:{frames:5}}),/INPUT_INVALID/);
 assert.throws(()=>summarizeCoverage(sample(),{required:9}),/INPUT_INVALID/);
});
