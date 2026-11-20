#!/usr/bin/env node
/** Replay a tape exported by the Lancelot page from reset on the shipped
 * program and renderer. Verify the recorded frame and Lancelot's visible
 * outfit. Usage: node scripts/lancelot_tape_check.mjs [tape.json]. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {gngCode} from '../boards/gng/bundle.mjs';
import {createBoard} from '../boards/gng/runtime.mjs';
import {gameOptions,optionDips,withGameOptions} from '../games/gngb/options.mjs';
import {unpackGfx} from '../src/ao_web_assets.mjs';
import {renderGngbRgba} from '../src/gngb_frame_renderer.mjs';
import {rendererInputs} from '../src/gngb_render_inputs.mjs';
import {lancelotOverrides,playerSprites} from '../src/lancelot_skin.mjs';
import {drawOrder} from '../src/sprite_memory.mjs';
import {LIVE_TAPE_SCHEMA,liveTapeReader} from '../src/v3_b3_live_tape.mjs';

const path=process.argv[2]??'out/android/check/lancelot-tape.json';
const bundle='out/android/assets/bundle';
const tape=JSON.parse(readFileSync(path,'utf8'));
const manifest=JSON.parse(readFileSync(join(bundle,'manifest.json'),'utf8'));
assert.equal(tape.schema,LIVE_TAPE_SCHEMA);
assert.equal(tape.program_sha256,manifest.files['program.mjs']);
assert.equal(gameOptions(tape.options).character,'lancelot');
assert.equal(tape.check?.frame,tape.frame);
assert.ok(tape.changes.length>0);
const code=gngCode(manifest,readFileSync(join(bundle,'code.bin')),
  readFileSync(join(bundle,'overlays.bin')));
const {blocks}=await import(pathToFileURL(join(process.cwd(),bundle,'program.mjs')).href);
const gfx=unpackGfx(new Uint8Array(readFileSync('out/android/assets/gfx.bin')));
let recordHash=null,outfit=0,hair=0,changed=0,visibleFrame=null;
const board=createBoard(code,withGameOptions(blocks,tape.options),{
  frames:tape.frame,dips:optionDips(tape.options),portRead:liveTapeReader(tape.changes),
  onFrame:r=>{
    if(r.index===tape.frame)
      recordHash=createHash('sha256').update(r.record).update(r.known).digest('hex');
    if(visibleFrame===null&&r.index>500){
      const inputs=rendererInputs(r.record,{scroll:r.scroll,latch:r.latch},gfx);
      if(playerSprites(drawOrder(inputs.bufferedSprites)).some(s=>s.graphic<0x30)){
        const arthur=renderGngbRgba(inputs).rgba;
        const lancelot=renderGngbRgba({...inputs,spriteColors:lancelotOverrides}).rgba;
        let nextOutfit=0,nextHair=0,nextChanged=0;
        for(let i=0;i<lancelot.length;i+=4){
          const rgb=[lancelot[i],lancelot[i+1],lancelot[i+2]];
          if(rgb[0]===112&&rgb[1]===120&&rgb[2]===52)nextOutfit++;
          if(rgb[0]===74&&rgb[1]===46&&rgb[2]===26)nextHair++;
          if(rgb.some((v,j)=>v!==arthur[i+j]))nextChanged++;
        }
        if(nextOutfit>40){
          visibleFrame=r.index;outfit=nextOutfit;hair=nextHair;changed=nextChanged;
        }
      }
    }
    board.state.records[r.index-1]=null;board.state.events.length=0;
  }});
assert.equal(board.run().status,'FRAMES_DONE');
assert.equal(recordHash,tape.check.record_sha256,'exported tape replays the same frame');
console.log('LANCELOT_TAPE_RENDER '+JSON.stringify({frame:visibleFrame,outfit,hair,changed}));
assert.ok(outfit>40,'the replay renders Lancelot in his archer outfit');
assert.ok(changed>40,'the character changes visible pixels');
const report={status:'PASS',tape:path,frame:tape.frame,visibleFrame,
  changes:tape.changes.length,
  recordHash,outfitPixels:outfit,hairPixels:hair,changedPixels:changed};
mkdirSync('out/android/check',{recursive:true});
writeFileSync('out/android/check/lancelot-tape-check.json',JSON.stringify(report,null,2)+'\n');
console.log('LANCELOT_TAPE_CHECK=PASS '+JSON.stringify(report));
