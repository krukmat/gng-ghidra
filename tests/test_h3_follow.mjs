import test from 'node:test';
import assert from 'node:assert/strict';
import {CYCLES_PER_FRAME as CPF} from '../src/gngb_runtime.mjs';
import {defineInputSchedule} from '../src/gngb_input_contract.mjs';
import {masksToEvents,eventsToMasks} from '../src/h3_explore.mjs';
import {trailWindow,matchTrail,followEvents,joinEvents,heldMask} from '../src/h3_follow.mjs';

const f=e=>e.map(x=>`${x.cycle/CPF}:${x.control}${x.pressed?'+':'-'}`);
// Trail from donor frame 100: walks right 1 px/frame, waits, then climbs.
const trail=(()=>{
  const pts=[];
  for(let i=0;i<20;i++)pts.push([10+i,50]);
  for(let i=0;i<10;i++)pts.push([29,50]);
  for(let i=0;i<10;i++)pts.push([29,51+i]);
  pts.push([-1,-1]); // donor left the phase
  const pos=new Int32Array(2*pts.length);pts.forEach(([x,y],i)=>{pos[2*i]=x;pos[2*i+1]=y;});
  return {lo:100,hi:100+pts.length-1,pos};
})();
const W={behind:5,ahead:15};

test('follow: la ventana crece con el segmento',()=>{
  assert.deepEqual(trailWindow(20),{behind:100,ahead:90});
});

test('follow: el emparejamiento sigue la ruta, salta esperas y no sale de la ventana',()=>{
  assert.deepEqual(matchTrail(trail,{x:15,y:50},100,W),{k:105,d:0});
  // A wait is skipped up to the window: same position, later frame.
  assert.deepEqual(matchTrail(trail,{x:29,y:50},110,W),{k:125,d:0});
  assert.deepEqual(matchTrail(trail,{x:29,y:50},120,W),{k:129,d:0});
  // Behind or off the route: nearest point in [k-behind,k+ahead], with its distance.
  assert.deepEqual(matchTrail(trail,{x:12,y:50},110,W),{k:105,d:3});
  assert.deepEqual(matchTrail(trail,{x:27,y:58},125,W),{k:137,d:2});
  // Frames where the donor is not in the phase are never matched.
  assert.deepEqual(matchTrail(trail,{x:29,y:60},138,W),{k:139,d:0});
  assert.deepEqual(matchTrail({lo:0,hi:2,pos:Int32Array.from([-1,-1,-1,-1,-1,-1])},{x:1,y:1},1,W),{k:1,d:Infinity});
});

test('follow: reproduce las máscaras del donante desde el emparejamiento',()=>{
  const donor=masksToEvents(200,Uint8Array.from([1,1,17,17,1,0,8,8]),0);
  const masks=eventsToMasks(200,210,donor);
  const a=followEvents(masks,200,202,1000,4,1);
  assert.deepEqual(f(a.events),['1000:p1.button1+','1002:p1.button1-','1003:p1.right-']);
  assert.equal(a.mask,0);
  // Continuing a held mask emits only the changes; the result is a valid schedule.
  const b=followEvents(masks,200,205,1004,3,a.mask);
  assert.deepEqual(f(b.events),['1005:p1.up+']);assert.equal(b.mask,8);
  defineInputSchedule([{cycle:999*CPF,control:'p1.right',pressed:true},...a.events,...b.events,
    {cycle:1007*CPF,control:'p1.up',pressed:false}]);
  assert.throws(()=>followEvents(masks,200,208,0,3,0),/MASK_RANGE/);
});

test('follow: una macro tras follow suelta lo retenido salvo lo que pulsa en el mismo frame',()=>{
  const macro=[{cycle:50*CPF,control:'p1.right',pressed:true},{cycle:51*CPF,control:'p1.button1',pressed:true},
    {cycle:54*CPF,control:'p1.button1',pressed:false},{cycle:69*CPF,control:'p1.right',pressed:false}];
  const press=(...c)=>c.map(control=>({cycle:40*CPF,control,pressed:true}));
  // Right is already held: its press is dropped; fire is released, then pressed again.
  const kept=joinEvents(50,1|16,macro);
  assert.deepEqual(f(kept),['50:p1.button1-','51:p1.button1+','54:p1.button1-','69:p1.right-']);
  defineInputSchedule([...press('p1.button1','p1.right'),...kept]);
  // Down is not pressed by the macro: released in the macro's first frame.
  const joined=joinEvents(50,4|16,macro);
  assert.deepEqual(f(joined),['50:p1.button1-','50:p1.down-','50:p1.right+','51:p1.button1+','54:p1.button1-','69:p1.right-']);
  defineInputSchedule([...press('p1.button1','p1.down'),...joined]);
  assert.deepEqual(joinEvents(50,0,macro),macro);
});

test('follow: máscara retenida al final de una cinta',()=>{
  assert.equal(heldMask([]),0);
  assert.equal(heldMask(masksToEvents(10,Uint8Array.from([1,33,32]),0).slice(0,-1)),32);
  assert.equal(heldMask([{cycle:0,control:'coin1',pressed:true},{cycle:1,control:'p1.left',pressed:true}]),2);
});
