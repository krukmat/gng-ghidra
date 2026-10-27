#!/usr/bin/env node
/** V3.B3 G1.4: replay a recorded LIVE session (out/v3/b3/live-tapes/*.json,
 * or GET /tape) offline on the same frozen bundle, feeding the CPU the
 * exact port values it read at the exact cycles. PASS = the offline run
 * reaches the same frame record hash, or the same halt (status, frame, PC).
 * Usage: node scripts/v3_b3_live_replay.mjs <tape.json>
 */
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {loadFrozen} from '../src/v2_b1_frozen.mjs';
import {LIVE_TAPE_SCHEMA,liveTapeReader} from '../src/v3_b3_live_tape.mjs';

const fail=s=>{throw Error('V3_B3_LIVE_REPLAY_'+s);};
const [path]=process.argv.slice(2);
if(!path)fail('USAGE');
const tape=JSON.parse(readFileSync(path,'utf8'));
if(tape.schema!==LIVE_TAPE_SCHEMA||!Array.isArray(tape.changes))fail('SCHEMA');
const {manifest,code}=loadFrozen(tape.bundle);
if(manifest.files['program.mjs']!==tape.program_sha256)fail('BUNDLE_CHANGED');
const {blocks}=await import(pathToFileURL(join(tape.bundle,'program.mjs')).href);
const {createBoard}=await import(pathToFileURL(join(tape.bundle,'gngb_runtime.mjs')).href);
const halted=tape.halt?.type==='halt';
const frames=halted?tape.halt.frame+1:tape.check?.frame;
if(!Number.isInteger(frames)||frames<1)fail('NO_CHECKPOINT');
let hash=null;
const board=createBoard(code,blocks,{frames,
  portRead:liveTapeReader(tape.changes),
  onFrame:r=>{
    const i=board.state.records.length;
    board.state.records[i-1]=null;
    if(i===tape.check?.frame)hash=createHash('sha256').update(r.record)
      .update(r.known).digest('hex');
  }});
let result;
try{result=board.run();}catch(e){result={status:'ERROR',code:e.code??e.message};}
const reached=board.state.records.length;
console.log('V3_B3_LIVE_REPLAY_BUNDLE_GENERATION='+tape.generation);
console.log('V3_B3_LIVE_REPLAY_CHANGES='+tape.changes.length);
console.log('V3_B3_LIVE_REPLAY_RESULT='+JSON.stringify({...result,frame:reached}));
let ok;
if(halted){
  ok=result.status===tape.halt.status&&reached===tape.halt.frame&&
    (result.status!=='UNCOMPILED'||(result.pc===tape.halt.missing?.pc&&
      result.bank===tape.halt.missing?.bank&&result.overlay===tape.halt.missing?.overlay));
  console.log('V3_B3_LIVE_REPLAY_LIVE_HALT='+JSON.stringify({status:tape.halt.status,
    frame:tape.halt.frame,missing:tape.halt.missing}));
}else{
  ok=result.status==='FRAMES_DONE'&&hash===tape.check.record_sha256;
  console.log('V3_B3_LIVE_REPLAY_CHECK_FRAME='+tape.check.frame+
    ' match='+(hash===tape.check.record_sha256));
}
console.log('V3_B3_LIVE_REPLAY='+(ok?(halted?'PASS_SAME_HALT':'PASS_SAME_FRAME_HASH'):'MISMATCH'));
process.exitCode=ok?0:2;
