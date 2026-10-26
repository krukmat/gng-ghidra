#!/usr/bin/env node
/**
 * V3.B2B build-only expansion: compile missing MC6809 blocks from the
 * authenticated private V3.B2A code image, never decode opcodes at runtime.
 *
 * Every missing block triggers a NEW build + cold reset. The resulting
 * immutable bundle under out/v3/b2b/ is the ONLY runtime artifact.
 */
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,existsSync,mkdtempSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {compileProgram} from '../src/mc6809_aot.mjs';
import {createBoard,GngbRuntimeError} from '../src/gngb_runtime.mjs';
import {locateRamCode,romBytes} from './r35_t5_run.mjs';
import {loadFrozen,freezeBundle,runFrozen,MODULES} from '../src/v2_b1_frozen.mjs';
import {verifySlot} from '../src/v2_b1_gate_lib.mjs';
import {createV3Tape,PROFILE_FRAMES} from '../src/v3_b2b_tape.mjs';
import {attestFoundationSeeds} from '../src/v3_b2b_foundation.mjs';

const ROOT=resolve(fileURLToPath(import.meta.url),'../..');
const OUT=join(ROOT,'out/v3/b2b');
const FROZEN=join(OUT,'frozen');
const SOURCE=join(ROOT,'out/v3/b2a/frozen');
const fail=s=>{throw Error('V3_B2B_'+s);};
const hashFrame=r=>{
  const h=createHash('sha256');
  h.update(r.record);h.update(r.known);
  h.update(JSON.stringify([r.scroll,r.bank,r.latch,r.sprite_buffer_valid,r.writes]));
  return h.digest('hex');
};
const digest=x=>createHash('sha256').update(x).digest('hex');
const seedOK=(x,code)=>x&&typeof x==='object'&&!Array.isArray(x)&&
  Number.isInteger(x.pc)&&x.pc>=0&&x.pc<=0xffff&&
  (x.bank===null||Number.isInteger(x.bank)&&x.bank>=0&&x.bank<5)&&
  (x.overlay===undefined||x.overlay===null||Number.isInteger(x.overlay)&&
    x.overlay>=0&&x.overlay<code.ramOverlays.length)&&
  (x.overlay==null||x.pc<0x3000)&&
  (x.pc>=0x6000&&x.bank===null&&x.overlay==null||
   x.pc>=0x4000&&x.pc<0x6000&&Number.isInteger(x.bank)&&x.overlay==null||
   x.pc<0x3000&&Number.isInteger(x.overlay)&&x.bank===null);
const seedKey=x=>[x.bank??'F',x.pc,x.overlay??'-'].join(':');
function runTape(code,blocks,tape,frames=PROFILE_FRAMES){
  const hashes=[],reads={system:0,coin:0,start:0,p1:0,right:0,left:0,
    attack:0,jump:0},first={coin:null,start:null,right:null,left:null,
    attack:null,jump:null};
  const mark=(name,r)=>{
    reads[name]++;
    if(first[name]===null)first[name]={cycle:r.cycle,pc:r.pc};
  };
  const board=createBoard(code,blocks,{frames,
    portRead:(a,c)=>tape.read(a,c),
    onPortRead:r=>{
      if(r.addr===0x3000){
        reads.system++;
        if(!(r.value&0x40))mark('coin',r);
        if(!(r.value&0x01))mark('start',r);
      }else if(r.addr===0x3001){
        reads.p1++;
        if(!(r.value&0x01))mark('right',r);
        if(!(r.value&0x02))mark('left',r);
        if(!(r.value&0x10))mark('attack',r);
        if(!(r.value&0x20))mark('jump',r);
      }
    },
    onFrame:r=>hashes.push(hashFrame(r))
  });
  let result;
  try{result=board.run()}
  catch(e){
    if(!(e instanceof GngbRuntimeError))throw e;
    result={status:'ERROR',code:e.code,pc:e.detail?.pc};
  }
  return {result,hashes,reads,first,board};
}
function diff(a,b,after){
  const n=Math.min(a.length,b.length);
  for(let i=Math.max(0,after-1);i<n;i++)
    if(a[i]!==b[i])return i+1;
  return null;
}
function recordReport(out){
  if(existsSync(join(OUT,'discovery-report.json')))fail('REPORT_ALREADY_EXISTS');
  writeFileSync(join(OUT,'discovery-report.json'),
    JSON.stringify(out,null,2)+'\n',{flag:'wx',mode:0o600});
}
async function main(){
  if(process.argv.slice(2).join(' ')!=='--discover')fail('ARGS_INVALID');
  if(existsSync(FROZEN))fail('BUNDLE_ALREADY_EXISTS');
  if(existsSync(join(OUT,'discovery-report.json')))fail('REPORT_ALREADY_EXISTS');
  const v2=verifySlot(join(ROOT,'out/v2/b1'),'one').report;
  const {manifest:parent,code}=loadFrozen(SOURCE);
  if(parent.frames!==600||parent.blocks!==354||parent.blocks!==v2.blocks)
    fail('INPUT_PARENT_NOT_B2A_CERTIFIED');
  // Input-aware expansion must retain the exact proven B2A runtime/ALU/
  // dispatcher. Merely matching state snapshots is not source integrity.
  for(const file of MODULES)
    if(readFileSync(join(ROOT,'src',file),'utf8')!==
       readFileSync(join(SOURCE,file),'utf8'))
      fail('PARENT_RUNTIME_MODULE_DRIFT');
  if(typeof parent.source_git_head!=='string'||
     !/^[0-9a-f]{40}$/.test(parent.source_git_head))
    fail('PARENT_SOURCE_COMMIT_INVALID');
  try{
    execFileSync('git',['diff','--exit-code',parent.source_git_head,'HEAD',
      '--','src/mc6809_aot.mjs'],{cwd:ROOT,stdio:'ignore'});
  }catch{fail('PARENT_AOT_COMPILER_DRIFT')}
  const b2a=JSON.parse(readFileSync(join(ROOT,
    'out/v3/b2a/coin-smoke.json'),'utf8'));
  if(b2a.status!=='INPUT_ROUTE_UNCOMPILED'||
     b2a.no_input_baseline!=='PASS_600_FRAMES_EQUAL_V2'||
     b2a.first_changed_frame!==421||
     !b2a.missing_block)fail('B2A_EVIDENCE_INVALID');

  const raw=JSON.parse(readFileSync(join(ROOT,'out/r35/t5/seeds.json'),'utf8'));
  // The historical V2/B2A builder accepted a broader seed shape than
  // *new execution targets* require. Do not reinterpret or discard old
  // tuples: prove they regenerate the exact signed frozen B2A AOT source.
  const libUrl=pathToFileURL(join(ROOT,'src/mc6809_aot_lib.mjs')).href;
  const attestation=attestFoundationSeeds({
    raw,code,manifest:parent,compileProgram,libUrl
  });
  const seeds=attestation.seeds;
  console.log('V3_B2B_FOUNDATION=PASS_EXACT_FROZEN_AOT');
  console.log('V3_B2B_FOUNDATION_BLOCKS='+attestation.count);
  console.log('V3_B2B_FOUNDATION_SEEDS='+attestation.seedCount);
  const known=new Set(seeds.map(seedKey));
  const addSeed=s=>{
    if(!seedOK(s,code))fail('DISCOVERED_SEED_INVALID');
    const k=seedKey(s);
    if(known.has(k))fail('DISCOVERY_NOT_PROGRESSING');
    known.add(k);seeds.push(s);
  };
  // Directly incorporate the known missing block from the successful B2A run.
  addSeed({bank:b2a.missing_block.bank,pc:b2a.missing_block.pc,
    overlay:b2a.missing_block.overlay??null});

  mkdirSync(OUT,{recursive:true,mode:0o700});
  const work=mkdtempSync(join(OUT,'work-'));
  const tape=createV3Tape('controls');
  let built,runner,completed=false,reason='ITERATION_LIMIT',iterations=0;
  const MAX=48;
  for(let iter=1;iter<=MAX;iter++){
    iterations=iter;
    built=compileProgram(code,seeds,{libUrl});
    const path=join(work,'program-'+iter+'.mjs');
    writeFileSync(path,built.source,{flag:'wx',mode:0o600});
    const {blocks}=await import(pathToFileURL(path).href);
    runner=runTape(code,blocks,tape);
    console.log('V3_B2B_DISCOVERY_ITERATION='+iter);
    console.log('V3_B2B_DISCOVERY_BLOCKS='+built.blockCount);
    console.log('V3_B2B_DISCOVERY_FRAMES='+runner.hashes.length);
    if(runner.result.status==='FRAMES_DONE'){
      completed=true;reason='FRAMES_DONE';break;
    }
    if(runner.result.status==='UNCOMPILED'){
      addSeed({bank:runner.result.bank,pc:runner.result.pc,
        overlay:runner.result.overlay??null});
      continue;
    }
    if(runner.result.status==='RAM_CODE_UNMAPPED'){
      const found=locateRamCode(code,runner.board.state,runner.result.pc);
      if(!found){reason='RAM_ORIGIN_UNRESOLVED';break}
      const ov=code.ramOverlays.length;
      code.ramOverlays.push({start:found.start,
        bytes:romBytes(code,found.origin,found.length)});
      addSeed({bank:null,pc:found.start,overlay:ov});
      continue;
    }
    reason=runner.result.status==='ERROR'
      ?runner.result.code:'UNEXPECTED_'+runner.result.status;
    break;
  }
  const preliminary={schema:'gng.v3.b2b-discovery.v1',
    status:completed?'FULL_TAPE_COMPILED':'BLOCKED_'+reason,
    frames:runner?.hashes.length??0,iterations,
    blocks:built?.blockCount??0,seed_count:seeds.length,
    overlay_count:code.ramOverlays.length,profile:tape.profile,
    tape_sha256:tape.sha256,
    source_git_head:execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim(),
    first_diff_vs_v2:runner?diff(runner.hashes,v2.frame_hashes,1):null,
    input_reads:runner?.reads??null,first_input_reads:runner?.first??null,
    last_result:runner?.result??null,seeds
  };
  if(!completed){
    recordReport(preliminary);
    console.log('V3_B2B_DISCOVERY=BLOCKED_'+reason);
    console.log('V3_B2B_DISCOVERY_LAST_FRAME='+preliminary.frames);
    process.exitCode=2;return;
  }

  const modules=Object.fromEntries(MODULES.map(n=>
    [n,readFileSync(join(ROOT,'src',n),'utf8')]));
  const mf=freezeBundle(FROZEN,{generated:built.source,code,
    overlays:code.ramOverlays,modules,
    provenance:{frames:PROFILE_FRAMES,blocks:built.blockCount,
      source_report_sha256:parent.source_report_sha256,
      source_git_head:preliminary.source_git_head}});
  // The final package is loaded from disk, not the build's imported source.
  const loaded=loadFrozen(FROZEN);
  const {blocks}=await import(pathToFileURL(join(FROZEN,'program.mjs')).href);
  const {createBoard:boardFromFrozen}=await import(pathToFileURL(
    join(FROZEN,'gngb_runtime.mjs')).href);
  // runFrozen and the frozen board share the identical no-input V2 semantics.
  const idle=await runFrozen(FROZEN,{frames:600});
  if(idle.sequence_sha256!==v2.sequence_sha256||
     JSON.stringify(idle.frame_hashes)!==JSON.stringify(v2.frame_hashes)||
     JSON.stringify(idle.events)!==JSON.stringify(v2.events))
    fail('V2_NO_INPUT_PARITY_BROKEN');
  console.log('V3_B2B_NO_INPUT=PASS_600_FRAMES_IDENTICAL_V2');

  // Independently replay on the immutable bundle with actual frozen runtime.
  const replay=(profile)=>{
    const t=createV3Tape(profile);
    const hashes=[],reads={coin:0,start:0,p1:0,right:0,left:0,attack:0,jump:0};
    const board=boardFromFrozen(loaded.code,blocks,{frames:PROFILE_FRAMES,
      portRead:(a,cycle)=>t.read(a,cycle),
      onPortRead:r=>{
        if(r.addr===0x3000){
          if(!(r.value&0x40))reads.coin++;
          if(!(r.value&0x01))reads.start++;
        }else if(r.addr===0x3001){
          reads.p1++;
          if(!(r.value&0x01))reads.right++;
          if(!(r.value&0x02))reads.left++;
          if(!(r.value&0x10))reads.attack++;
          if(!(r.value&0x20))reads.jump++;
        }
      },
      onFrame:r=>hashes.push(hashFrame(r))
    });
    const result=board.run();
    return {result,hashes,events:board.state.events,reads,tape_sha256:t.sha256};
  };
  const first=replay('controls'),second=replay('controls');
  if(first.result.status!=='FRAMES_DONE'||second.result.status!=='FRAMES_DONE'||
     first.hashes.length!==PROFILE_FRAMES||
     JSON.stringify(first.hashes)!==JSON.stringify(second.hashes)||
     JSON.stringify(first.events)!==JSON.stringify(second.events)||
     JSON.stringify(first.hashes)!==JSON.stringify(runner.hashes))
    fail('FROZEN_DETERMINISM_OR_BUILD_MISMATCH');
  console.log('V3_B2B_REPLAY=PASS_TWO_FROZEN_1000_FRAME_RUNS');
  const coin=replay('coin'),start=replay('start');
  if(coin.result.status!=='FRAMES_DONE'||start.result.status!=='FRAMES_DONE')
    fail('COMPARISON_PROFILE_UNCOMPILED');
  const report={...preliminary,status:'DISCOVERY_COMPLETE',
    frames:PROFILE_FRAMES,
    frozen_manifest_sha256:digest(JSON.stringify(mf.files)),
    first_start_effect_frame:diff(start.hashes,coin.hashes,530),
    first_controls_effect_frame:diff(first.hashes,start.hashes,650),
    comparison_read_counts:{
      coin:coin.reads.coin,start:start.reads.start,controls:first.reads
    },
    frozen_determinism:'PASS_TWO_FROZEN_1000_FRAME_RUNS',
    no_input:'PASS_600_FRAMES_IDENTICAL_V2',
  };
  recordReport(report);
  console.log('V3_B2B_DISCOVERY=PASS_1000_FRAMES_AOT_OFFLINE');
  console.log('V3_B2B_BLOCKS='+built.blockCount);
  console.log('V3_B2B_NEW_SEEDS='+(seeds.length-raw.length-2));
  console.log('V3_B2B_COIN_ACTIVE_READS='+first.reads.coin);
  console.log('V3_B2B_START_ACTIVE_READS='+first.reads.start);
  console.log('V3_B2B_PLAYER1_READS='+first.reads.p1);
  console.log('V3_B2B_FIRST_START_EFFECT='+String(report.first_start_effect_frame??'NONE'));
  console.log('V3_B2B_FIRST_CONTROLS_EFFECT='+String(report.first_controls_effect_frame??'NONE'));
  if(first.reads.coin>0&&first.reads.start>0&&
     report.first_start_effect_frame!==null){
    console.log('V3_B2B_COIN_START=PASS_CAUSAL_INPUT_EFFECT_NOT_NATIVE_CERTIFIED');
  }else{
    console.log('V3_B2B_COIN_START=BLOCKED_GAMEPLAY_STAGE_NOT_OBSERVED');
    process.exitCode=2;
  }
}
try{await main()}catch(e){
  console.error('V3_B2B_DISCOVERY=BLOCKED_'+
    (String(e.message).startsWith('V3_B2B_')?
      String(e.message).slice(7):'PRIVATE_INPUT_OR_IO'));
  process.exitCode=2;
}
