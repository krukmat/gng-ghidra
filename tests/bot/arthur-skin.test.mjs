import {test} from 'node:test';
import assert from 'node:assert/strict';
import {detectArthurSkin} from '../../bot/perception/arthur-skin.mjs';
test('body palette returns only unverified Arthur candidate',()=>{
  const rgba=new Uint8Array(256*224*4);
  for(let y=130;y<146;y++)for(let x=118;x<137;x++)
    rgba.set([170,136,102,255],(y*256+x)*4);
  const r=detectArthurSkin({rgba});
  assert.equal(r.kind,'ARTHUR_SKIN_CANDIDATE');
  assert.equal(r.x,127);
  assert.equal(r.grounded,null);
  assert.equal(r.verified,false);
});
test('missing or ambiguous skin never claims Arthur',()=>{
  const rgba=new Uint8Array(256*224*4);
  assert.equal(detectArthurSkin({rgba}).kind,'UNKNOWN');
  for(let y=130;y<145;y++)for(const x0 of [80,180])
    for(let x=x0;x<x0+20;x++)
      rgba.set([204,170,136,255],(y*256+x)*4);
  assert.equal(detectArthurSkin({rgba}).reason,'AMBIGUOUS_BODY_PALETTE');
});
