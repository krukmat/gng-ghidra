import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWaterController} from '../../bot/policy/water-controller.mjs';
const sensor=(frame,px)=>({frame,session:'s',lifeKey:'l',playing:true,
  arthur:{x:px,feetY:100,grounded:true,confidence:1},
  water:{left:100,right:230,confidence:1},
  platform:{left:128-2*(frame-1),right:160-2*(frame-1),topY:100,confidence:1}});

test('crossing controller exposes only valid P1 commands and hands back control',()=>{
  const p=createWaterController({flightFrames:12,runSpeedPxPerFrame:2,
    takeoffBufferPx:15,jumpHoldFrames:3});
  const a=p.step(sensor(1,50));
  assert.equal(a.phase,'APPROACH');
  assert.deepEqual(a.commands,[{control:'p1.right',pressed:true}]);
  const w=p.step(sensor(2,89));
  assert.equal(w.phase,'WAIT');
  assert.deepEqual(w.commands,[{control:'p1.right',pressed:false}]);
  const t=p.step(sensor(3,89));
  assert.equal(t.phase,'TAKEOFF');
  assert.deepEqual(t.commands,[
    {control:'p1.right',pressed:true},{control:'p1.button2',pressed:true},
  ]);
  const flight=p.step({...sensor(4,90),arthur:{x:90,feetY:90,
    grounded:false,confidence:1}});
  assert.equal(flight.phase,'AIRBORNE');
  assert.deepEqual(flight.commands,[]);
  p.step({...sensor(5,91),arthur:{x:91,feetY:85,
    grounded:false,confidence:1}});
  const change=p.step({...sensor(6,92),arthur:{x:92,feetY:85,
    grounded:false,confidence:1}});
  assert.deepEqual(change.commands,[{control:'p1.button2',pressed:false}]);
  const lost=p.step({...sensor(7,93),session:'new'});
  assert.equal(lost.phase,'STOP');
  assert.deepEqual(lost.commands,[{control:'p1.right',pressed:false}]);
});
