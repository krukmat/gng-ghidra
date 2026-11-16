import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createInputShaper} from '../src/ao_input_shaper.mjs';
import {P1_SHAPING,p1Shaper} from '../games/gngb/inputs.mjs';
import {INPUT_CONTROLS,INPUT_DEFAULTS} from '../src/gngb_input_contract.mjs';

const RIGHT=0x01,LEFT=0x02,FIRE=0x10,JUMP=0x20,IDLE=0xff;
const gng=()=>createInputShaper(p1Shaper(INPUT_CONTROLS,INPUT_DEFAULTS[1]));
const down=(...bits)=>bits.reduce((v,b)=>v&~b,IDLE);
const read=(s,n)=>Array.from({length:n},()=>s.frame());
// '1' where the bit reads pressed, one character per frame.
const line=(values,bit)=>values.map(v=>v&bit?'.':'1').join('');

test('the game configuration names the board bits and the measured numbers',()=>{
  assert.deepEqual(p1Shaper(INPUT_CONTROLS,IDLE),{idle:IDLE,directionFrames:3,
    directions:0x0f,buttons:[{...P1_SHAPING.fire,bit:FIRE},{...P1_SHAPING.jump,bit:JUMP}]});
  assert.equal(P1_SHAPING.fire.every,10);assert.equal(P1_SHAPING.jump.afterDirection,1);
});

test('idle until the page reports; then a held button follows the finger',()=>{
  const s=gng();
  assert.equal(s.active,false);assert.deepEqual(read(s,2),[IDLE,IDLE]);
  s.push(down(FIRE));assert.equal(s.active,true);assert.equal(s.raw,down(FIRE));
  assert.equal(line(read(s,5),FIRE),'11111');
  s.push(IDLE);assert.equal(line(read(s,2),FIRE),'..');
});

test('a tap that comes and goes between two frames is still read',()=>{
  const s=gng();
  s.push(down(JUMP));s.push(IDLE);
  assert.equal(line(read(s,4),JUMP),'11..');
  s.push(down(RIGHT));s.push(IDLE);
  assert.equal(line(read(s,5),RIGHT),'111..');
});

test('a release and a new press between two frames keep their edge',()=>{
  const s=gng();
  s.push(down(JUMP));read(s,4);
  s.push(IDLE);s.push(down(JUMP));
  assert.equal(line(read(s,4),JUMP),'.111');
});

test('Fire sooner than the game takes it waits its turn; more taps merge',()=>{
  const s=gng();
  s.push(down(FIRE));s.push(IDLE);
  const first=read(s,4);                       // frames 0-3
  for(let k=0;k<3;k++){s.push(down(FIRE));s.push(IDLE);}
  assert.equal(line([...first,...read(s,20)],FIRE),'11........11............');
});

test('repeat fires every `every` frames while held, never without it',()=>{
  const s=gng();
  s.push(down(FIRE));
  assert.equal(line(read(s,25),FIRE),'1'.repeat(25));
  const r=gng();r.setRepeat(FIRE,true);
  r.push(down(FIRE));
  assert.equal(line(read(r,25),FIRE),'111111111.111111111.11111');
  r.push(IDLE);assert.equal(line(read(r,3),FIRE),'...');
});

test('Jump waits one frame for a direction that starts with it',()=>{
  const s=gng();
  s.push(down(RIGHT));s.push(down(RIGHT,JUMP));  // the stick diagonal from rest
  const got=read(s,4);
  assert.equal(line(got,RIGHT),'1111');assert.equal(line(got,JUMP),'.111');
  // Already running, or with no direction at all, it does not wait.
  s.push(down(RIGHT));read(s,3);s.push(down(RIGHT,JUMP));
  assert.equal(line(read(s,2),JUMP),'11');
  const still=gng();still.push(down(JUMP));
  assert.equal(line(read(still,2),JUMP),'11');
  // A turn counts as a new direction.
  const turn=gng();turn.push(down(RIGHT));read(turn,5);turn.push(down(LEFT,JUMP));
  const t=read(turn,3);
  assert.equal(line(t,LEFT),'111');assert.equal(line(t,RIGHT),'...');
  assert.equal(line(t,JUMP),'.11');
});

test('a diagonal flick inside one frame still runs first and then jumps',()=>{
  const s=gng();
  s.push(down(RIGHT));s.push(down(RIGHT,JUMP));s.push(down(RIGHT));s.push(IDLE);
  const got=read(s,5);
  assert.equal(line(got,RIGHT),'111..');assert.equal(line(got,JUMP),'.11..');
});

test('other bits pass through; without shaping it is a plain copy',()=>{
  const s=createInputShaper({buttons:[{bit:FIRE,frames:2}]});
  s.push(0x7e);assert.deepEqual(read(s,1),[0x7e]);
  s.push(0x6e);s.push(0x7f);assert.deepEqual(read(s,3),[0x6f,0x6f,0x7f]);
});
