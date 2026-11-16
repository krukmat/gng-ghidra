import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPulseLatch} from '../base/src/host/web/engine-worker.mjs';

// As in the base engine worker: a page message updates the ports at once;
// the engine reads them during each frame and, while a tap shows, the latch
// moves on after the frame.
function rig(pulse,count=2){
  const ports=new Uint8Array(count).fill(255),taps=createPulseLatch(pulse,count);
  return {
    page:(values,mask)=>{taps.input(values,mask);taps.apply(ports);},
    frames:n=>Array.from({length:n},()=>{
      const read=[...ports];
      if(taps.active){taps.frame();taps.apply(ports);}
      return read;
    }),
  };
}

test('a tap that comes and goes between two bursts still lasts its frames',()=>{
  const r=rig({frames:3,gapFrames:2});
  r.page([0xbf,255],[0x40,0]);r.page([255,255],[0,0]);
  assert.deepEqual(r.frames(5).map(p=>p[0]),[0xbf,0xbf,0xbf,255,255]);
});

test('two taps in one gap stay two, with released frames between them',()=>{
  const r=rig({frames:3,gapFrames:2});
  for(let k=0;k<2;k++){r.page([0xbf,255],[0x40,0]);r.page([255,255],[0,0]);}
  assert.deepEqual(r.frames(10).map(p=>p[0]),
    [0xbf,0xbf,0xbf,255,255,0xbf,0xbf,0xbf,255,255]);
});

test('other bits follow the page at once; a tap the page still holds goes on',()=>{
  const r=rig({frames:2,gapFrames:2});
  r.page([0xbf,0xf7],[0x40,0]); // a Coin tap while a direction is held
  assert.deepEqual(r.frames(1),[[0xbf,0xf7]]);
  r.page([0xbf,0xff],[0x40,0]); // the direction goes, the tap stays
  assert.deepEqual(r.frames(3),[[0xbf,0xff],[0xbf,0xff],[0xbf,0xff]]);
  r.page([255,255],[0,0]);
  assert.deepEqual(r.frames(1),[[255,255]]);
});

test('the pressed level is the one the tap set; without frames, a plain copy',()=>{
  const high=rig({frames:2,gapFrames:1},1);
  high.page([0x01],[0x01]);high.page([0x00],[0]);
  assert.deepEqual(high.frames(3).map(p=>p[0]),[1,1,0]);
  const plain=rig(undefined);
  plain.page([0xbf,0xfe],[0x40,0x01]);plain.page([255,255],[0,0]);
  assert.deepEqual(plain.frames(1),[[255,255]]);
});
