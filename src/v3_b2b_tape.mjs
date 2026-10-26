/** V3.B2B replay contract: ROM-free and deterministic, never oracular.
 * Event cycles are absolute MC6809 cycles from reset. All controls active low.
 */
import {createHash} from 'node:crypto';
import {defineInputSchedule,readScheduledPort} from './gngb_input_contract.mjs';
export const V3_TAPE_SCHEMA='gng.v3.input-tape.v1';
export const CYCLES_PER_FRAME=25152;
export const PROFILE_FRAMES=1000;
const event=(frame,control,pressed)=>Object.freeze({
  cycle:frame*CYCLES_PER_FRAME,control,pressed
});
const EVENTS=Object.freeze({
  coin:Object.freeze([event(420,'coin1',true),event(422,'coin1',false)]),
  start:Object.freeze([
    event(420,'coin1',true),event(422,'coin1',false),
    event(530,'start1',true),event(532,'start1',false)]),
  controls:Object.freeze([
    event(420,'coin1',true),event(422,'coin1',false),
    event(530,'start1',true),event(532,'start1',false),
    event(650,'p1.right',true),event(664,'p1.right',false),
    event(680,'p1.button1',true),event(682,'p1.button1',false),
    event(720,'p1.left',true),event(734,'p1.left',false),
    event(750,'p1.button2',true),event(752,'p1.button2',false)
  ])
});
export const V3_PROFILES=Object.freeze(Object.keys(EVENTS));
export function createV3Tape(profile='controls'){
  if(!Object.hasOwn(EVENTS,profile))throw Error('V3_B2B_UNKNOWN_PROFILE');
  const schedule=defineInputSchedule(EVENTS[profile]);
  const data=Object.freeze({
    schema:V3_TAPE_SCHEMA,profile,frames:PROFILE_FRAMES,
    events:schedule.events
  });
  const hash=createHash('sha256').update(JSON.stringify(data)).digest('hex');
  return Object.freeze({
    ...data,sha256:hash,
    read:(address,cycle)=>readScheduledPort(schedule,address,cycle)
  });
}
