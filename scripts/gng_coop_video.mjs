#!/usr/bin/env node
/** Private video of the cooperative two-player option (games/gngb/options.mjs)
 * on the shipped program bundle: the two-player game of
 * scripts/gng_coop_check.mjs (P1 follows the true-ending tape past the first
 * checkpoint, then both players walk right until their lives run out), once
 * cooperative and once by turns, rendered like the app. Writes
 * out/gng-coop/video/{coop,turns,side-by-side}.mp4 (cooperative on the left).
 * Needs the ROM-derived bundle (AO_BUNDLE, default out/rp4/build/bundle),
 * roms/gng.zip and ffmpeg.
 * Usage: node scripts/gng_coop_video.mjs [startFrame=3300]
 */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {closeSync,mkdirSync,openSync,readFileSync,rmSync,writeSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {gngCode} from '../boards/gng/bundle.mjs';
import {createBoard} from '../boards/gng/runtime.mjs';
import {defineInputSchedule,readScheduledPort} from '../src/gngb_input_contract.mjs';
import {observeGameState} from '../games/gngb/state.mjs';
import {gameOptions,optionDips,withGameOptions} from '../games/gngb/options.mjs';
import {rendererUnknownCount} from '../src/v2_b1_observable.mjs';
import {renderGngbRgba} from '../src/gngb_frame_renderer.mjs';
import {rendererInputs} from '../src/gngb_render_inputs.mjs';
import {gngbGraphics} from './r35_t5_render_check.mjs';

const ROOT=resolve(fileURLToPath(import.meta.url),'../..');
const BUNDLE=resolve(ROOT,process.env.AO_BUNDLE??'out/rp4/build/bundle');
const TAPE=join(ROOT,'out/h3/loop2/l2-ending-96340.json');
const OUT=join(ROOT,'out/gng-coop/video');
const F=25152,CUT=3600,LIMIT=30000,TAIL=180,FPS=`1500000/${F}`;
const START=Number(process.argv[2]??3300);
const press=(f,control,n)=>[{cycle:f*F,control,pressed:true},
  {cycle:(f+n)*F,control,pressed:false}];

const manifest=JSON.parse(readFileSync(join(BUNDLE,'manifest.json'),'utf8'));
const code=gngCode(manifest,readFileSync(join(BUNDLE,'code.bin')),
  readFileSync(join(BUNDLE,'overlays.bin')));
const {blocks}=await import(pathToFileURL(join(BUNDLE,'program.mjs')).href);
const gfx=gngbGraphics(name=>execFileSync('unzip',['-p',join(ROOT,'roms/gng.zip'),name],
  {maxBuffer:1<<20,stdio:['ignore','pipe','ignore']}));

// The same inputs as scripts/gng_coop_check.mjs.
function matchEvents(){
  const tape=JSON.parse(readFileSync(TAPE,'utf8')).events,held=new Set(),events=[];
  for(const e of tape){
    if(e.cycle>=CUT*F)break;
    events.push(e.control==='start1'?{...e,control:'start2'}:e);
    if(e.pressed)held.add(e.control);else held.delete(e.control);
  }
  for(const control of held)events.push({cycle:CUT*F,control,pressed:false});
  events.push(...press(600,'coin1',12));
  for(let f=CUT+30;f<LIMIT;f+=90)events.push(...press(f,'p1.right',60));
  return events.sort((a,b)=>a.cycle-b.cycle);
}
const schedule=defineInputSchedule(matchEvents());

// Frames from START until TAIL frames after the game returns to the title.
// The board runs synchronously, so the raw frames go to a file first.
function record(name,options){
  const o=gameOptions({...options,continues:false}),mp4=join(OUT,name+'.mp4');
  const raw=join(OUT,name+'.rgba'),fd=openSync(raw,'w',0o600),black=Buffer.alloc(256*224*4);
  let titleAt=null,frames=0;
  const board=createBoard(code,withGameOptions(blocks,o),{frames:LIMIT,
    dips:optionDips(o),portRead:(a,c)=>readScheduledPort(schedule,a,c),
    onFrame:r=>{
      if(titleAt===null&&r.index>CUT&&observeGameState(r)?.mode===1)titleAt=r.index;
      if(r.index>=START&&(titleAt===null||r.index<titleAt+TAIL)){
        writeSync(fd,rendererUnknownCount(r)===0?renderGngbRgba(rendererInputs(r.record,
          {scroll:r.scroll,latch:r.latch},gfx)).rgba:black);
        frames++;
      }
      board.state.records[r.index-1]=null;board.state.events.length=0;
    }});
  try{
    assert.equal(board.run().status,'FRAMES_DONE');
    closeSync(fd);
    assert.ok(titleAt,'the match ends');
    execFileSync('ffmpeg',['-nostdin','-hide_banner','-loglevel','error','-y',
      '-f','rawvideo','-pixel_format','rgba','-video_size','256x224',
      '-framerate',FPS,'-i',raw,'-an','-c:v','libx264','-preset','medium',
      '-crf','16','-pix_fmt','yuv420p','-movflags','+faststart',mp4]);
  }finally{rmSync(raw,{force:true});}
  return {mp4,frames,titleAt};
}

mkdirSync(OUT,{recursive:true,mode:0o700});
const coop=record('coop',{coop:true}),turns=record('turns',{});
const side=join(OUT,'side-by-side.mp4');
execFileSync('ffmpeg',['-nostdin','-hide_banner','-loglevel','error','-y',
  '-i',coop.mp4,'-i',turns.mp4,'-filter_complex',
  '[0:v]scale=512:448:flags=neighbor,tpad=stop_mode=clone:stop_duration=60[a];'+
  '[1:v]scale=512:448:flags=neighbor[b];[a][b]hstack=inputs=2:shortest=1[v]',
  '-map','[v]','-c:v','libx264','-crf','18','-pix_fmt','yuv420p',
  '-movflags','+faststart',side]);
console.log(JSON.stringify({coop,turns,side}));
console.log('GNG_COOP_VIDEO PASS');
