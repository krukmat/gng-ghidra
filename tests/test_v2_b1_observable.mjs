import {test} from 'node:test';
import assert from 'node:assert/strict';
import {rendererUnknownCount} from '../src/v2_b1_observable.mjs';

test('observable video RAM unknown counts separately from nonvideo RAM',()=>{
 const known=new Uint8Array(0x3800);
 known.fill(255,0x2000);
 const r={known,sprite_buffer_valid:true};
 assert.equal(rendererUnknownCount(r),0);
 known[0x2300]=0;
 assert.equal(rendererUnknownCount(r),1);
 known[0x100]=0;
 assert.equal(rendererUnknownCount(r),1);
});
test('sprite buffer cannot be certified before DMA even if filled with zero bytes',()=>{
 const known=new Uint8Array(0x3800).fill(255);
 assert.equal(rendererUnknownCount({known,sprite_buffer_valid:false}),512);
 assert.equal(rendererUnknownCount({known,sprite_buffer_valid:true}),0);
});
