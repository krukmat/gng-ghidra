/** Private explorer tape adapter for existing B3 laboratory runners. */
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {defineInputSchedule,readScheduledPort} from './gngb_input_contract.mjs';
import {CYCLES_PER_FRAME} from './gngb_runtime.mjs';
import {B3_HORIZONS,B3_TAPE_SCHEMA,b3Tape} from './v3_b3_tapes.mjs';

export function resolveB3LabTape(name){
  if(Object.hasOwn(B3_HORIZONS,name))return b3Tape(name);
  const raw=JSON.parse(readFileSync(name,'utf8'));
  if(raw?.schema!==B3_TAPE_SCHEMA||raw.profile!=='explorer-g4'||
     !Number.isSafeInteger(raw.frames)||raw.frames<1||raw.frames>216000||
     !Array.isArray(raw.events))
    throw Error('V3_B3_EXTERNAL_TAPE_INVALID');
  const schedule=defineInputSchedule(raw.events);
  if(schedule.events.at(-1)?.cycle>=raw.frames*CYCLES_PER_FRAME)
    throw Error('V3_B3_EXTERNAL_TAPE_HORIZON_INVALID');
  const metadata={schema:raw.schema,profile:raw.profile,frames:raw.frames,
    events:schedule.events};
  const sha256=createHash('sha256').update(JSON.stringify(metadata)).digest('hex');
  if(raw.sha256!==sha256||
     JSON.stringify(raw.events)!==JSON.stringify(schedule.events))
    throw Error('V3_B3_EXTERNAL_TAPE_HASH_MISMATCH');
  return Object.freeze({...metadata,sha256,
    read:(addr,cycle)=>readScheduledPort(schedule,addr,cycle)});
}
