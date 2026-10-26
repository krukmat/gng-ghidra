#!/usr/bin/env node
/** B2E: expand ONLY the missing authentic idle MC6809 AOT route.
 * Parent B2D contains completed Coin, Start & P1 profiles. Those are
 * verified again against the candidate, NEVER simulated or regenerated
 * during live execution. All ROM bytes remain private on the Mac.
 */
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,readFileSync,writeFileSync,mkdirSync,mkdtempSync,renameSync}
  from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {compileProgram} from '../src/mc6809_aot.mjs';
import {createBoard,GngbRuntimeError} from '../src/gngb_runtime.mjs';
import {loadFrozen,freezeBundle,runFrozen,rewriteProgram,sha256,MODULES}
  from '../src/v2_b1_frozen.mjs';
import {locateRamCode,romBytes} from './r35_t5_run.mjs';
import {b2dCertified} from '../src/v3_b2d_selection.mjs';
import {B2D_PROFILES,B2D_FRAMES,b2dCoverageFrames,b2dTape}
  from '../src/v3_b2d_tapes.mjs';

const ROOT=resolve(fileURLToPath(import.meta.url),'../..');
const PARENT=join(ROOT,'out/v3/b2d/frozen');
const PARENT_REPORT=join(ROOT,'out/v3/b2d/discovery-report.json');
const OUT=join(ROOT,'out/v3/b2e');
const FROZEN=join(OUT,'frozen');
const REPORT=join(OUT,'discovery-report.json');
const SCHEMA='gng.v3.b2e-idle-extension.v1';
const fail=why=>{throw Error('V3_B2E_'+why);};
const key=s=>[s.bank??'F',s.pc,s.overlay??'-'].join(':');
const seedOK=(s,code)=>s&&typeof s==='object'&&!Array.isArray(s)&&
  Number.isInteger(s.pc)&&s.pc>=0&&s.pc<=0xffff&&
  (s.bank===null||Number.isInteger(s.bank)&&s.bank>=0&&s.bank<5)&&
  (s.overlay===undefined||s.overlay===null||Number.isInteger(s.overlay)&&
    s.overlay>=0&&s.overlay<code.ramOverlays.length)&&
  (s.overlay==null?
    (s.bank===null&&s.pc>=0x6000||
     Number.isInteger(s.bank)&&s.pc>=0x4000&&s.pc<0x6000):
    s.bank===null&&s.pc<0x3000);
const digest=x=>createHash('sha256').update(x).digest('hex');
const hashFrame=r=>{
  const h=createHash('sha256');
  h.update(r.record);h.update(r.known);
  h.update(JSON.stringify([r.scroll,r.bank,r.latch,r.sprite_buffer_valid,r.writes]));
  return h.digest('hex');
};
function replay(code,blocks,profile,frames=b2dCoverageFrames(profile),
  makeBoard=createBoard){
  const tape=b2dTape(profile),hashes=[];
  const reads={coin:0,start:0,right:0,left:0,attack:0,jump:0};
  const board=makeBoard(code,blocks,{frames,
    portRead:(addr,cycle)=>tape.read(addr,cycle),
    onPortRead:r=>{
      if(r.addr===0x3000){
        if(!(r.value&0x40))reads.coin++;
        if(!(r.value&0x01))reads.start++;
      }else if(r.addr===0x3001){
        if(!(r.value&0x01))reads.right++;
        if(!(r.value&0x02))reads.left++;
        if(!(r.value&0x10))reads.attack++;
        if(!(r.value&0x20))reads.jump++;
      }
    },
    onFrame:r=>hashes.push(hashFrame(r))
  });
  let result;
  try{result=board.run()}catch(e){
    if(!(e instanceof GngbRuntimeError))throw e;
    result={status:'ERROR',code:e.code,pc:e.detail?.pc};
  }
  return {result,hashes,reads,board};
}
function overlaysFrom(code,start){
  return code.ramOverlays.slice(start).map(x=>
    ({start:x.start,hex:Buffer.from(x.bytes).toString('hex')}));
}
function restoreOverlays(code,extra){
  if(!Array.isArray(extra)||extra.length>128)fail('OVERLAYS_INVALID');
  for(const ov of extra){
    if(!Number.isSafeInteger(ov?.start)||ov.start<0||ov.start>=0x3000||
       typeof ov.hex!=='string'||ov.hex.length<2||ov.hex.length%2!==0||
       ov.hex.length>0x6000||!/^[a-f0-9]+$/.test(ov.hex)||
       ov.start+ov.hex.length/2>0x3000)
      fail('OVERLAYS_INVALID');
    code.ramOverlays.push({start:ov.start,
      bytes:Uint8Array.from(Buffer.from(ov.hex,'hex'))});
  }
}
function store(report,previousIterations=null){
  mkdirSync(OUT,{recursive:true,mode:0o700});
  if(previousIterations===null){
    if(existsSync(REPORT))fail('REPORT_EXISTS');
  }else{
    if(!existsSync(REPORT))fail('REPORT_MISSING');
    const history=join(OUT,'history');
    mkdirSync(history,{recursive:true,mode:0o700});
    const archived=join(history,'iteration-'+previousIterations+'.json');
    const previous=readFileSync(REPORT);
    if(existsSync(archived)){
      if(!readFileSync(archived).equals(previous))fail('HISTORY_CONFLICT');
    }else writeFileSync(archived,previous,{flag:'wx',mode:0o600});
  }
  const temp=join(OUT,'next-report-'+process.pid+'.tmp');
  writeFileSync(temp,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
  renameSync(temp,REPORT);
}
const compared=(a,b)=>a.result.status==='FRAMES_DONE'&&
  b.result.status==='FRAMES_DONE'&&
  JSON.stringify(a.hashes)===JSON.stringify(b.hashes)&&
  JSON.stringify(a.reads)===JSON.stringify(b.reads);

async function main(){
  const mode=process.argv.slice(2).join(' ');
  if(mode!=='--discover'&&mode!=='--resume')fail('INVALID_ARGS');
  const resuming=mode==='--resume';
  if(existsSync(FROZEN))fail('FROZEN_ALREADY_EXISTS');
  if(resuming!==existsSync(REPORT))fail('REPORT_MODE_MISMATCH');
  const {manifest:parent,code}=loadFrozen(PARENT);
  const parentProof=JSON.parse(readFileSync(PARENT_REPORT,'utf8'));
  if(!b2dCertified(parentProof,parent))fail('PARENT_B2D_NOT_CERTIFIED');
  const libUrl=pathToFileURL(join(ROOT,'src/mc6809_aot_lib.mjs')).href;
  for(const module of MODULES){
    if(sha256(readFileSync(join(ROOT,'src',module)))!==parent.files[module])
      fail('RUNTIME_MODULE_DRIFT');
  }
  if(typeof parent.source_git_head!=='string'||
    !/^[a-f0-9]{40}$/.test(parent.source_git_head))
    fail('PARENT_COMMIT_INVALID');
  try{
    execFileSync('git',['diff','--exit-code',parent.source_git_head,'HEAD',
      '--','src/mc6809_aot.mjs'],{cwd:ROOT,stdio:'ignore'});
  }catch{fail('PARENT_COMPILER_DRIFT')}
  if(!Array.isArray(parentProof.seeds)||parentProof.seeds.length===0)
    fail('PARENT_SEEDS_MISSING');
  let seeds=parentProof.seeds.map(s=>({...s}));
  const frozenProgram=compileProgram(code,seeds,{libUrl});
  if(frozenProgram.blockCount!==parent.blocks||
     sha256(rewriteProgram(frozenProgram.source))!==parent.files['program.mjs'])
    fail('PARENT_AOT_SOURCE_MISMATCH');
  console.log('V3_B2E_PARENT=PASS_EXACT_'+parent.blocks+'_BLOCK_AOT');
  const originalSeedCount=seeds.length;
  const originalOverlayCount=code.ramOverlays.length;
  let previousIterations=0;
  if(resuming){
    const state=JSON.parse(readFileSync(REPORT,'utf8'));
    if(state.schema!==SCHEMA||state.status!=='BLOCKED_ITERATION_LIMIT'||
       state.parent_program_sha256!==parent.files['program.mjs']||
       !Number.isSafeInteger(state.iterations)||state.iterations<1||
       !Number.isSafeInteger(state.blocks)||state.blocks<parent.blocks||
       !Array.isArray(state.seeds)||
       state.seeds.length-originalSeedCount!==state.iterations+1||
       !Array.isArray(state.extra_overlays))
      fail('RESUME_CHECKPOINT_INVALID');
    restoreOverlays(code,state.extra_overlays);
    if(JSON.stringify(state.seeds.slice(0,originalSeedCount))!==
      JSON.stringify(seeds))fail('RESUME_PARENT_PREFIX_DRIFT');
    const keys=new Set(seeds.map(key));
    for(const t of state.seeds.slice(originalSeedCount)){
      if(!seedOK(t,code)||keys.has(key(t)))fail('RESUME_TARGET_INVALID');
      keys.add(key(t));
    }
    const final=state.seeds.at(-1);
    if(state.last_result?.status==='UNCOMPILED'){
      if(final.pc!==state.last_result.pc||
         final.bank!==state.last_result.bank||
         (final.overlay??null)!==(state.last_result.overlay??null))
        fail('RESUME_LAST_SEED_MISMATCH');
    }else if(state.last_result?.status==='RAM_CODE_UNMAPPED'){
      if(final.pc!==state.last_result.pc||final.overlay==null)
        fail('RESUME_LAST_SEED_MISMATCH');
    }else fail('RESUME_LAST_STATUS_INVALID');
    const priorBuild=compileProgram(code,state.seeds.slice(0,-1),{libUrl});
    if(priorBuild.blockCount!==state.blocks||
       sha256(rewriteProgram(priorBuild.source))!==state.program_sha256)
      fail('RESUME_AOT_DRIFT');
    seeds=state.seeds.map(s=>({...s}));
    previousIterations=state.iterations;
    console.log('V3_B2E_RESUME=PASS_EXACT_CHECKPOINT');
    console.log('V3_B2E_RESUME_FROM_ITERATION='+previousIterations);
  }
  const seen=new Set(seeds.map(key));
  const addSeed=t=>{
    if(!seedOK(t,code)||seen.has(key(t)))fail('NEW_SEED_INVALID');
    seen.add(key(t));seeds.push(t);
  };
  if(!resuming){
    // Fixed ROM PC from operator's actual B2D idle halt at frame 1038.
    addSeed({bank:null,pc:0x6a9d,overlay:null});
  }
  mkdirSync(OUT,{recursive:true,mode:0o700});
  const temp=mkdtempSync(join(OUT,'work-'));
  let finished=false,built=null,last=null,iterations=previousIterations;
  const MAX_ADDITIONAL=96;
  for(let attempt=1;attempt<=MAX_ADDITIONAL;attempt++){
    iterations=previousIterations+attempt;
    built=compileProgram(code,seeds,{libUrl});
    const path=join(temp,'program-'+iterations+'.mjs');
    writeFileSync(path,built.source,{flag:'wx',mode:0o600});
    const {blocks}=await import(pathToFileURL(path).href);
    const observed=replay(code,blocks,'idle',B2D_FRAMES);
    console.log('V3_B2E_ITERATION='+iterations);
    console.log('V3_B2E_BLOCKS='+built.blockCount);
    console.log('V3_B2E_IDLE='+observed.hashes.length+'_'+observed.result.status);
    if(observed.result.status==='FRAMES_DONE'){
      finished=true;last=null;break;
    }
    last=observed;
    if(last.result.status==='UNCOMPILED'){
      addSeed({bank:last.result.bank,pc:last.result.pc,
        overlay:last.result.overlay??null});
    }else if(last.result.status==='RAM_CODE_UNMAPPED'){
      const origin=locateRamCode(code,last.board.state,last.result.pc);
      if(!origin)fail('RAM_ORIGIN_UNRESOLVED');
      const ov=code.ramOverlays.length;
      code.ramOverlays.push({start:origin.start,
        bytes:romBytes(code,origin.origin,origin.length)});
      addSeed({bank:null,pc:origin.start,overlay:ov});
    }else fail('RUNTIME_'+String(last.result.code??last.result.status));
  }
  const base={schema:SCHEMA,
    status:finished?'CANDIDATE_COMPLETE':'BLOCKED_ITERATION_LIMIT',
    iterations,blocks:built.blockCount,parent_blocks:parent.blocks,
    parent_program_sha256:parent.files['program.mjs'],
    seeds,extra_overlays:overlaysFrom(code,originalOverlayCount),
    program_sha256:sha256(rewriteProgram(built.source)),
    last_result:last?.result??null,last_frame:last?.hashes.length??null};
  if(!finished){
    store(base,resuming?previousIterations:null);
    console.log('V3_B2E_DISCOVERY=BLOCKED_ITERATION_LIMIT');
    process.exitCode=2;return;
  }

  // All validation happens on a throwaway private candidate; never publish
  // a bundle merely because the discovery loop reached frame 1500.
  const modules=Object.fromEntries(MODULES.map(n=>
    [n,readFileSync(join(ROOT,'src',n),'utf8')]));
  const candidate=join(temp,'candidate-frozen');
  freezeBundle(candidate,{generated:built.source,code,
    overlays:code.ramOverlays,modules,
    provenance:{frames:B2D_FRAMES,blocks:built.blockCount,
      source_report_sha256:parent.files['program.mjs'],
      source_git_head:execFileSync('git',['rev-parse','HEAD'],
        {cwd:ROOT,encoding:'utf8'}).trim()}});
  const loaded=loadFrozen(candidate);
  const {blocks:expandedBlocks}=await import(
    pathToFileURL(join(candidate,'program.mjs')).href);
  const {createBoard:expandedRuntime}=await import(
    pathToFileURL(join(candidate,'gngb_runtime.mjs')).href);
  const {blocks:parentBlocks}=await import(
    pathToFileURL(join(PARENT,'program.mjs')).href);
  const {createBoard:parentRuntime}=await import(
    pathToFileURL(join(PARENT,'gngb_runtime.mjs')).href);
  if(!(expandedBlocks instanceof Map)||expandedBlocks.size!==built.blockCount||
     !(parentBlocks instanceof Map)||parentBlocks.size!==parent.blocks)
    fail('PACKAGE_BLOCK_COUNT_MISMATCH');
  const candidateNoInput=await runFrozen(candidate,{frames:1000});
  const parentNoInput=await runFrozen(PARENT,{frames:1000});
  if(candidateNoInput.sequence_sha256!==parentNoInput.sequence_sha256||
     JSON.stringify(candidateNoInput.frame_hashes)!==
       JSON.stringify(parentNoInput.frame_hashes)||
     JSON.stringify(candidateNoInput.events)!==
       JSON.stringify(parentNoInput.events))
    fail('PARENT_IDLE_1000_PARITY_BROKEN');
  console.log('V3_B2E_NO_INPUT=PASS_1000_FRAMES_MATCH_B2D');

  // Reexecute EVERY B2D profile from cold reset (no cached CPU states).
  // Older observed state and port reads must remain byte-for-byte equal.
  for(const profile of B2D_PROFILES){
    const frames=b2dCoverageFrames(profile);
    const prior=replay(code,parentBlocks,profile,frames,parentRuntime);
    const one=replay(loaded.code,expandedBlocks,profile,frames,expandedRuntime);
    const two=replay(loaded.code,expandedBlocks,profile,frames,expandedRuntime);
    if(!compared(prior,one)||!compared(one,two)||one.hashes.length!==frames)
      fail('PARENT_PROFILE_DRIFT_'+profile);
    console.log('V3_B2E_PROFILE_'+profile.toUpperCase()+
      '=PASS_PARENT_PARITY_'+frames);
  }
  // New idle range 1001-1500: cold reset twice, actual AOT CPU and bus.
  const idleOne=replay(loaded.code,expandedBlocks,'idle',B2D_FRAMES,
    expandedRuntime);
  const idleTwo=replay(loaded.code,expandedBlocks,'idle',B2D_FRAMES,
    expandedRuntime);
  if(!compared(idleOne,idleTwo)||idleOne.hashes.length!==B2D_FRAMES)
    fail('IDLE_1500_NOT_DETERMINISTIC');
  renameSync(candidate,FROZEN);
  const summary={...base,status:'DISCOVERY_COMPLETE',
    frozen_program_sha256:loaded.manifest.files['program.mjs'],
    idle_frames:B2D_FRAMES,parent_profiles_unchanged:true,
    no_input:'PASS_1000_FRAMES_MATCH_B2D',
    frozen_determinism:'PASS_IDLE_1500_AND_PARENT_PROFILES_DOUBLE_REPLAY'};
  store(summary,resuming?previousIterations:null);
  console.log('V3_B2E_IDLE=PASS_REAL_1500_FRAMES');
  console.log('V3_B2E_PRESERVED=PASS_B2D_COIN_START_CONTROLS');
  console.log('V3_B2E_DISCOVERY=PASS_REAL_AOT_IDLE_1500');
  console.log('V3_B2E_BLOCKS='+built.blockCount);
}
try{await main()}catch(e){
  console.error('V3_B2E_DISCOVERY=BLOCKED_'+
    String(e.message).replace(/^V3_B2E_/,''));
  process.exitCode=2;
}
