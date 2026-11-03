#!/usr/bin/env node
/** Generic input-only finalizer: <visiblePhase> <initialTape> <candidateTape> <goalFrame>.
 * Legacy scripts/h3_finalize_phase3.mjs stays unchanged. See docs/go-explore/README.md.
 */
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {basename,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {loadFrozen} from '../src/v2_b1_frozen.mjs';
import {selectB3Bundle} from '../src/v3_b3_bundle.mjs';
import {resolveB3LabTape} from '../src/v3_b3_external_tape.mjs';
import {labCreateBoard} from '../src/v3_b3_lab_board.mjs';
import {B3_TAPE_SCHEMA} from '../src/v3_b3_tapes.mjs';
import {look} from '../src/h3_explore.mjs';
import {assertPhaseCandidate,transitionObserver,phase6Sample,phase6Evidence} from '../src/h3_phase_contract.mjs';
const ROOT=resolve(fileURLToPath(import.meta.url),'../..');
const [phaseArg,initialArg,candidateArg,endArg]=process.argv.slice(2);
if(!phaseArg||!initialArg||!candidateArg||!endArg)throw Error('H3_PHASE_FINALIZE_USAGE');
const visiblePhase=Number(phaseArg),end=Number(endArg);
if(process.env.H3_POKE)throw Error('H3_PHASE_POKE_FORBIDDEN');
const sha256=b=>createHash('sha256').update(b).digest('hex');
const initial=JSON.parse(readFileSync(initialArg,'utf8'));
const candidate=JSON.parse(readFileSync(candidateArg,'utf8'));
const src=resolveB3LabTape(initialArg),tape=resolveB3LabTape(candidateArg);
const {from,to,start}=assertPhaseCandidate({visiblePhase,initial,candidate,end,
  initialSha:src.sha256,candidateSha:tape.sha256});
const selected=selectB3Bundle(ROOT);
if(selected?.generation!==6)throw Error('H3_PHASE_G6_REQUIRED');
const {manifest,code}=loadFrozen(selected.dir);
const {blocks}=await import(pathToFileURL(join(selected.dir,'program.mjs')).href);
const observer=transitionObserver(from,start);
let minLives=99,firstFatal=null;
const p6Rows=visiblePhase===6?[]:null;
const board=await labCreateBoard(join(selected.dir,'gngb_runtime.mjs'),
  manifest.files['gngb_runtime.mjs'],code,blocks,{frames:1,portRead:tape.read,
    onFrame:r=>{
      const frame=board.state.records.length,b=r.record;
      observer.record(frame,b[0x72]);
      if(frame>=start){
        minLives=Math.min(minLives,b[0x60]);
        if(firstFatal===null&&b[0x60]<initial.h3.signal.lives)firstFatal=frame;
        if(p6Rows&&frame<=end)p6Rows.push(phase6Sample(frame,b));
      }
      board.state.records[frame-1]=null;
    }});
const advance=frame=>{
  const result=board.lab.advanceTo(frame);
  if(result.status!=='FRAMES_DONE')throw Error('H3_PHASE_REPLAY_'+result.status+'_AT_'+frame);
};
advance(start);
if(sha256(board.state.ramBytes(0,0x3000).bytes)!==initial.h3.ramSha)
  throw Error('H3_PHASE_PREFIX_RAM_MISMATCH');
advance(end);
const s=look(board.state.ramBytes(0,0x600).bytes);
const {transition,count,otherChanges}=observer.result();
if(s.phase!==to||count!==1||!transition||otherChanges.length)
  throw Error('H3_PHASE_TRANSITION_INVALID '+JSON.stringify({s:s.phase,count,transition,otherChanges}));
const phase6=p6Rows&&phase6Evidence(p6Rows,{transition,end});
const signal={phase:s.phase,cp:s.cp,x:s.x,y:s.y,scroll:s.scroll,lives:s.lives,armor:s.armor};
const metadata={schema:B3_TAPE_SCHEMA,profile:candidate.profile,frames:end+1,events:candidate.events};
const out=join(ROOT,'out/h3/explore/tape-fase'+visiblePhase+'-completa-'+end+'.json');
const final={...metadata,sha256:sha256(JSON.stringify(metadata)),h3:{probe:'h3-phase'+visiblePhase,
  bundle:'g6',from:{file:basename(initialArg),sha256:initial.sha256,goalFrame:start,
    ramSha:initial.h3.ramSha},goalFrame:end,transitionFrom:from,transitionFrame:transition,
    signal,ramSha:sha256(board.state.ramBytes(0,0x3000).bytes),minLives,firstFatal,
    ...(phase6&&{phase6})}};
mkdirSync(join(ROOT,'out/h3/explore'),{recursive:true,mode:0o700});
writeFileSync(out,JSON.stringify(final)+'\n',{mode:0o600});
console.log('H3_PHASE'+visiblePhase+'_FINAL=PASS transition='+transition+' end='+end+
  ' minLives='+minLives+' firstFatal='+firstFatal+
  (phase6?' phase6='+JSON.stringify(phase6):'')+' tape='+out);
