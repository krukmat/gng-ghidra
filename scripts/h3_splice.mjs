#!/usr/bin/env node
/** H3 lab: splice a donor route into a base tape (inputs only, no poke).
 * The base keeps its events up to and including frame <cut> (the inclusive
 * weapon-checkpoint cut), P1 is released until <at>, then the donor's P1
 * masks from <donorFrom> are replayed shifted by at-donorFrom up to <end>.
 * Both tapes are replayed from reset on the frozen certified bundle; the
 * report gives the first frame where the spliced run leaves the donor's
 * trajectory (phase, x, y, armour, lives lost; the weapon may differ), plus
 * phase and life events.
 * Usage: node scripts/h3_splice.mjs <base.json> <cut> <donor.json> <donorFrom> <at> <end>
 * Output: out/h3/boss/f2/splice-<at>-<donorFrom>.json tape (private); the
 * beam seals it (h3_boss_search.mjs with start=end) before any reuse.
 */
import {createHash} from 'node:crypto';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {loadFrozen} from '../src/v2_b1_frozen.mjs';
import {selectB3Bundle} from '../src/v3_b3_bundle.mjs';
import {CYCLES_PER_FRAME as CPF} from '../src/gngb_runtime.mjs';
import {defineInputSchedule,readScheduledPort} from '../src/gngb_input_contract.mjs';
import {resolveB3LabTape} from '../src/v3_b3_external_tape.mjs';
import {labCreateBoard} from '../src/v3_b3_lab_board.mjs';
import {P1_BITS,eventsToMasks,masksToEvents,look} from '../src/h3_explore.mjs';

const ROOT=resolve(fileURLToPath(import.meta.url),'../..');
const [baseFile,cutArg,donorFile,donorArg,atArg,endArg]=process.argv.slice(2);
const [cut,donorFrom,at,end]=[cutArg,donorArg,atArg,endArg].map(Number);
if(!baseFile||!donorFile||![cut,donorFrom,at,end].every(Number.isSafeInteger)||
  cut<2||at<=cut||end<=at||donorFrom<2)throw Error('H3_SPLICE_USAGE');
const baseRaw=JSON.parse(readFileSync(baseFile,'utf8')),donorRaw=JSON.parse(readFileSync(donorFile,'utf8'));
if(baseRaw.h3?.poke||donorRaw.h3?.poke)throw Error('H3_SPLICE_POKE_FORBIDDEN');
const base=resolveB3LabTape(baseFile),donor=resolveB3LabTape(donorFile);
const len=end-at+1,shift=at-donorFrom;
if(donorFrom+len>donor.frames)throw Error('H3_SPLICE_DONOR_HORIZON');
const isP1=e=>Object.hasOwn(P1_BITS,e.control);
const prefix=base.events.filter(e=>e.cycle<(cut+1)*CPF);
const held=new Set();
for(const e of prefix.filter(isP1))if(e.pressed)held.add(e.control);else held.delete(e.control);
const masks=eventsToMasks(donorFrom,donorFrom+len,donor.events);
const events=defineInputSchedule([...prefix,
  ...[...held].map(control=>({cycle:(cut+1)*CPF,control,pressed:false})),
  ...masksToEvents(at,masks,0)] // released again at end+1
  .sort((a,b)=>a.cycle-b.cycle||a.control.localeCompare(b.control))).events;

const selected=selectB3Bundle(ROOT);
if(!selected)throw Error('V3_B3_NO_CERTIFIED_BUNDLE');
const {manifest,code}=loadFrozen(selected.dir);
const {blocks}=await import(pathToFileURL(join(selected.dir,'program.mjs')).href);
const row=(i,b)=>({frame:i,...(s=>({phase:s.phase,x:s.x,y:s.y,lives:s.lives,armor:s.armor}))(look(b)),weapon:b[0x73]});
async function run(schedule,frames,onRow){
  const board=await labCreateBoard(join(selected.dir,'gngb_runtime.mjs'),
    manifest.files['gngb_runtime.mjs'],code,blocks,{frames,
      portRead:(addr,cycle)=>readScheduledPort(schedule,addr,cycle),
      onFrame:r=>{const $=board.state,i=$.records.length;$.records[i-1]=null;onRow(i,r.record);}});
  const status=board.lab.advanceTo(frames).status;
  return {status,ramSha:createHash('sha256').update(board.state.ramBytes(0,0x3000).bytes).digest('hex')};
}
const ref=new Map();
const donorRun=await run(defineInputSchedule(donor.events),donorFrom+len-1,
  (i,b)=>{if(i>=donorFrom)ref.set(i,row(i,b));});
let diverged=null,last=null,livesOffset=null;const phases=[],lives=[];
const spliceRun=await run(defineInputSchedule(events),end,(i,b)=>{
  const r=row(i,b);
  if(last&&r.phase!==last.phase)phases.push({frame:i,from:last.phase,to:r.phase,weapon:last.weapon});
  if(last&&r.lives<last.lives)lives.push({frame:i,lives:r.lives});
  last=r;
  if(i>=at&&!diverged){const d=ref.get(i-shift);livesOffset??=d&&r.lives-d.lives;
    // Weapon and life count differ by construction; a life lost is a divergence.
    if(d&&(['phase','x','y','armor'].some(k=>d[k]!==r[k])||r.lives-d.lives!==livesOffset))
      diverged={frame:i,donorFrame:i-shift,splice:r,donor:d};}
});
if(donorRun.status!=='FRAMES_DONE'||spliceRun.status!=='FRAMES_DONE')throw Error('H3_SPLICE_RUN_HALTED');
const metadata={schema:baseRaw.schema,profile:baseRaw.profile,frames:end+1,events};
const sha256=createHash('sha256').update(JSON.stringify(metadata)).digest('hex');
const out=join(ROOT,'out/h3/boss/f2');
mkdirSync(out,{recursive:true,mode:0o700});
const tapeFile=join(out,`splice-${at}-${donorFrom}.json`);
writeFileSync(tapeFile,JSON.stringify({...metadata,sha256,h3:{poke:'',from:base.sha256,prefix:cut,
  splice:{donor:donor.sha256,donorFrom,at,end,shift}}})+'\n',{mode:0o600});
console.log(JSON.stringify({schema:'gng.h3.splice.v1',bundleGeneration:selected.generation,
  base:base.sha256,donor:donor.sha256,cut,donorFrom,at,end,shift,diverged,final:last,phases,lives,
  ramSha:spliceRun.ramSha,tape:tapeFile.slice(ROOT.length+1),tapeSha256:sha256}));
