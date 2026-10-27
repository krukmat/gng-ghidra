#!/usr/bin/env node
/** H3 lab: bounded state inspection for a saved boss-search tape.
 * Replays only the frozen AOT bundle, applies the poke embedded in the tape,
 * and reports player state plus visible buffered sprites at selected frames.
 * Usage: node scripts/h3_boss_inspect.mjs <tape.json> <frame,frame,...>
 */
import {readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {loadFrozen} from '../src/v2_b1_frozen.mjs';
import {selectB3Bundle} from '../src/v3_b3_bundle.mjs';
import {resolveB3LabTape} from '../src/v3_b3_external_tape.mjs';
import {parseLabPokes,applyLabPokes} from '../src/h3_lab_poke.mjs';
import {drawOrder} from '../src/sprite_memory.mjs';

const ROOT=resolve(fileURLToPath(import.meta.url),'../..');
const [file,list]=process.argv.slice(2);
if(!file||!list)throw Error('H3_BOSS_INSPECT_USAGE');
const frames=list.split(',').map(Number);
if(!frames.length||frames.some(f=>!Number.isSafeInteger(f)||f<1))
  throw Error('H3_BOSS_INSPECT_FRAMES_INVALID');
const wanted=new Set(frames),first=Math.min(...frames),last=Math.max(...frames);
const raw=JSON.parse(readFileSync(file,'utf8'));
const tape=resolveB3LabTape(file);
if(last>tape.frames)throw Error('H3_BOSS_INSPECT_FRAME_OUTSIDE_TAPE');
const pokes=parseLabPokes(raw.h3?.poke??'');
const selected=selectB3Bundle(ROOT);
if(!selected)throw Error('V3_B3_NO_CERTIFIED_BUNDLE');
const {manifest,code}=loadFrozen(selected.dir);
const {blocks}=await import(pathToFileURL(join(selected.dir,'program.mjs')).href);
const {labCreateBoard}=await import(pathToFileURL(join(ROOT,'src/v3_b3_lab_board.mjs')).href);

const word=(b,a)=>b[a]<<8|b[a+1];
const bcd=b=>[0x68,0x69,0x6a,0x6b]
  .reduce((v,a)=>v*100+(b[a]>>4)*10+(b[a]&15),0);
const visibleSprites=b=>drawOrder(b.slice(0x2000,0x2200))
  .filter(s=>s.bytes.some(Boolean))
  .map(({slot,graphic,paletteGroup,x,y,flipX,flipY,bytes})=>
    ({slot,graphic,paletteGroup,x,y,flipX,flipY,bytes}));
const rows=[];
let maxX=-1,maxXFirst=null,maxXLast=null,maxXCount=0;
let board;
board=await labCreateBoard(join(selected.dir,'gngb_runtime.mjs'),
  manifest.files['gngb_runtime.mjs'],code,blocks,{frames:last,
    portRead:(addr,cycle)=>tape.read(addr,cycle),
    onFrame:r=>{
      const frame=board.state.records.length;
      applyLabPokes(pokes,board.state,frame);
      const x=word(r.record,0xa0);
      if(frame>=first){
        if(x>maxX){maxX=x;maxXFirst=maxXLast=frame;maxXCount=1;}
        else if(x===maxX){maxXLast=frame;maxXCount++;}
      }
      if(!wanted.has(frame))return;
      const b=r.record;
      rows.push({frame,phase:b[0x72],checkpoint:b[0x81],loop:b[0x71],
        lives:b[0x60],armor:b[0xac],score:bcd(b),x,y:word(b,0xa2),
        playerHandler:word(b,0x510),worldScroll:word(b,0x58),
        hardwareScroll:r.scroll[0]+256*r.scroll[1],
        visibleSprites:visibleSprites(b)});
    }});
const result=board.run();
console.log(JSON.stringify({schema:'gng.h3.boss-inspect.v1',
  bundleGeneration:selected.generation,tapeSha256:tape.sha256,
  poke:raw.h3?.poke??'',status:result.status,summaryFrom:first,
  maxX,maxXFirst,maxXLast,maxXCount,rows},null,2));
