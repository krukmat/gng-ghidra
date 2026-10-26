#!/usr/bin/env node
/** B2-A: private, ROM-free-at-runtime Coin1 witness on real precompiled GnG.
 * Never imports the AOT compiler, reads MAME or decodes instructions.
 * First verifies the independently built V3 baseline against all 600 V2 frames.
 */
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {loadFrozen,runFrozen} from '../src/v2_b1_frozen.mjs';
import {verifySlot} from '../src/v2_b1_gate_lib.mjs';
import {defineInputSchedule,readScheduledPort} from '../src/gngb_input_contract.mjs';

const ROOT=resolve(fileURLToPath(import.meta.url),'../..');
const dest=join(ROOT,'out/v3/b2a');
const v3=join(dest,'frozen');
const fail=code=>{throw Error('V3_B2A_'+code);};
const frameDigest=rec=>{
  const h=createHash('sha256');
  h.update(rec.record);h.update(rec.known);
  h.update(JSON.stringify([rec.scroll,rec.bank,rec.latch,rec.sprite_buffer_valid,rec.writes]));
  return h.digest('hex');
};
async function main(){
  if(process.argv.slice(2).join(' ')!=='--coin')fail('ARGS_INVALID');
  const destination=join(dest,'coin-smoke.json');
  if(existsSync(destination))fail('REPORT_ALREADY_EXISTS');
  const v2=verifySlot(join(ROOT,'out/v2/b1'),'one').report;
  const {manifest,code}=loadFrozen(v3);
  if(manifest.frames!==600||manifest.blocks!==v2.blocks)fail('V3_MANIFEST_MISMATCH');
  const baseline=await runFrozen(v3);
  if(baseline.status!=='FRAMES_DONE'||baseline.frames!==600||
     baseline.sequence_sha256!==v2.sequence_sha256||
     JSON.stringify(baseline.frame_hashes)!==JSON.stringify(v2.frame_hashes)||
     JSON.stringify(baseline.events)!==JSON.stringify(v2.events))
    fail('V2_NO_INPUT_DRIFT');
  console.log('V3_B2A_NO_INPUT=PASS_600_FRAMES_EQUAL_V2');

  // Fixed lab-only 2-frame coin pulse after cold boot; not a gameplay tape.
  const {CYCLES_PER_FRAME,createBoard}=await import(pathToFileURL(
    join(v3,'gngb_runtime.mjs')).href);
  const {blocks}=await import(pathToFileURL(join(v3,'program.mjs')).href);
  const press=420*CYCLES_PER_FRAME,release=422*CYCLES_PER_FRAME;
  const schedule=defineInputSchedule([
    {cycle:press,control:'coin1',pressed:true},
    {cycle:release,control:'coin1',pressed:false},
  ]);
  let reads=0,systemReads=0,activeReads=0,firstActive=null;
  let firstChanged=null;
  const frameHashes=[];
  const board=createBoard(code,blocks,{frames:600,
    portRead:(addr,cycle)=>readScheduledPort(schedule,addr,cycle),
    onPortRead:r=>{
      reads++;
      if(r.addr===0x3000){
        systemReads++;
        if((r.value&0x40)===0){
          activeReads++;
          if(firstActive===null)
            firstActive={cycle:r.cycle,pc:r.pc,port:r.addr};
        }
      }
    },
    onFrame:record=>{
      const hash=frameDigest(record);
      frameHashes.push(hash);
      if(hash!==v2.frame_hashes[record.index-1]&&firstChanged===null)
        firstChanged=record.index;
    },
  });
  let result;
  try{result=board.run()}
  catch(e){
    result={status:'ERROR',code:String(e.code??e.message)};
  }
  const newRoute=result.status==='UNCOMPILED'&&firstActive!==null&&
    board.state.C>=firstActive.cycle;
  const changed=firstChanged!==null;
  const status=firstActive===null?'NO_ACTIVE_COIN_READ':
    newRoute?'INPUT_ROUTE_UNCOMPILED':
    changed?'INPUT_STATE_CHANGED':'NO_OBSERVABLE_REACTION';
  const report={
    schema:'gng.v3.b2a.coin-smoke.v1',
    source_git_head:manifest.source_git_head,
    status,
    no_input_baseline:'PASS_600_FRAMES_EQUAL_V2',
    frames_executed:board.state.records.length,
    cpu_result:result.status,
    cpu_error:result.status==='ERROR'?result.code:null,
    port_reads:reads,system_reads:systemReads,active_coin_reads:activeReads,
    first_active_read:firstActive,
    first_changed_frame:firstChanged,
    missing_block:result.status==='UNCOMPILED'
      ?{bank:result.bank,pc:result.pc,overlay:result.overlay}:null,
    coin_window:{press,release},
  };
  writeFileSync(destination,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log('V3_B2A_COIN_STATUS='+status);
  console.log('V3_B2A_COIN_SYSTEM_READS='+systemReads);
  console.log('V3_B2A_COIN_ACTIVE_READS='+activeReads);
  console.log('V3_B2A_COIN_FIRST_CHANGED_FRAME='+String(firstChanged??'NONE'));
  console.log('V3_B2A_COIN_FRAMES='+board.state.records.length);
  if(status==='INPUT_ROUTE_UNCOMPILED'||status==='INPUT_STATE_CHANGED'){
    console.log('V3_B2A_INPUT_CPU_PATH=PASS_REAL_COMPILED_GNG_REACTION');
  }else{
    console.error('V3_B2A_INPUT_CPU_PATH=BLOCKED_'+status);
    process.exitCode=2;
  }
}
try{await main()}catch(e){
  console.error('V3_B2A_INPUT_CPU_PATH=BLOCKED_'+
    (String(e.message).startsWith('V3_B2A_')?
      String(e.message).slice(7):'PRIVATE_INPUT_OR_IO'));
  process.exitCode=2;
}
