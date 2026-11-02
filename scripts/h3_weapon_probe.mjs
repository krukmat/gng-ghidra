#!/usr/bin/env node
/** Read-only weapon provenance audit of an existing input-only g6 tape.
 * Replays from reset, verifies the tape's RAM SHA, and records every weapon
 * transition after the requested start frame. No branches or new inputs.
 * Usage: node scripts/h3_weapon_probe.mjs <tape.json> [startFrame=36091]
 */
import {createHash} from 'node:crypto';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {basename,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {loadFrozen} from '../src/v2_b1_frozen.mjs';
import {selectB3Bundle} from '../src/v3_b3_bundle.mjs';
import {resolveB3LabTape} from '../src/v3_b3_external_tape.mjs';
import {labCreateBoard} from '../src/v3_b3_lab_board.mjs';
import {look} from '../games/gngb/state.mjs';
import {weaponTransition} from '../src/h3_weapon_goal.mjs';

const ROOT=resolve(fileURLToPath(import.meta.url),'../..');
const [file,startArg='36091']=process.argv.slice(2);
if(!file)throw Error('H3_WEAPON_PROBE_USAGE');
const start=Number(startArg),raw=JSON.parse(readFileSync(file,'utf8'));
const end=raw.h3?.goalFrame;
if(!Number.isSafeInteger(start)||start<1||
  !Number.isSafeInteger(end)||end<start)throw Error('H3_WEAPON_PROBE_FRAME_RANGE');
if(!(/^[a-f0-9]{64}$/).test(raw.h3?.ramSha??''))
  throw Error('H3_WEAPON_PROBE_NO_REFERENCE');
if(raw.h3?.poke)throw Error('H3_WEAPON_PROBE_POKE_FORBIDDEN');
const tape=resolveB3LabTape(file);
const selected=selectB3Bundle(ROOT);
if(selected?.generation!=='g6')throw Error('H3_WEAPON_PROBE_G6_REQUIRED');
const {manifest,code}=loadFrozen(selected.dir);
const {blocks}=await import(pathToFileURL(join(selected.dir,'program.mjs')).href);
let previous=null,first=null,last=null,changes=[],phases=[];
let board;
board=await labCreateBoard(join(selected.dir,'gngb_runtime.mjs'),
  manifest.files['gngb_runtime.mjs'],code,blocks,{frames:end,
  portRead:tape.read,onFrame:r=>{
    const i=board.state.records.length;
    const s={...look(r.record),weapon:r.record[0x73]};
    if(i===start)first={frame:i,...s};
    if(i>=start){
      const ev=weaponTransition(previous,s,i);
      if(ev)changes.push(ev);
      if(previous&&previous.phase!==s.phase)
        phases.push({frame:i,from:previous.phase,to:s.phase,weaponAtExit:previous.weapon});
      last={frame:i,...s};
    }
    previous=s;
    board.state.records[i-1]=null;
    board.state.events.length=0;
  }});
const advanced=board.lab.advanceTo(end);
if(advanced.status!=='FRAMES_DONE')throw Error('H3_WEAPON_PROBE_HALT '+advanced.status);
const ram=board.state.ramBytes(0,0x3000).bytes;
const actual=createHash('sha256').update(ram).digest('hex');
if(actual!==raw.h3.ramSha)throw Error('H3_WEAPON_PROBE_REPLAY_MISMATCH');
const report={schema:'gng.h3.weapon-probe.v1',bundle:'g6',
  source:basename(file),tapeSha256:tape.sha256,ramSha256:actual,ramVerified:true,
  startFrame:start,endFrame:end,initial:first,final:last,weaponTransitions:changes,
  phaseTransitions:phases,
  acquiredShield:changes.some(x=>x.required===true)};
const out=join(ROOT,'out/h3/phase6');mkdirSync(out,{recursive:true,mode:0o700});
const filename=join(out,'weapon-probe-'+basename(file));
writeFileSync(filename,JSON.stringify(report,null,2)+'\n',{mode:0o600});
console.log('H3_WEAPON_PROBE=PASS '+JSON.stringify({
  startFrame:start,endFrame:end,ramVerified:true,
  weaponChanges:changes.length,acquiredShield:report.acquiredShield,
  phaseTransitions:phases,output:filename}));
