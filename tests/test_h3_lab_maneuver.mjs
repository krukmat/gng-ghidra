import test from 'node:test';
import assert from 'node:assert/strict';
import {CYCLES_PER_FRAME as CPF} from '../src/gngb_runtime.mjs';
import {segmentEvents,routeEvents,maneuverOutcome} from '../src/h3_lab_maneuver.mjs';

const f=e=>e.map(x=>`${x.cycle/CPF}:${x.control}${x.pressed?'+':'-'}`);

test('segmentos con la cadencia de la búsqueda (K=23)',()=>{
  // right_jump at 7221 as in search-p1-7290.json.
  assert.deepEqual(f(segmentEvents(7221,'right_jump',23)),
    ['7221:p1.right+','7222:p1.button2+','7227:p1.button2-','7243:p1.right-']);
  assert.deepEqual(f(routeEvents(7221,['left','idle','right'],23)),
    ['7221:p1.left+','7243:p1.left-','7267:p1.right+','7289:p1.right-']);
  assert.throws(()=>segmentEvents(7221,'warp',23),/H3_MANEUVER_ACTION/);
});

test('resultado: impacto sin armadura es fatal; avance exige 60 filas por encima',()=>{
  const row=(frame,x,mode=1,armor=1,lives=2,handler=0x9795)=>({frame,x,mode,armor,lives,handler});
  const rows=[...Array(70)].map((_,i)=>row(7221+i,5465));
  assert.deepEqual(maneuverOutcome(rows,{lives:2}),
    {hit:null,fatal:null,maxX:5465,aboveLimit:70,local:true,advance:true});
  rows[30]=row(7251,5465,3);
  assert.deepEqual(maneuverOutcome(rows,{lives:2}),
    {hit:7251,fatal:7251,maxX:5465,aboveLimit:39,local:false,advance:false});
  assert.equal(maneuverOutcome([row(1,5449,3,0)],{lives:2}).fatal,null);
  assert.equal(maneuverOutcome([row(1,5449,1,1,1)],{lives:2}).fatal,1);
  assert.equal(maneuverOutcome([row(1,5449,1,1,2,0x9c64)],{lives:2}).fatal,1);
});
