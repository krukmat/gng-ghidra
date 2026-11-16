#!/usr/bin/env node
/** Private gate and video of a cooperative tape from scripts/gng_coop_explore.mjs.
 * Replays the input-only tape from reset, without restore, on the shipped
 * program bundle and board runtime (as the app runs it) with the tape's
 * options, and requires: the cooperative options, visible phases 1 and 2
 * completed in order (RAM 0x72 0 -> 1 -> 2) at the explorer's frames, a
 * turn change inside each completed phase, the game still on at the goal and
 * the turns reported by src/ao_match.mjs. Then renders it like the app to
 * out/gng-coop/video/<tape>.mp4 with a JSON of events (turns, deaths, phases).
 * Needs the ROM-derived bundle (AO_BUNDLE, default out/rp4/build/bundle),
 * roms/gng.zip and ffmpeg.
 * Usage: node scripts/gng_coop_tape_check.mjs <tape.json> [--no-video] [--partial]
 * (--partial: an intermediate tape, checked against its own phases only)
 */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {closeSync,mkdirSync,openSync,readFileSync,rmSync,writeFileSync,writeSync} from 'node:fs';
import {basename,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {gngCode} from '../boards/gng/bundle.mjs';
import {createBoard} from '../boards/gng/runtime.mjs';
import {resolveB3LabTape} from '../src/v3_b3_external_tape.mjs';
import {observeGameState} from '../games/gngb/state.mjs';
import {createMatchTracker} from '../src/ao_match.mjs';
import {gameOptions,optionDips,withGameOptions} from '../games/gngb/options.mjs';
import {rendererUnknownCount} from '../src/v2_b1_observable.mjs';
import {renderGngbRgba} from '../src/gngb_frame_renderer.mjs';
import {rendererInputs} from '../src/gngb_render_inputs.mjs';
import {gngbGraphics} from './r35_t5_render_check.mjs';

const ROOT=resolve(fileURLToPath(import.meta.url),'../..');
const BUNDLE=resolve(ROOT,process.env.AO_BUNDLE??'out/rp4/build/bundle');
const OUT=join(ROOT,'out/gng-coop/video'),F=25152,FPS=`1500000/${F}`;
const [path,...flags]=process.argv.slice(2);
if(!path)throw Error('usage: gng_coop_tape_check.mjs <tape.json> [--no-video]');
const video=!flags.includes('--no-video'),partial=flags.includes('--partial');
const raw=JSON.parse(readFileSync(path,'utf8')),tape=resolveB3LabTape(path);
const options=gameOptions(raw.coop.options),goalFrame=raw.coop.goalFrame;
assert.equal(options.coop,true,'a cooperative tape');

const manifest=JSON.parse(readFileSync(join(BUNDLE,'manifest.json'),'utf8'));
const code=gngCode(manifest,readFileSync(join(BUNDLE,'code.bin')),
  readFileSync(join(BUNDLE,'overlays.bin')));
const {blocks}=await import(pathToFileURL(join(BUNDLE,'program.mjs')).href);
const gfx=video?gngbGraphics(name=>execFileSync('unzip',['-p',join(ROOT,'roms/gng.zip'),name],
  {maxBuffer:1<<20,stdio:['ignore','pipe','ignore']})):null;

mkdirSync(OUT,{recursive:true,mode:0o700});
const stem=basename(path,'.json'),mp4=join(OUT,stem+'.mp4'),rgba=join(OUT,stem+'.rgba');
const fd=video?openSync(rgba,'w',0o600):null,black=Buffer.alloc(256*224*4);
const match=createMatchTracker(),events=[];
let prev=null,key=null,atGoal=null;
const board=createBoard(code,withGameOptions(blocks,options),{frames:goalFrame,
  dips:optionDips(options),portRead:tape.read,
  onFrame:r=>{
    const b=r.record,i=r.index,s={phase:b[0x72],turn:b[0x27]&1,lives:[b[0x60],b[0x440]],
      cp:b[0x81],mode:b[0x02]};
    if(prev&&i>1200){
      if(s.phase!==prev.phase)events.push({frame:i,type:'phase',from:prev.phase,to:s.phase,
        player:s.turn+1});
      if(s.turn!==prev.turn)events.push({frame:i,type:'turn',player:s.turn+1,
        livesLeft:s.lives[0]});
      if(s.cp!==prev.cp&&s.phase===prev.phase)events.push({frame:i,type:'checkpoint',cp:s.cp,
        player:s.turn+1});
    }
    prev=s;
    const state=observeGameState(r),k=JSON.stringify(state);
    if(state&&k!==key){key=k;for(const e of match.update(state))events.push({frame:i,...e,type:'match-'+e.type});}
    if(i===goalFrame)atGoal={...s,score:observeGameState(r)?.scores};
    if(video)writeSync(fd,rendererUnknownCount(r)===0?renderGngbRgba(rendererInputs(r.record,
      {scroll:r.scroll,latch:r.latch},gfx)).rgba:black);
    board.state.records[i-1]=null;board.state.events.length=0;
  }});
try{
  assert.equal(board.run().status,'FRAMES_DONE');
  const phases=events.filter(e=>e.type==='phase');
  assert.deepEqual(phases.map(e=>[e.from,e.to]),partial?raw.coop.phases.map(p=>[p.to-1,p.to]):
    [[0,1],[1,2]],'phases 1 and 2 completed in order');
  // The explorer looks every 4 frames: it notes the first look after the change.
  phases.forEach((e,i)=>{const f=raw.coop.phases[i].frame;
    assert.ok(e.frame>f-4&&e.frame<=f,'phase '+e.to+' at '+e.frame+', explorer '+f);});
  const turns=events.filter(e=>e.type==='turn');
  // Both players play in every completed phase.
  phases.forEach((e,i)=>{const from=i?phases[i-1].frame:0;
    assert.ok(turns.some(t=>t.frame>from&&t.frame<e.frame),'a turn change in phase '+e.to);});
  assert.equal(atGoal.mode,2,'the game is still on at the goal');
  assert.equal(events.filter(e=>e.type==='match-start').length,1,'a two-player match');
  if(video){
    closeSync(fd);
    execFileSync('ffmpeg',['-nostdin','-hide_banner','-loglevel','error','-y',
      '-f','rawvideo','-pixel_format','rgba','-video_size','256x224','-framerate',FPS,
      '-i',rgba,'-vf','scale=512:448:flags=neighbor','-an','-c:v','libx264',
      '-preset','medium','-crf','18','-pix_fmt','yuv420p','-movflags','+faststart',mp4]);
  }
  const report={schema:'gng.coop-tape-check.v1',tape:basename(path),tapeSha256:tape.sha256,
    bundle:manifest.files['program.mjs'],options,goalFrame,atGoal,events,
    ...video?{video:mp4,seconds:+(goalFrame*F/1500000).toFixed(1)}:{}};
  writeFileSync(join(OUT,stem+'.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify({goalFrame,atGoal,phases,turns:turns.length,video:report.video}));
  console.log('GNG_COOP_TAPE_CHECK PASS');
}finally{if(video)rmSync(rgba,{force:true});}
