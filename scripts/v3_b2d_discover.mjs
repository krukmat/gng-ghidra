#!/usr/bin/env node
/**
 * B2D real AOT coverage: compile offline from the authenticated B2B code
 * image. Replays hardware port schedules against the ORIGINAL GnG MC6809
 * machine. No interpreter, no synthetic sprites, no code generated at run.
 * Does not modify B2B's certified frozen bundle.
 */
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,existsSync,mkdtempSync,renameSync}
  from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {loadFrozen,freezeBundle,runFrozen,rewriteProgram,sha256,MODULES}
  from '../src/v2_b1_frozen.mjs';
import {compileProgram} from '../src/mc6809_aot.mjs';
import {createBoard,GngbRuntimeError} from '../src/gngb_runtime.mjs';
import {locateRamCode,romBytes} from './r35_t5_run.mjs';
import {B2D_FRAMES,B2D_PROFILES,b2dTape} from '../src/v3_b2d_tapes.mjs';

const ROOT=resolve(fileURLToPath(import.meta.url),'../..');
const B2B=join(ROOT,'out/v3/b2b/frozen');
const B2B_REPORT=join(ROOT,'out/v3/b2b/discovery-report.json');
const OUT=join(ROOT,'out/v3/b2d');
const FROZEN=join(OUT,'frozen');
const REPORT=join(OUT,'discovery-report.json');
const fail=s=>{throw Error('V3_B2D_'+s);};
const sha=x=>createHash('sha256').update(x).digest('hex');
const key=s=>[s.bank??'F',s.pc,s.overlay??'-'].join(':');
const okSeed=(s,code)=>s&&typeof s==='object'&&!Array.isArray(s)&&
  Number.isInteger(s.pc)&&s.pc>=0&&s.pc<=0xffff&&
  (s.bank===null||Number.isInteger(s.bank)&&s.bank>=0&&s.bank<5)&&
  (s.overlay===null||s.overlay===undefined||
    Number.isInteger(s.overlay)&&s.overlay>=0&&
    s.overlay<code.ramOverlays.length)&&
  (s.overlay==null?
    (s.pc>=0x6000&&s.bank===null||
     s.pc>=0x4000&&s.pc<0x6000&&Number.isInteger(s.bank))
    :s.pc<0x3000&&s.bank===null);
const hashFrame=r=>{
  const h=createHash('sha256');
  h.update(r.record);h.update(r.known);
  h.update(JSON.stringify([r.scroll,r.bank,r.latch,r.sprite_buffer_valid,r.writes]));
  return h.digest('hex');
};
const diff=(a,b,from)=>{
  const n=Math.min(a.length,b.length);
  for(let i=Math.max(0,from-1);i<n;i++)if(a[i]!==b[i])return i+1;
  return null;
};
function replay(code,blocks,profile){
  const tape=b2dTape(profile),hashes=[],reads={coin:0,start:0,
    right:0,left:0,attack:0,jump:0};
  const board=createBoard(code,blocks,{frames:B2D_FRAMES,
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
    },onFrame:r=>hashes.push(hashFrame(r))
  });
  let result;
  try{result=board.run()}catch(e){
    if(!(e instanceof GngbRuntimeError))throw e;
    result={status:'ERROR',code:e.code,pc:e.detail?.pc};
  }
  return {profile,tape_sha256:tape.sha256,hashes,reads,result,board};
}
const digestTapes=()=>Object.fromEntries(B2D_PROFILES.map(p=>[p,b2dTape(p).sha256]));
function validateCodeSeeding(code,parent,report,libUrl){
  if(report?.status!=='DISCOVERY_COMPLETE'||report.blocks!==663||
     report.no_input!=='PASS_600_FRAMES_IDENTICAL_V2'||
     report.frozen_determinism!=='PASS_TWO_FROZEN_1000_FRAME_RUNS'||
     report.comparison_read_counts?.controls?.coin<1||
     report.comparison_read_counts?.controls?.start<1||
     !Number.isInteger(report.first_start_effect_frame)||
     !Array.isArray(report.seeds)||!report.seeds.length)
    fail('B2B_PROOF_INVALID');
  const seeds=report.seeds.map(s=>({...s}));
  // Historic seeds may contain inert fixed-bank aliases, so their
  // authenticity is proved by rebuilding exact B2B source, not by
  // applying the stricter new-target validator retroactively.
  const generated=compileProgram(code,seeds,{libUrl});
  if(generated.blockCount!==parent.blocks||
     sha256(rewriteProgram(generated.source))!==parent.files['program.mjs'])
    fail('PARENT_AOT_REBUILD_MISMATCH');
  return seeds;
}
function overlaysFrom(code,at){return code.ramOverlays.slice(at)
  .map(ov=>({start:ov.start,hex:Buffer.from(ov.bytes).toString('hex')}));}
function restoreOverlays(code,extra){
  if(!Array.isArray(extra)||extra.length>128)fail('OVERLAY_RESTORE_INVALID');
  for(const ov of extra){
    if(!Number.isInteger(ov?.start)||ov.start<0||ov.start>=0x3000||
       typeof ov.hex!=='string'||ov.hex.length<2||
       ov.hex.length%2||ov.hex.length>0x6000||
       !/^[0-9a-f]+$/.test(ov.hex)||
       ov.start+ov.hex.length/2>0x3000)fail('OVERLAY_RESTORE_INVALID');
    code.ramOverlays.push({start:ov.start,
      bytes:Uint8Array.from(Buffer.from(ov.hex,'hex'))});
  }
}
function persist(report,previousIteration=null){
  mkdirSync(OUT,{recursive:true,mode:0o700});
  if(previousIteration!==null){
    const dir=join(OUT,'history');
    mkdirSync(dir,{recursive:true,mode:0o700});
    const archive=join(dir,'iteration-'+previousIteration+'.json');
    const original=readFileSync(REPORT);
    if(existsSync(archive)){
      if(!readFileSync(archive).equals(original))
        fail('HISTORY_CONFLICT');
    }else writeFileSync(archive,original,{flag:'wx',mode:0o600});
  }else if(existsSync(REPORT))fail('REPORT_ALREADY_EXISTS');
  const tmp=join(OUT,'report-'+process.pid+'.tmp');
  writeFileSync(tmp,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
  renameSync(tmp,REPORT);
}
async function main(){
  const mode=process.argv.slice(2).join(' ');
  if(mode!=='--discover'&&mode!=='--resume')fail('USAGE');
  const resuming=mode==='--resume';
  if(existsSync(FROZEN))fail('FROZEN_ALREADY_EXISTS');
  if(resuming!==existsSync(REPORT))fail('REPORT_MODE_MISMATCH');
  const parentData=loadFrozen(B2B),parent=parentData.manifest;
  const code=parentData.code;
  const evidence=JSON.parse(readFileSync(B2B_REPORT,'utf8'));
  if(parent.blocks!==663||parent.frames!==1000)fail('B2B_PARENT_INVALID');
  const libUrl=pathToFileURL(join(ROOT,'src/mc6809_aot_lib.mjs')).href;
  for(const module of MODULES)
    if(sha256(readFileSync(join(ROOT,'src',module)))!==parent.files[module])
      fail('PARENT_RUNTIME_DRIFT');
  try{execFileSync('git',['diff','--exit-code',parent.source_git_head,'HEAD',
    '--','src/mc6809_aot.mjs'],{cwd:ROOT,stdio:'ignore'})}
  catch{fail('PARENT_COMPILER_DRIFT')}
  let seeds=validateCodeSeeding(code,parent,evidence,libUrl);
  const prefixLength=seeds.length,originalOverlays=code.ramOverlays.length;
  const digests=digestTapes();
  let previousIterations=0;
  if(resuming){
    const state=JSON.parse(readFileSync(REPORT,'utf8'));
    if(state.schema!=='gng.v3.b2d-discovery.v1'||
       state.status!=='BLOCKED_ITERATION_LIMIT'||
       state.parent_program_sha256!==parent.files['program.mjs']||
       JSON.stringify(state.tape_sha256)!==JSON.stringify(digests)||
       !Number.isSafeInteger(state.iterations)||state.iterations<1||
       !Number.isSafeInteger(state.blocks)||state.blocks<parent.blocks||
       !Array.isArray(state.seeds)||state.seeds.length<=prefixLength||
       !Array.isArray(state.extra_overlays))
      fail('RESUME_REPORT_INVALID');
    restoreOverlays(code,state.extra_overlays);
    if(JSON.stringify(state.seeds.slice(0,prefixLength))!==
       JSON.stringify(seeds))fail('RESUME_PREFIX_DRIFT');
    const known=new Set(seeds.map(key));
    for(const seed of state.seeds.slice(prefixLength)){
      if(!okSeed(seed,code)||known.has(key(seed)))
        fail('RESUME_SEEDS_INVALID');
      known.add(key(seed));
    }
    // Two operator-observed targets (0x6364 and 0x6a8d) are always
    // queued before the first build; each failed iteration adds one more.
    if(state.seeds.length-prefixLength!==state.iterations+2)
      fail('RESUME_ITERATION_COUNT_INVALID');
    const last=state.last_result;
    const expected=state.seeds.at(-1);
    if(last?.status==='UNCOMPILED'&&
       (expected.pc!==last.pc||expected.bank!==last.bank||
        (expected.overlay??null)!==(last.overlay??null)))
      fail('RESUME_LAST_BLOCK_INVALID');
    else if(last?.status==='RAM_CODE_UNMAPPED'&&
       (expected.pc!==last.pc||expected.overlay==null))
      fail('RESUME_LAST_BLOCK_INVALID');
    else if(last?.status!=='UNCOMPILED'&&
      last?.status!=='RAM_CODE_UNMAPPED')fail('RESUME_LAST_RESULT_INVALID');
    // The last target was queued but never compiled on the prior run.
    const check=compileProgram(code,state.seeds.slice(0,-1),{libUrl});
    if(check.blockCount!==state.blocks||
       sha256(rewriteProgram(check.source))!==state.program_sha256)
      fail('RESUME_PROGRAM_DRIFT');
    seeds=state.seeds.map(s=>({...s}));
    previousIterations=state.iterations;
    console.log('V3_B2D_RESUME=PASS_EXACT_AOT_CHECKPOINT');
    console.log('V3_B2D_RESUME_FROM_ITERATION='+previousIterations);
  }
  console.log('V3_B2D_PARENT=PASS_663_BLOCKS_ATTESTED');
  console.log('V3_B2D_PROFILES='+B2D_PROFILES.join(','));
  mkdirSync(OUT,{recursive:true,mode:0o700});
  const work=mkdtempSync(join(OUT,'work-'));
  const known=new Set(seeds.map(key));
  const addTarget=t=>{
    if(!okSeed(t,code))fail('NEW_TARGET_INVALID');
    if(known.has(key(t)))fail('NEW_TARGET_ALREADY_COMPILED');
    known.add(key(t));seeds.push(t);
  };
  // Grounded by user's actual idle halt (frame 1038) and Coin halt
  // (frame 825). These are fixed ROM addresses; no fake game state.
  if(!resuming){
    addTarget({bank:null,pc:0x6364,overlay:null});
    addTarget({bank:null,pc:0x6a8d,overlay:null});
  }
  let completed=false,last=null,built,iterations=previousIterations;
  const MAX_ADDITIONAL=96;
  for(let attempt=1;attempt<=MAX_ADDITIONAL;attempt++){
    iterations=previousIterations+attempt;
    built=compileProgram(code,seeds,{libUrl});
    const path=join(work,'program-'+iterations+'.mjs');
    writeFileSync(path,built.source,{flag:'wx',mode:0o600});
    const {blocks}=await import(pathToFileURL(path).href);
    console.log('V3_B2D_ITERATION='+iterations);
    console.log('V3_B2D_BLOCKS='+built.blockCount);
    let pending=null;
    for(const profile of B2D_PROFILES){
      const r=replay(code,blocks,profile);
      console.log('V3_B2D_PROFILE_'+profile.toUpperCase()+'='+r.hashes.length+
        '_'+r.result.status);
      if(r.result.status!=='FRAMES_DONE'){pending=r;break;}
    }
    if(!pending){completed=true;break;}
    last=pending;
    if(last.result.status==='UNCOMPILED'){
      addTarget({bank:last.result.bank,pc:last.result.pc,
        overlay:last.result.overlay??null});
      continue;
    }
    if(last.result.status==='RAM_CODE_UNMAPPED'){
      const origin=locateRamCode(code,last.board.state,last.result.pc);
      if(!origin)fail('RAM_ORIGIN_UNRESOLVED');
      const index=code.ramOverlays.length;
      code.ramOverlays.push({start:origin.start,
        bytes:romBytes(code,origin.origin,origin.length)});
      addTarget({bank:null,pc:origin.start,overlay:index});
      continue;
    }
    fail('CPU_'+(last.result.code??last.result.status));
  }
  const basic={schema:'gng.v3.b2d-discovery.v1',
    status:completed?'CANDIDATE_COMPLETE':'BLOCKED_ITERATION_LIMIT',
    iterations,blocks:built.blockCount,
    parent_program_sha256:parent.files['program.mjs'],
    tape_sha256:digests,seeds,extra_overlays:overlaysFrom(code,originalOverlays),
    program_sha256:sha256(rewriteProgram(built.source)),
    last_result:last?.result??null,last_profile:last?.profile??null,
    last_frames:last?.hashes.length??null};
  if(!completed){
    persist(basic,resuming?previousIterations:null);
    console.log('V3_B2D_DISCOVERY=BLOCKED_ITERATION_LIMIT');
    console.log('V3_B2D_LAST_PROFILE='+basic.last_profile);
    console.log('V3_B2D_LAST_FRAME='+basic.last_frames);
    process.exitCode=2;return;
  }
  const modules=Object.fromEntries(MODULES.map(n=>
    [n,readFileSync(join(ROOT,'src',n),'utf8')]));
  const candidate=join(work,'candidate-frozen');
  freezeBundle(candidate,{generated:built.source,code,
    overlays:code.ramOverlays,modules,
    provenance:{frames:B2D_FRAMES,blocks:built.blockCount,
      source_report_sha256:parent.files['program.mjs'],
      source_git_head:execFileSync('git',['rev-parse','HEAD'],
        {cwd:ROOT,encoding:'utf8'}).trim()}});
  const idle=await runFrozen(candidate,{frames:600});
  const prior=await runFrozen(B2B,{frames:600});
  if(idle.sequence_sha256!==prior.sequence_sha256||
     JSON.stringify(idle.frame_hashes)!==JSON.stringify(prior.frame_hashes)||
     JSON.stringify(idle.events)!==JSON.stringify(prior.events))
    fail('NO_INPUT_V2_B2B_PARITY_BROKEN');
  const packaged=loadFrozen(candidate);
  const {blocks}=await import(pathToFileURL(join(candidate,'program.mjs')).href);
  const {createBoard:board}=await import(pathToFileURL(join(candidate,
    'gngb_runtime.mjs')).href);
  if(!(blocks instanceof Map)||blocks.size!==built.blockCount||
     typeof board!=='function')fail('PACKAGE_RUNTIME_INVALID');
  const result={};
  for(const profile of B2D_PROFILES){
    const a=replay(packaged.code,blocks,profile),b=replay(packaged.code,blocks,profile);
    if(a.result.status!=='FRAMES_DONE'||b.result.status!=='FRAMES_DONE'||
       a.hashes.length!==B2D_FRAMES||
       JSON.stringify(a.hashes)!==JSON.stringify(b.hashes)||
       JSON.stringify(a.reads)!==JSON.stringify(b.reads))
      fail('FROZEN_PROFILE_NOT_DETERMINISTIC_'+profile);
    result[profile]={hashes:a.hashes,reads:a.reads};
  }
  const effects={
    coin:diff(result.lateCoin.hashes,result.idle.hashes,812),
    start:diff(result.lateStart.hashes,result.lateCoin.hashes,850),
    controls:diff(result.lateControls.hashes,result.lateStart.hashes,900)
  };
  const active={lateCoin:result.lateCoin.reads.coin,
    lateStart:result.lateStart.reads.start,
    lateControls:result.lateControls.reads.right+
      result.lateControls.reads.left+
      result.lateControls.reads.attack+
      result.lateControls.reads.jump};
  const status=effects.coin!==null&&effects.start!==null&&
    effects.controls!==null&&Object.values(active).every(v=>v>0);
  if(!status){
    const blocked={...basic,status:'BLOCKED_GAMEPLAY_EFFECT_NOT_OBSERVED',
      effects,active};
    persist(blocked,resuming?previousIterations:null);
    console.log('V3_B2D_DISCOVERY=BLOCKED_GAMEPLAY_EFFECT_NOT_OBSERVED');
    process.exitCode=2;return;
  }
  renameSync(candidate,FROZEN);
  const summary={...basic,status:'DISCOVERY_COMPLETE',
    no_input:'PASS_600_FRAMES_IDENTICAL_B2B_V2',
    frozen_determinism:'PASS_2_RUNS_EACH_1500_FRAME_PROFILE',
    profiles:B2D_PROFILES,effects,active,
    frozen_program_sha256:packaged.manifest.files['program.mjs']};
  persist(summary,resuming?previousIterations:null);
  console.log('V3_B2D_NO_INPUT=PASS_600_FRAMES_EQUAL_B2B_V2');
  console.log('V3_B2D_FROZEN=PASS_5_PROFILES_1500_FRAMES_DOUBLE_REPLAY');
  console.log('V3_B2D_EFFECT_COIN_FRAME='+effects.coin);
  console.log('V3_B2D_EFFECT_START_FRAME='+effects.start);
  console.log('V3_B2D_EFFECT_CONTROLS_FRAME='+effects.controls);
  console.log('V3_B2D_DISCOVERY=PASS_REAL_AOT_1500_FRAMES');
  console.log('V3_B2D_BLOCKS='+built.blockCount);
}
try{await main()}catch(e){
  console.error('V3_B2D_DISCOVERY=BLOCKED_'+String(e.message)
    .replace(/^V3_B2D_/,''));
  process.exitCode=2;
}
