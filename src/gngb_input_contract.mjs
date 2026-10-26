/**
 * V3.B1.T1 — gngb active-low controls contract (MAME 0.289 gng.cpp).
 * Independent of CPU, AOT compiler, renderer and native reference.
 * Absolute integer cycles start at reset; events apply BEFORE a read at
 * the same cycle. This module neither edits CPU state nor dispatches code.
 */
export const INPUT_SCHEMA='gng.v3.input-contract.v1';
export const INPUT_PORTS=Object.freeze({
  SYSTEM:0x3000,P1:0x3001,P2:0x3002,DSW1:0x3003,DSW2:0x3004,
});
export const INPUT_DEFAULTS=Object.freeze([0xff,0xff,0xff,0xdf,0xfb]);
const PORT_NAMES=Object.freeze(Object.keys(INPUT_PORTS));
const CONTROL_SPECS=Object.freeze({
  start1:['SYSTEM',0x01],start2:['SYSTEM',0x02],
  service1:['SYSTEM',0x20],coin1:['SYSTEM',0x40],coin2:['SYSTEM',0x80],
  'p1.right':['P1',0x01],'p1.left':['P1',0x02],
  'p1.down':['P1',0x04],'p1.up':['P1',0x08],
  'p1.button1':['P1',0x10],'p1.button2':['P1',0x20],
  'p2.right':['P2',0x01],'p2.left':['P2',0x02],
  'p2.down':['P2',0x04],'p2.up':['P2',0x08],
  'p2.button1':['P2',0x10],'p2.button2':['P2',0x20],
});
export const INPUT_CONTROLS=Object.freeze(
  Object.fromEntries(Object.entries(CONTROL_SPECS).map(([name,[port,bit]])=>
    [name,Object.freeze({port,bit,activeLow:true})]))
);
const deny=reason=>{throw Error('V3_B1_INPUT_'+reason);};
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
  // Conservative frontend policy for MAME's PORT_4WAY: reject conflicting
  // input combinations, not a claim about its live joystick resolution.
  for(const player of ['p1','p2']){
    const dirs=['up','down','left','right'].filter(d=>pressed.has(player+'.'+d));
    if(dirs.length>1)deny('FOUR_WAY_COMBINATION');
  }
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
  return Object.freeze({
    schema:INPUT_SCHEMA,
    dips:Object.freeze([...dips]),
    events:Object.freeze(canonical),
    steps:Object.freeze(steps)
  });
}
/** Deterministic random-access read. T2 will wire it to CPU port reads. */
export function readScheduledPort(schedule,address,cycle){
  if(schedule?.schema!==INPUT_SCHEMA||
     !Array.isArray(schedule.steps)||!Array.isArray(schedule.dips))
    deny('CONTRACT_INVALID');
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
