#!/usr/bin/env node
/** Private semantic comparison; writes hashes only, never ROM or traces. */
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {loadFrozen} from '../src/v2_b1_frozen.mjs';
import {createBoard as createExtracted} from '../boards/gng/runtime.mjs';
import {createBoard as createCurrent} from '../src/gngb_runtime.mjs';
import {createGngCodeView} from '../boards/gng/code-view.mjs';
import {liveTapeReader,LIVE_TAPE_SCHEMA} from '../src/v3_b3_live_tape.mjs';

const [bundleArg,referenceArg,framesArg,reportArg,scenario='idle',tapeArg]=process.argv.slice(2);
if(!bundleArg||!referenceArg||!framesArg||!reportArg)
  throw Error('RP2_USAGE: bundle reference frames private-report');
const bundle=resolve(bundleArg),reference=JSON.parse(readFileSync(resolve(referenceArg))),
  frames=Number(framesArg),report=resolve(reportArg);
if(!report.startsWith(resolve('out')+'/')||!Number.isInteger(frames)||
   frames<1||frames>6000||!['idle','tape'].includes(scenario)||
   (scenario==='tape'&&!tapeArg))
  throw Error('RP2_ARGUMENT_INVALID');
const {manifest,code}=loadFrozen(bundle);
if(manifest.files['program.mjs']!==reference.inputs.bundle.files['program.mjs'].sha256||
   frames>manifest.frames)throw Error('RP2_REFERENCE_MISMATCH');
const {blocks}=await import(pathToFileURL(join(bundle,'program.mjs')).href);
const {createBoard:createOriginal}=await import(pathToFileURL(join(bundle,'gngb_runtime.mjs')).href);
const view=createGngCodeView(code);
const tape=scenario==='tape'?JSON.parse(readFileSync(resolve(tapeArg))):null;
if(tape&&(tape.schema!==LIVE_TAPE_SCHEMA||
   tape.program_sha256!==manifest.files['program.mjs']))throw Error('RP2_TAPE_MISMATCH');
const converted=new Map();
for(const [key,fn] of blocks){
  const pc=key&0xffff;
  const at=key>=0x100000?view.at(pc,null,Math.floor((key-0x100000)/0x10000)):
    key>=0x10000?view.at(pc,Math.floor(key/0x10000)-1):view.at(pc,null);
  if(!at)throw Error('RP2_BLOCK_KEY_INVALID');
  converted.set(view.identity(at),fn);
}
const digest=r=>createHash('sha256').update(r.record).update(r.known)
  .update(JSON.stringify([r.scroll,r.bank,r.latch,r.sprite_buffer_valid,r.writes]))
  .digest('hex');
const makePortRead=()=>tape?liveTapeReader(tape.changes):null;
function run(create,compiled,segment){
  const hashes=[],audio=[],reads=[];
  const board=create(code,compiled,{frames,portRead:makePortRead(),onFrame:r=>{
    hashes.push(digest(r));board.state.records[r.index-1]=null;
  },onAudioEvent:e=>audio.push([e.kind,e.value,e.cycle]),
  onPortRead:e=>reads.push([e.addr,e.cycle,e.pc,e.value])});
  if(segment)for(let n=1;n<=frames;n++){
    const result=board.run(n);
    if(result.status!=='FRAMES_DONE')throw Error('RP2_SEGMENT_'+result.status);
  }else{
    const result=board.run();
    if(result.status!=='FRAMES_DONE')throw Error('RP2_RUN_'+result.status);
  }
  return {hashes,audio,reads,events:board.state.events,cycle:board.state.C,
    registers:Object.fromEntries(['a','b','dp','x','y','u','s','cc','PC',
      'ka','kb','kdp','kx','ky','ku','ks','kcc','C','T','frame','bank']
      .map(k=>[k,board.state[k]]))};
}
const old=run(createOriginal,blocks,false);
const current=run(createCurrent,blocks,false);
const fresh=run(createExtracted,converted,false);
const stepped=run(createExtracted,converted,true);
const cut=Math.floor(frames/2);
const before=createExtracted(code,converted,{frames,portRead:makePortRead()});
if(before.run(cut).status!=='FRAMES_DONE')throw Error('RP2_CHECKPOINT_CUT');
const saved=before.exportState();
const resumedHashes=[];
const after=createExtracted(code,converted,{frames,portRead:makePortRead(),onFrame:r=>{
  resumedHashes.push(digest(r));after.state.records[r.index-1]=null;
}});
after.importState(saved);
if(after.run().status!=='FRAMES_DONE'||
   JSON.stringify(resumedHashes)!==JSON.stringify(fresh.hashes.slice(cut))||
   after.state.C!==fresh.cycle)throw Error('RP2_CHECKPOINT_MISMATCH');
for(const [left,right,label,except] of [[old,fresh,'original/extracted','audio'],
  [current,fresh,'current/extracted',null],
  [fresh,stepped,'continuous/segmented']]){
  for(const key of Object.keys(left))if(key!==except&&
    JSON.stringify(left[key])!==JSON.stringify(right[key])){
    const a=left[key],b=right[key];
    const first=Array.isArray(a)?a.findIndex((v,i)=>JSON.stringify(v)!==JSON.stringify(b[i])):null;
    throw Error(`RP2_SEMANTIC_MISMATCH ${label} ${key} ${first??''} lengths ${a?.length??'-'}/${b?.length??'-'}`);
  }
}
const sha=data=>createHash('sha256').update(JSON.stringify(data)).digest('hex');
const result={schema:'rom-migration.rp2.compare.v1',frames,
  scenario,
  bundleProgramSha256:manifest.files['program.mjs'],
  frameSequenceSha256:sha(old.hashes),eventsSha256:sha(old.events),
  audioEventsSha256:sha(current.audio),audioEventCount:current.audio.length,
  portReadsSha256:sha(old.reads),portReadCount:old.reads.length,cycle:old.cycle,
  registersSha256:sha(old.registers),checkpointCut:cut,equivalent:true};
writeFileSync(report,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify(result));
