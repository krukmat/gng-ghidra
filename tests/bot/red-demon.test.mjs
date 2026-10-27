import {test} from 'node:test';
import assert from 'node:assert/strict';
import {detectRedDemon} from '../../bot/perception/red-demon.mjs';
test('red head and blue body are only a visual candidate, not a kill',()=>{
  const rgba=new Uint8Array(256*224*4);
  for(let y=145;y<151;y++)for(let x=20;x<31;x++)
    rgba.set([170,0,0,255],(y*256+x)*4);
  for(let y=151;y<170;y++)for(let x=18;x<35;x++)
    rgba.set([68,68,170,255],(y*256+x)*4);
  const r=detectRedDemon({rgba});
  assert.equal(r.status,'VISIBLE_CANDIDATE');
  assert.equal(r.defeat,'UNKNOWN');
  assert.equal(r.verified,false);
});
test('leaving screen or being hidden is not evidence of boss defeat',()=>{
  assert.equal(detectRedDemon({rgba:new Uint8Array(256*224*4)}).status,
    'UNKNOWN');
});
