import {test} from 'node:test';
import assert from 'node:assert/strict';
import {followBase,knobOffset,stickSector,STICK} from '../src/ao_stick.mjs';

const R=50;
const at=(deg,r=40)=>[r*Math.cos(deg*Math.PI/180),-r*Math.sin(deg*Math.PI/180)];
const name=(deg,current,r)=>stickSector(...at(deg,r),R,current)?.name??null;

test('six sectors: upper diagonals jump, straight up climbs',()=>{
  assert.deepEqual(stickSector(40,0,R),
    {name:'right',from:-45,to:15,dir:'p1.right',jump:false});
  assert.equal(name(0),'right');assert.equal(name(14),'right');
  assert.equal(name(16),'up-right');assert.equal(name(74),'up-right');
  assert.equal(name(76),'up');assert.equal(name(90),'up');assert.equal(name(104),'up');
  assert.equal(name(106),'up-left');assert.equal(name(164),'up-left');
  assert.equal(name(166),'left');assert.equal(name(180),'left');
  assert.equal(name(-150),'left');                 // 210 degrees
  assert.equal(name(-90),'down');assert.equal(name(-46),'down');
  assert.equal(name(-44),'right');
  assert.deepEqual([stickSector(...at(45),R).dir,stickSector(...at(45),R).jump],
    ['p1.right',true]);
  assert.deepEqual([stickSector(...at(135),R).dir,stickSector(...at(135),R).jump],
    ['p1.left',true]);
  assert.equal(stickSector(0,-40,R).jump,false);   // screen y grows downwards
});
test('dead zone and hysteresis keep a held sector steady',()=>{
  assert.equal(name(0,null,R*STICK.dead-1),null);
  assert.equal(name(0,'right',R*0.25),'right');
  assert.equal(name(0,'right',R*0.2),null);
  // Running right with the thumb a little high does not jump...
  assert.equal(name(22,'right'),'right');
  assert.equal(name(24,'right'),'up-right');
  // ~20 px of thumb at the 48 px rim reaches it: atan(20/48) = 22.6 degrees.
  assert.equal(stickSector(48,-21,48,'right').name,'up-right');
  // ...and a jump diagonal does not fall back to climbing at once.
  assert.equal(name(82,'up-right'),'up-right');
  assert.equal(name(84,'up-right'),'up');
  assert.equal(name(70,'up'),'up');assert.equal(name(66,'up'),'up-right');
  // Across the 315/-45 seam.
  assert.equal(name(-50,'right'),'right');
  assert.equal(name(-40,'down'),'down');
});
test('the base follows a long drag and the knob stays on the rim',()=>{
  const base={x:100,y:100};
  assert.deepEqual(followBase(base,{x:130,y:100},R),base);
  assert.deepEqual(followBase(base,{x:180,y:100},R),{x:130,y:100});
  assert.deepEqual(knobOffset(base,{x:100,y:20},R),{x:0,y:-50});
  assert.deepEqual(knobOffset(base,{x:110,y:100},R),{x:10,y:0});
  // After following, turning back answers at once.
  const moved=followBase(base,{x:180,y:100},R);
  assert.equal(stickSector(100-moved.x,0,R,'right').name,'left');
});
