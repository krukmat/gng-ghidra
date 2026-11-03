#!/usr/bin/env node
/** Replay a B3 tape into the same 256x224 pixels as the Android app.
 * Usage: node scripts/h3_video.mjs check <tape.json> [frame=320]
 *        node scripts/h3_video.mjs export <tape.json> [endFrame=tape.frames] [startFrame=1]
 * Private MP4 and per-frame metrics go to out/h3/video/.
 */
import {spawn,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {once} from 'node:events';
import {chmodSync,existsSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {basename,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {loadFrozen} from '../src/v2_b1_frozen.mjs';
import {selectB3Bundle} from '../src/v3_b3_bundle.mjs';
import {labCreateBoard} from '../src/v3_b3_lab_board.mjs';
import {resolveB3LabTape} from '../src/v3_b3_external_tape.mjs';
import {rendererUnknownCount} from '../src/v2_b1_observable.mjs';
import {renderGngbRgba} from '../src/gngb_frame_renderer.mjs';
import {rendererInputs} from '../src/gngb_render_inputs.mjs';
import {CYCLES_PER_FRAME} from '../src/gngb_runtime.mjs';
import {gngbGraphics} from './r35_t5_render_check.mjs';
import {look,observeGameState} from '../games/gngb/state.mjs';
import {phase6Sample} from '../src/h3_phase_contract.mjs';

const ROOT=resolve(fileURLToPath(import.meta.url),'../..');
const OUT=join(ROOT,'out/h3/video');
const FPS=`1500000/${CYCLES_PER_FRAME}`;
const FRAME_BYTES=256*224*4;
const sha256=b=>createHash('sha256').update(b).digest('hex');
const fail=m=>{throw Error('H3_VIDEO_'+m);};

async function main(){
  const [cmd,path,limit,first]=process.argv.slice(2);
  if(!['check','export'].includes(cmd)||!path)fail('USAGE');
  const tape=resolveB3LabTape(path);
  const end=limit===undefined?(cmd==='check'?320:tape.frames):Number(limit);
  if(!Number.isSafeInteger(end)||end<1||end>tape.frames)fail('FRAME_INVALID');
  const start=first===undefined?1:Number(first);
  if(!Number.isSafeInteger(start)||start<1||start>end||cmd==='check'&&first!==undefined)
    fail('START_FRAME_INVALID');
  const selected=selectB3Bundle(ROOT);
  if(!selected)fail('NO_CERTIFIED_BUNDLE');
  const {manifest,code}=loadFrozen(selected.dir);
  const {blocks}=await import(pathToFileURL(join(selected.dir,'program.mjs')).href);
  const gfx=gngbGraphics(name=>execFileSync('unzip',['-p',join(ROOT,'roms/gng.zip'),name],
    {maxBuffer:1<<20,stdio:['ignore','pipe','ignore']}));
  const raw=existsSync(path)?JSON.parse(readFileSync(path,'utf8')):null;
  const expected=raw?.h3?.goalFrame===end?raw.h3.ramSha:null;
  let appRender=null,appInputs=null;
  if(cmd==='check'){
    const app=join(ROOT,'out/android/assets/lib');
    if(!existsSync(join(app,'gngb_frame_renderer.mjs')))fail('APP_ASSETS_MISSING');
    ({renderGngbRgba:appRender}=await import(pathToFileURL(join(app,'gngb_frame_renderer.mjs')).href));
    ({rendererInputs:appInputs}=await import(pathToFileURL(join(app,'gngb_render_inputs.mjs')).href));
  }
  const rows=[],events=[],summary={maxX:null,maxScroll:null,minLives:null,
    firstDrawableFrame:null,firstGameplayFrame:null};
  let previous=null,frames=[],checkHash=null;
  const fields=['phase','lives','stage','cp','armor'];
  const board=await labCreateBoard(join(selected.dir,'gngb_runtime.mjs'),
    manifest.files['gngb_runtime.mjs'],code,blocks,{frames:1,portRead:tape.read,
      onFrame:f=>{
        const index=board.state.records.length;
        const drawable=rendererUnknownCount(f)===0;
        const game=observeGameState(f),active=drawable&&game?.inGame===true;
        const state=active?{...look(f.record),stage:f.record[0x52]}:null;
        const row={frame:index,inGame:active,
          x:state?.x??null,y:state?.y??null,scroll:state?.scroll??null,
          lives:state?.lives??null,phase:state?.phase??null,
          stage:state?.stage??null,cp:state?.cp??null,
          armor:state?.armor??null,mode:state?.mode??null,ram:phase6Sample(index,f.record)};
        if(index<start){
          board.state.records[index-1]=null;
          board.state.events.length=0;
          return;
        }
        rows.push(row);
        if(active){
          summary.firstGameplayFrame??=index;
          summary.maxX=Math.max(summary.maxX??row.x,row.x);
          summary.maxScroll=Math.max(summary.maxScroll??row.scroll,row.scroll);
          if(summary.minLives!==null||row.lives>0)
            summary.minLives=summary.minLives===null?row.lives:Math.min(summary.minLives,row.lives);
        }
        if(previous?.inGame!==active)
          events.push({frame:index,type:'inGame',from:previous?.inGame??null,to:active});
        for(const field of fields)if(row[field]!==null&&row[field]!==previous?.[field])
          events.push({frame:index,type:field,from:previous?.[field]??null,to:row[field]});
        previous=row;
        if(drawable&&summary.firstDrawableFrame===null)summary.firstDrawableFrame=index;
        if(cmd==='check'){
          if(index===end){
            if(!drawable)fail('CHECK_FRAME_NOT_DRAWABLE');
            const inputs=rendererInputs(f.record,{scroll:f.scroll,latch:f.latch},gfx);
            const pixels=Buffer.from(renderGngbRgba(inputs).rgba);
            const appPixels=Buffer.from(appRender(appInputs(f.record,
              {scroll:f.scroll,latch:f.latch},gfx)).rgba);
            if(!pixels.equals(appPixels))fail('APP_PIXEL_MISMATCH');
            checkHash=sha256(pixels);
          }
        }else{
          // The app leaves the canvas black until the first fully known frame.
          const pixels=drawable?renderGngbRgba(rendererInputs(f.record,
            {scroll:f.scroll,latch:f.latch},gfx)).rgba:new Uint8Array(FRAME_BYTES);
          frames.push(Buffer.from(pixels));
        }
        board.state.records[index-1]=null;
        board.state.events.length=0;
      }});

  const advance=n=>{
    const result=board.lab.advanceTo(n);
    if(result.status!=='FRAMES_DONE')fail('REPLAY_'+result.status+'_FRAME_'+n);
  };
  if(cmd==='check'){
    advance(end);
    if(!checkHash)fail('APP_CHECK_REPLAY_FAILED');
    console.log('H3_VIDEO_CHECK=PASS frame='+end+' rgba_sha256='+checkHash);
    return;
  }

  mkdirSync(OUT,{recursive:true,mode:0o700});
  const stem=basename(path,'.json').replace(/[^a-zA-Z0-9_-]/g,'_')+'-'+tape.sha256.slice(0,8)+
    (start===1?'':'-'+start)+'-'+end;
  const mp4=join(OUT,stem+'.mp4'),json=join(OUT,stem+'.json');
  const ff=spawn('ffmpeg',['-nostdin','-hide_banner','-loglevel','error','-y',
    '-f','rawvideo','-pixel_format','rgba','-video_size','256x224',
    '-framerate',FPS,'-i','pipe:0','-an','-c:v','libx264','-preset','medium',
    '-crf','14','-pix_fmt','yuv420p','-movflags','+faststart',mp4],
  {stdio:['pipe','ignore','pipe']});
  let ffError='';
  ff.stderr.setEncoding('utf8');
  ff.stderr.on('data',chunk=>{ffError=(ffError+chunk).slice(-3000);});
  try{
    for(let n=Math.min(60,end);n<=end;n=Math.min(n+60,end)){
      advance(n);
      for(const pixels of frames){
        if(!ff.stdin.write(pixels))await once(ff.stdin,'drain');
      }
      frames=[];
      if(n===end)break;
    }
    const ram=board.state.ramBytes(0,0x3000).bytes;
    const actual=sha256(ram);
    if(expected&&actual!==expected)fail('RAM_MISMATCH');
    ff.stdin.end();
    const [code]=await once(ff,'close');
    if(code!==0)fail('FFMPEG_'+code+'_'+ffError.trim());
    chmodSync(mp4,0o600);
    const report={schema:'gng.h3.video-metrics.v1',tape:{file:basename(path),
      sha256:tape.sha256,profile:tape.profile},bundle:selected.generation,
      frames:end-start+1,startFrame:start,endFrame:end,fps:FPS,video:basename(mp4),
      videoSha256:sha256(readFileSync(mp4)),
      ramSha256:actual,ramVerified:!!expected,summary,events,rows};
    writeFileSync(json,JSON.stringify(report,null,2)+'\n',{mode:0o600});
    console.log('H3_VIDEO=PASS frames='+(end-start+1)+' start='+start+' end='+end+
      ' drawable_from='+summary.firstDrawableFrame+
      ' events='+events.length+' mp4='+mp4+' metrics='+json);
  }catch(e){
    ff.kill();rmSync(mp4,{force:true});rmSync(json,{force:true});throw e;
  }
}

main().catch(e=>{console.error(e.message);process.exitCode=2;});
