/**
 * V3.B1.T1 — gngb active-low controls contract (MAME 0.289 gng.cpp).
 * Independent of CPU, AOT compiler, renderer and native reference.
 * Absolute integer cycles start at reset; events apply BEFORE a read at
 * the same cycle. This module neither edits CPU state nor dispatches code.
 */
import {INPUT_PORTS,INPUT_CONTROLS,IDLE_BYTES} from '../boards/gng/inputs.mjs';
import {DIP_DEFAULTS,fourWayConflict} from '../games/gngb/inputs.mjs';

export const INPUT_SCHEMA='gng.v3.input-contract.v1';
// Ports and bits are the board's; DIP defaults and the 4-way policy the game's.
export {INPUT_PORTS,INPUT_CONTROLS};
export const INPUT_DEFAULTS=Object.freeze([...IDLE_BYTES,...DIP_DEFAULTS]);
const PORT_NAMES=Object.freeze(Object.keys(INPUT_PORTS));
const deny=reason=>{throw Error('V3_B1_INPUT_'+reason);};
const VALID_SCHEDULES=new WeakSet();
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
  (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);
const cycleOk=x=>Number.isSafeInteger(x)&&x>=0;
const byteOk=x=>Number.isInteger(x)&&x>=0&&x<=255;
const own=(x,k)=>Object.prototype.hasOwnProperty.call(x,k);

function validateOptions(options){
  if(!plain(options)||Object.keys(options).some(k=>!['dip1','dip2'].includes(k)))
    deny('OPTIONS_INVALID');
  for(const [k,defaultValue] of [['dip1',INPUT_DEFAULTS[3]],['dip2',INPUT_DEFAULTS[4]]]){
    const v=own(options,k)?options[k]:defaultValue;
    if(!byteOk(v))deny('DIP_INVALID');
  }
  return [own(options,'dip1')?options.dip1:INPUT_DEFAULTS[3],
    own(options,'dip2')?options.dip2:INPUT_DEFAULTS[4]];
}
function checkDirections(pressed){
  if(fourWayConflict(pressed))deny('FOUR_WAY_COMBINATION');
}
function portsFrom(pressed,dips){
  const bytes=[INPUT_DEFAULTS[0],INPUT_DEFAULTS[1],INPUT_DEFAULTS[2],
    dips[0],dips[1]];
  for(const control of pressed){
    const spec=INPUT_CONTROLS[control];
    const index=PORT_NAMES.indexOf(spec.port);
    bytes[index]&=~spec.bit;
  }
  return Object.freeze(bytes);
}

/**
 * T1 immutable, validated schedule. Same-cycle transitions are ATOMIC:
 * release-left and press-right can share a cycle. A control may have at
 * most one transition at a cycle, avoiding ordering dependence.
 */
export function defineInputSchedule(events=[],options={}){
  const dips=validateOptions(options);
  if(!Array.isArray(events)||events.length>100000)deny('SCHEDULE_INVALID');
  const normalized=[];
  let lastCycle=-1;
  for(const raw of events){
    if(!plain(raw)||Object.keys(raw).length!==3||
       !['cycle','control','pressed'].every(k=>own(raw,k))||
       !cycleOk(raw.cycle)||typeof raw.control!=='string'||
       !own(INPUT_CONTROLS,raw.control)||typeof raw.pressed!=='boolean')
      deny('EVENT_INVALID');
    if(raw.cycle<lastCycle)deny('CYCLE_REGRESSION');
    lastCycle=raw.cycle;
    normalized.push({cycle:raw.cycle,control:raw.control,pressed:raw.pressed});
  }
  const pressed=new Set();
  const steps=[];
  const canonical=[];
  for(let start=0;start<normalized.length;){
    let end=start+1;
    const cycle=normalized[start].cycle;
    while(end<normalized.length&&normalized[end].cycle===cycle)end++;
    const group=normalized.slice(start,end).sort((a,b)=>
      a.control<b.control?-1:a.control>b.control?1:0);
    const seen=new Set();
    for(const e of group){
      if(seen.has(e.control))deny('DUPLICATE_SAME_CYCLE');
      seen.add(e.control);
      if(pressed.has(e.control)===e.pressed)
        deny('IMPOSSIBLE_TRANSITION');
    }
    for(const e of group){
      if(e.pressed)pressed.add(e.control);
      else pressed.delete(e.control);
      canonical.push(Object.freeze(e));
    }
    checkDirections(pressed);
    steps.push(Object.freeze({cycle,bytes:portsFrom(pressed,dips)}));
    start=end;
  }
  const schedule=Object.freeze({
    schema:INPUT_SCHEMA,
    dips:Object.freeze([...dips]),
    events:Object.freeze(canonical),
    steps:Object.freeze(steps)
  });
  VALID_SCHEDULES.add(schedule);
  return schedule;
}
/** Deterministic random-access read. T2 will wire it to CPU port reads. */
export function readScheduledPort(schedule,address,cycle){
  if(!VALID_SCHEDULES.has(schedule))deny('CONTRACT_INVALID');
  if(!cycleOk(cycle))deny('READ_CYCLE_INVALID');
  if(!Number.isInteger(address)||address<0x3000||address>0x3004)
    deny('PORT_INVALID');
  const index=address-0x3000,steps=schedule.steps;
  let low=0,high=steps.length;
  while(low<high){
    const mid=(low+high)>>>1;
    if(steps[mid].cycle<=cycle)low=mid+1;else high=mid;
  }
  if(low===0)return index<3?INPUT_DEFAULTS[index]:schedule.dips[index-3];
  return steps[low-1].bytes[index];
}
/** Useful in tests and forthcoming CPU integration; pure and read-only. */
export function readScheduledPorts(schedule,cycle){
  return Object.freeze(PORT_NAMES.map(port=>
    readScheduledPort(schedule,INPUT_PORTS[port],cycle)));
}
