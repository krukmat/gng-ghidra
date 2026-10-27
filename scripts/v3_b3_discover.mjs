#!/usr/bin/env node
/**
 * V3.B3: first playable route (Coin -> Start -> Arthur) on real AOT code.
 * Child of the certified B2-D bundle, which is never modified.
 *
 * 1. Attest B2-D: rebuild its exact program from its recorded seeds.
 * 2. Discover OFFLINE in one replay per tape: missing blocks are compiled
 *    on demand by the same AOT compiler and recorded as seeds.
 * 3. Rebuild everything statically from the seeds, freeze, and certify on
 *    a plain Map (no fallback): B2-D no-input/profile hashes unchanged, B3
 *    tapes double-replayed and identical to the discovery replay.
 */
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,existsSync,mkdtempSync,renameSync}
  from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {loadFrozen,freezeBundle,runFrozen,rewriteProgram,sha256,MODULES}
  from '../src/v2_b1_frozen.mjs';
import {compileProgram,blockKey} from '../src/mc6809_aot.mjs';
import * as AOT_LIB from '../src/mc6809_aot_lib.mjs';
// Runtime modules come from the certified B2-D bundle, not src/: later
// observation-only changes in src (audio tap) need their own certification.
let createBoard,GngbRuntimeError;
import {locateRamCode,romBytes} from './r35_t5_run.mjs';
import {b2dTape,b2dCoverageFrames,B2D_PROFILES} from '../src/v3_b2d_tapes.mjs';
import {b2dCertified} from '../src/v3_b2d_selection.mjs';
import {B3_PROFILES,B3_HORIZONS,b3Tape} from '../src/v3_b3_tapes.mjs';
import {createOnDemandBlocks} from '../src/v3_b3_ondemand.mjs';
import {B3_GENERATION,B3_MULTI_ENTRY_FROM,B3_STATIC_TABLES_FROM,
  B3_STATIC_CLOSURE_FROM,b3GenerationDir}
  from '../src/v3_b3_bundle.mjs';
import {findJumpTables,jumpTableSeeds} from '../src/v3_b3_jump_tables.mjs';
import {staticClosure} from '../src/v3_b3_static_closure.mjs';

const ROOT=resolve(fileURLToPath(import.meta.url),'../..');
const B2D=join(ROOT,'out/v3/b2d/frozen');
const B2D_REPORT=join(ROOT,'out/v3/b2d/discovery-report.json');
const OUT=b3GenerationDir(ROOT);
const FROZEN=join(OUT,'frozen');
const REPORT=join(OUT,'discovery-report.json');
export const B3_LIVE_FRAMES=6000;
const fail=s=>{throw Error('V3_B3_'+s);};
const ENTRIES=B3_GENERATION>=B3_MULTI_ENTRY_FROM;
const TABLES=B3_GENERATION>=B3_STATIC_TABLES_FROM;
const CLOSURE=B3_GENERATION>=B3_STATIC_CLOSURE_FROM;
const keyOf=s=>blockKey(s.overlay==null?s.bank:null,s.pc,s.overlay??null);
const hashFrame=r=>{
  const h=createHash('sha256');
  h.update(r.record);h.update(r.known);
  h.update(JSON.stringify([r.scroll,r.bank,r.latch,r.sprite_buffer_valid,r.writes]));
  return h.digest('hex');
};
const firstDiff=(a,b,from)=>{
  const n=Math.min(a.length,b.length);
  for(let i=Math.max(0,from-1);i<n;i++)if(a[i]!==b[i])return i+1;
  return null;
};
function replay(code,blocks,tape,frames){
  const hashes=[],reads={coin:0,start:0,p1:0};
  const board=createBoard(code,blocks,{frames,
    portRead:(addr,cycle)=>tape.read(addr,cycle),
    onPortRead:r=>{
      if(r.addr===0x3000){
        if(!(r.value&0x40))reads.coin++;
        if(!(r.value&0x01))reads.start++;
      }else if(r.addr===0x3001&&(r.value&0x3f)!==0x3f)reads.p1++;
    },
    // Keep only the hash: long tapes must not retain every snapshot.
    onFrame:r=>{hashes.push(hashFrame(r));
      board.state.records[board.state.records.length-1]=null;}
  });
  let result;
  try{result=board.run()}catch(e){
    if(!(e instanceof GngbRuntimeError))throw e;
    result={status:'ERROR',code:e.code,detail:e.detail};
  }
  return {hashes,reads,result,board};
}
async function importProgram(path){
  return (await import(pathToFileURL(path).href)).blocks;
}
async function main(){
  if(process.argv.length!==2)fail('USAGE');
  if(existsSync(FROZEN))fail('FROZEN_ALREADY_EXISTS');
  const parentData=loadFrozen(B2D),parent=parentData.manifest,code=parentData.code;
  const parentReport=JSON.parse(readFileSync(B2D_REPORT,'utf8'));
  if(!b2dCertified(parentReport,parent))fail('B2D_PARENT_NOT_CERTIFIED');
  const libUrl=pathToFileURL(join(ROOT,'src/mc6809_aot_lib.mjs')).href;
  for(const module of MODULES)
    if(sha256(readFileSync(join(B2D,module)))!==parent.files[module])
      fail('PARENT_RUNTIME_DRIFT');
  ({createBoard,GngbRuntimeError}=
    await import(pathToFileURL(join(B2D,'gngb_runtime.mjs')).href));
  const parentSeeds=parentReport.seeds.map(s=>({...s}));
  const rebuilt=compileProgram(code,parentSeeds,{libUrl});
  if(rebuilt.blockCount!==parent.blocks||
     sha256(rewriteProgram(rebuilt.source))!==parent.files['program.mjs'])
    fail('PARENT_AOT_REBUILD_MISMATCH');
  console.log('V3_B3_PARENT=PASS_B2D_'+parent.blocks+'_BLOCKS_REBUILT_EXACT');

  // --- Offline one-pass discovery -------------------------------------
  const base=await importProgram(join(B2D,'program.mjs'));
  const parentOverlays=code.ramOverlays.length;
  const od=createOnDemandBlocks(base,code,{libUrl,lib:AOT_LIB,entries:ENTRIES});
  const discovered={};
  for(const profile of B3_PROFILES){
    const tape=b3Tape(profile),frames=B3_HORIZONS[profile];
    for(let attempt=0;;attempt++){
      if(attempt>64)fail('RAM_OVERLAY_LIMIT_'+profile);
      const r=replay(code,od.blocks,tape,frames);
      if(r.result.status==='RAM_CODE_UNMAPPED'){
        const origin=locateRamCode(code,r.board.state,r.result.pc);
        if(!origin)fail('RAM_ORIGIN_UNRESOLVED');
        code.ramOverlays.push({start:origin.start,
          bytes:romBytes(code,origin.origin,origin.length)});
        continue;
      }
      if(r.result.status!=='FRAMES_DONE')
        fail('DISCOVERY_'+profile+'_'+(r.result.code??r.result.status)+
          '_PC_'+(r.result.detail?.pc??r.result.pc));
      discovered[profile]={hashes:r.hashes,reads:r.reads};
      console.log('V3_B3_DISCOVER_'+profile+'='+frames+'_FRAMES_TARGETS_'+
        od.found.length);
      break;
    }
  }
  // --- Static rebuild from seeds ---------------------------------------
  const seeds=[...parentSeeds],known=new Set(seeds.map(keyOf));
  for(const s of od.found){
    const k=keyOf(s);
    if(!known.has(k)){known.add(k);seeds.push(s);}
  }
  const tableSeeds=TABLES?jumpTableSeeds(code):[];
  let tableNew=0;
  for(const s of tableSeeds){
    const k=keyOf(s);
    if(!known.has(k)){known.add(k);seeds.push(s);tableNew++;}
  }
  if(TABLES)console.log('V3_B3_JUMP_TABLES='+findJumpTables(code).length+
    '_TARGETS_'+tableSeeds.length+'_NEW_'+tableNew);
  const closure=CLOSURE?staticClosure(code):null;
  let closureNew=0;
  for(const s of closure?.seeds??[]){
    const k=keyOf(s);
    if(!known.has(k)){known.add(k);seeds.push(s);closureNew++;}
  }
  if(CLOSURE)console.log('V3_B3_STATIC_CLOSURE='+closure.seeds.length+
    '_BLOCKS_NEW_'+closureNew+'_INDIRECT_EXITS_'+closure.indirect);
  const built=compileProgram(code,seeds,{libUrl,entries:ENTRIES});
  console.log('V3_B3_FUNCTIONS='+built.functions+'_ENTRIES_'+ENTRIES);
  console.log('V3_B3_BLOCKS='+built.blockCount+'_NEW_SEEDS_'+
    (seeds.length-parentSeeds.length));
  mkdirSync(OUT,{recursive:true,mode:0o700});
  const work=mkdtempSync(join(OUT,'work-'));
  const candidate=join(work,'candidate-frozen');
  const modules=Object.fromEntries(MODULES.map(n=>
    [n,readFileSync(join(B2D,n),'utf8')]));
  const head=execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim();
  freezeBundle(candidate,{generated:built.source,code,overlays:code.ramOverlays,
    modules,provenance:{frames:B3_LIVE_FRAMES,blocks:built.blockCount,
      source_report_sha256:parent.files['program.mjs'],source_git_head:head}});
  const packaged=loadFrozen(candidate);
  const blocks=await importProgram(join(candidate,'program.mjs'));
  if(!(blocks instanceof Map)||blocks.size!==built.blockCount)
    fail('PACKAGE_RUNTIME_INVALID');

  // --- Certification on the frozen candidate (plain Map) ----------------
  const idle=await runFrozen(candidate,{frames:600});
  const prior=await runFrozen(B2D,{frames:600});
  if(idle.sequence_sha256!==prior.sequence_sha256||
     JSON.stringify(idle.frame_hashes)!==JSON.stringify(prior.frame_hashes)||
     JSON.stringify(idle.events)!==JSON.stringify(prior.events))
    fail('NO_INPUT_B2D_PARITY_BROKEN');
  console.log('V3_B3_NO_INPUT=PASS_600_FRAMES_EQUAL_B2D');
  for(const profile of B2D_PROFILES){
    const frames=b2dCoverageFrames(profile),tape=b2dTape(profile);
    const a=replay(packaged.code,blocks,tape,frames);
    const b=replay(parentData.code,base,tape,frames);
    if(a.result.status!=='FRAMES_DONE'||b.result.status!=='FRAMES_DONE'||
       JSON.stringify(a.hashes)!==JSON.stringify(b.hashes)||
       JSON.stringify(a.reads)!==JSON.stringify(b.reads))
      fail('B2D_PROFILE_CHANGED_'+profile);
    console.log('V3_B3_B2D_'+profile+'=PASS_'+frames+'_FRAMES_IDENTICAL');
  }
  const certified={};
  for(const profile of B3_PROFILES){
    const tape=b3Tape(profile),frames=B3_HORIZONS[profile];
    const a=replay(packaged.code,blocks,tape,frames);
    const b=replay(packaged.code,blocks,tape,frames);
    if(a.result.status!=='FRAMES_DONE'||b.result.status!=='FRAMES_DONE'||
       a.hashes.length!==frames||
       JSON.stringify(a.hashes)!==JSON.stringify(b.hashes)||
       JSON.stringify(a.reads)!==JSON.stringify(b.reads))
      fail('FROZEN_NOT_DETERMINISTIC_'+profile+'_'+
        (a.result.code??a.result.status));
    if(JSON.stringify(a.hashes)!==JSON.stringify(discovered[profile].hashes)||
       JSON.stringify(a.reads)!==JSON.stringify(discovered[profile].reads))
      fail('FROZEN_DIFFERS_FROM_DISCOVERY_'+profile);
    certified[profile]={frames,tape_sha256:tape.sha256,reads:a.reads,
      sequence_sha256:sha256(a.hashes.join('\n')),hashes:a.hashes};
    console.log('V3_B3_'+profile+'=PASS_'+frames+'_FRAMES_DOUBLE_REPLAY');
  }
  // A newer generation must not change any frame of a tape the previous
  // certified generation already covered.
  const priorPath=join(b3GenerationDir(ROOT,B3_GENERATION-1),'discovery-report.json');
  if(B3_GENERATION>1&&existsSync(priorPath)){
    const priorReport=JSON.parse(readFileSync(priorPath,'utf8'));
    for(const [p,c] of Object.entries(priorReport.profiles??{})){
      if(!certified[p]||c.tape_sha256!==certified[p].tape_sha256)continue;
      if(c.sequence_sha256!==certified[p].sequence_sha256)
        fail('PRIOR_GENERATION_DIVERGES_'+p);
      console.log('V3_B3_PRIOR_'+p+'=PASS_IDENTICAL_TO_G'+(B3_GENERATION-1));
    }
  }
  const h=p=>certified[p].hashes;
  // Diagnostics only: visible gates are judged on rendered witnesses.
  const effects={
    coin:firstDiff(h('titleCoinStart'),h('idle'),560),
    early_coin:firstDiff(h('humanEarlyCoin'),h('idle'),311),
    controls:firstDiff(h('arthurControls'),h('titleCoinStart'),1240)
  };
  renameSync(candidate,FROZEN);
  const report={schema:'gng.v3.b3-playable.v1',status:'DISCOVERY_COMPLETE',
    generation:B3_GENERATION,
    parent_program_sha256:parent.files['program.mjs'],parent_blocks:parent.blocks,
    blocks:built.blockCount,functions:built.functions,
    block_entries:ENTRIES?'ALL_INSTRUCTION_BOUNDARIES':'BLOCK_START_ONLY',
    static_jump_table_seeds:tableSeeds.length,
    static_closure_seeds:closure?.seeds.length??0,seeds,
    extra_overlays:code.ramOverlays.slice(parentOverlays).map(ov=>
      ({start:ov.start,hex:Buffer.from(ov.bytes).toString('hex')})),
    no_input:'PASS_600_FRAMES_IDENTICAL_B2D',
    parent_profiles_unchanged:true,
    frozen_determinism:'PASS_2_RUNS_PER_PROFILE_EQUAL_DISCOVERY',
    profiles:Object.fromEntries(Object.entries(certified).map(([p,c])=>
      [p,{frames:c.frames,tape_sha256:c.tape_sha256,reads:c.reads,
        sequence_sha256:c.sequence_sha256}])),
    effects,live_frames:B3_LIVE_FRAMES,
    frozen_program_sha256:packaged.manifest.files['program.mjs'],
    source_git_head:head};
  writeFileSync(REPORT,JSON.stringify(report,null,2)+'\n',{mode:0o600});
  console.log('V3_B3_EFFECTS='+JSON.stringify(effects));
  console.log('V3_B3_DISCOVERY=PASS_GENERATION_'+B3_GENERATION+'_FROZEN_'+
    built.blockCount+'_BLOCKS');
}
try{await main()}catch(e){
  console.error('V3_B3_DISCOVERY=BLOCKED_'+String(e.message).replace(/^V3_B3_/,''));
  if(!String(e.message).startsWith('V3_B3_'))console.error(e.stack);
  process.exitCode=2;
}
