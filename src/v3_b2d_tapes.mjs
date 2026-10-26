/** B2D: deterministic input-sampling fixtures for the *real* AOT CPU.
 * No ROM, state injection, sprites or rendering are synthesized here.
 * Frame/cycle pairs replay actual hardware input port transitions only.
 */
import {createHash} from 'node:crypto';
import {defineInputSchedule,readScheduledPort} from './gngb_input_contract.mjs';
import {CYCLES_PER_FRAME} from './gngb_runtime.mjs';
export const B2D_FRAMES=1500;
export const B2D_TAPE_SCHEMA='gng.v3.b2d.coverage.v1';
const e=(frame,control,pressed)=>Object.freeze({
  cycle:frame*CYCLES_PER_FRAME,control,pressed
});
const lateCoin=Object.freeze([e(812,'coin1',true),e(822,'coin1',false)]);
const lateStart=Object.freeze([...lateCoin,e(850,'start1',true),e(862,'start1',false)]);
const lateControls=Object.freeze([...lateStart,
  e(900,'p1.right',true),e(920,'p1.right',false),
  e(940,'p1.button1',true),e(948,'p1.button1',false),
  e(970,'p1.left',true),e(990,'p1.left',false),
  e(1010,'p1.button2',true),e(1018,'p1.button2',false)
]);
const early=Object.freeze([
  e(420,'coin1',true),e(422,'coin1',false),
  e(530,'start1',true),e(532,'start1',false),
  e(650,'p1.right',true),e(664,'p1.right',false),
  e(680,'p1.button1',true),e(682,'p1.button1',false),
  e(720,'p1.left',true),e(734,'p1.left',false),
  e(750,'p1.button2',true),e(752,'p1.button2',false)
]);
const tapes=Object.freeze({
  lateControls,lateStart,lateCoin,idle:Object.freeze([]),earlyControls:early
});
export const B2D_PROFILES=Object.freeze(Object.keys(tapes));
export function b2dTape(profile){
  if(!Object.hasOwn(tapes,profile))throw Error('V3_B2D_PROFILE_INVALID');
  const schedule=defineInputSchedule(tapes[profile]);
  const metadata={schema:B2D_TAPE_SCHEMA,profile,frames:B2D_FRAMES,
    events:schedule.events};
  const sha256=createHash('sha256').update(JSON.stringify(metadata)).digest('hex');
  return Object.freeze({...metadata,sha256,
    read:(addr,cycle)=>readScheduledPort(schedule,addr,cycle)});
}
