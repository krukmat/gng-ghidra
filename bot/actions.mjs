/** Port-only suffixes. Every candidate is replayed from reset. */
import {defineInputSchedule} from '../src/gngb_input_contract.mjs';
import {CYCLES_PER_FRAME} from '../src/gngb_runtime.mjs';

const controls=['p1.right','p1.left','p1.up','p1.down','p1.button1','p1.button2'];

export function suffixEvents(seedEvents,startFrame,segments,endFrame){
  if(!Number.isSafeInteger(startFrame)||startFrame<1||
     !Number.isSafeInteger(endFrame)||endFrame<=startFrame)
    throw Error('BOT_SUFFIX_HORIZON');
  const events=seedEvents.filter(e=>e.cycle<startFrame*CYCLES_PER_FRAME);
  const held=new Set();
  for(const e of events){if(e.pressed)held.add(e.control);else held.delete(e.control);}
  if([...held].some(c=>!controls.includes(c)))throw Error('BOT_SUFFIX_SYSTEM_HELD');
  let frame=startFrame;
  const set=(f,want)=>{
    for(const control of controls){
      const pressed=want.has(control);
      if(pressed===held.has(control))continue;
      events.push({cycle:f*CYCLES_PER_FRAME,control,pressed});
      if(pressed)held.add(control);else held.delete(control);
    }
  };
  for(const segment of segments){
    const {duration,action='neutral',firePeriod=12,firePhase=0,jumpPeriod=44,jumpPhase=1}=segment;
    if(!Number.isSafeInteger(duration)||duration<1||
       !/^(neutral|stand|right|left|up|down)(_fire)?(_jump)?$/.test(action)||
       !Number.isSafeInteger(firePeriod)||firePeriod<4||
       !Number.isSafeInteger(firePhase)||firePhase<0||
       !Number.isSafeInteger(jumpPeriod)||jumpPeriod<6||
       !Number.isSafeInteger(jumpPhase)||jumpPhase<0)
      throw Error('BOT_SUFFIX_SEGMENT');
    for(let offset=0;offset<duration&&frame<endFrame-1;offset++,frame++){
      const want=new Set(),direction=action.split('_')[0];
      if(['right','left','up','down'].includes(direction))want.add('p1.'+direction);
      if(action.includes('fire')&&offset>=firePhase&&
         (offset-firePhase)%firePeriod<3)want.add('p1.button1');
      if(action.includes('jump')&&offset>=jumpPhase&&
         (offset-jumpPhase)%jumpPeriod<5)want.add('p1.button2');
      set(frame,want);
    }
  }
  set(Math.min(frame,endFrame-1),new Set());
  events.sort((a,b)=>a.cycle-b.cycle||a.control.localeCompare(b.control));
  return defineInputSchedule(events).events;
}
