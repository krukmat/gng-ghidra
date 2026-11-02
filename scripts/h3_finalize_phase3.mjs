#!/usr/bin/env node
/** Seal a phase-3 search continuation as a replayable, input-only tape. */
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {loadFrozen} from '../src/v2_b1_frozen.mjs';
import {selectB3Bundle} from '../src/v3_b3_bundle.mjs';
import {resolveB3LabTape} from '../src/v3_b3_external_tape.mjs';
import {labCreateBoard} from '../src/v3_b3_lab_board.mjs';
import {B3_TAPE_SCHEMA} from '../src/v3_b3_tapes.mjs';
import {CYCLES_PER_FRAME as CPF} from '../src/gngb_runtime.mjs';
import {look} from '../src/h3_explore.mjs';

const ROOT=resolve(fileURLToPath(import.meta.url),'../..');
const [candidatePath,endArg]=process.argv.slice(2),end=Number(endArg),START=16980;
if(!candidatePath||!Number.isSafeInteger(end)||end<=START)throw Error('H3_PHASE3_FINALIZE_USAGE');
if(process.env.H3_POKE)throw Error('H3_POKE_FORBIDDEN');
const initialPath=join(ROOT,'out/h3/explore/tape-fase2-completa-16980.json');
const initial=JSON.parse(readFileSync(initialPath,'utf8'));
const candidate=JSON.parse(readFileSync(candidatePath,'utf8'));
const tape=resolveB3LabTape(candidatePath);
if(initial.sha256!=='1b77dd6ba5e2798428edb97318b66c106f6bd297fc1fbf15ecffe248df65ccf5' ||
  initial.h3?.ramSha!=='825a13d0af28a906b43942f46d2f8088d225691fa4466b658b7983f7fbffa004')
  throw Error('H3_PHASE3_INITIAL_MISMATCH');
if(candidate.h3?.poke||candidate.frames<=end)throw Error('H3_PHASE3_CANDIDATE_INVALID');
const cut=START*CPF;
if(JSON.stringify(candidate.events.filter(e=>e.cycle<cut))!==
   JSON.stringify(initial.events.filter(e=>e.cycle<cut)))throw Error('H3_PHASE3_PREFIX_EVENTS_MISMATCH');
if(candidate.events.some(e=>e.cycle>end*CPF))throw Error('H3_PHASE3_TAIL_PAST_END');
const held=new Set();
for(const e of candidate.events){
  if(e.pressed)held.add(e.control);
  else held.delete(e.control);
}
if([...held].some(control=>control.startsWith('p1.')))
  throw Error('H3_PHASE3_CONTROLS_NOT_RELEASED');
const selected=selectB3Bundle(ROOT);
if(selected?.generation!==6)throw Error('H3_PHASE3_G6_REQUIRED');
const {manifest,code}=loadFrozen(selected.dir);
const {blocks}=await import(pathToFileURL(join(selected.dir,'program.mjs')).href);
const sha256=b=>createHash('sha256').update(b).digest('hex');
let previous=null,transition=null,transitions=0,firstFatal=null,minLives=99;
const board=await labCreateBoard(join(selected.dir,'gngb_runtime.mjs'),
  manifest.files['gngb_runtime.mjs'],code,blocks,{frames:1,portRead:tape.read,
    onFrame:r=>{
      const i=board.state.records.length,b=r.record,phase=b[0x72];
      if(previous===2&&phase===3){transition=i;transitions++;}
      previous=phase;
      if(i>=START){
        minLives=Math.min(minLives,b[0x60]);
        if(firstFatal===null&&b[0x60]<initial.h3.signal.lives)firstFatal=i;
      }
      board.state.records[i-1]=null;
    }});
const advance=n=>{
  const r=board.lab.advanceTo(n);
  if(r.status!=='FRAMES_DONE')throw Error('H3_PHASE3_REPLAY_'+r.status+'_AT_'+n);
};
advance(START);
if(sha256(board.state.ramBytes(0,0x3000).bytes)!==initial.h3.ramSha)
  throw Error('H3_PHASE3_PREFIX_RAM_MISMATCH');
advance(end);
const s=look(board.state.ramBytes(0,0x600).bytes);
if(s.phase!==3||transitions!==1||transition<=START)throw Error('H3_PHASE3_TRANSITION_MISSING');
const signal={phase:s.phase,cp:s.cp,x:s.x,y:s.y,scroll:s.scroll,lives:s.lives,armor:s.armor};
const metadata={schema:B3_TAPE_SCHEMA,profile:candidate.profile,frames:end+1,events:candidate.events};
const out=join(ROOT,`out/h3/explore/tape-fase3-completa-${end}.json`);
const final={...metadata,sha256:sha256(JSON.stringify(metadata)),h3:{probe:'h3-phase3',
  bundle:'g6',from:{file:'tape-fase2-completa-16980.json',sha256:initial.sha256,goalFrame:START,
    ramSha:initial.h3.ramSha},goalFrame:end,transitionFrom:2,transitionFrame:transition,
  signal,ramSha:sha256(board.state.ramBytes(0,0x3000).bytes),minLives,firstFatal}};
writeFileSync(out,JSON.stringify(final)+'\n',{mode:0o600});
console.log('H3_PHASE3_FINAL=PASS transition='+transition+' end='+end+' minLives='+minLives+
  ' firstFatal='+firstFatal+' tape='+out);
