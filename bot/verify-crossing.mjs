#!/usr/bin/env node
/** Independent read-only check of a run-water far-bank (M2) window.
 * Replays the private tape from reset through the offline evaluator, never
 * the policy or pixel observer. RAM labels are evaluation-only: shore height,
 * world x beyond the water, monotonic advance, no life lost, complete window.
 * Usage: node bot/verify-crossing.mjs out/bot/water-skill-.../report.json
 *   [shoreY=62] [farBankWorldX=1784] [minAdvance=60]
 */
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {renderGngbRgba} from '../src/gngb_frame_renderer.mjs';
import {rendererUnknownCount} from '../src/v2_b1_observable.mjs';
import {gngbGraphics,rendererInputs} from '../scripts/r35_t5_render_check.mjs';
import {loadEngine} from './engine-evaluation.mjs';

const ROOT=resolve(fileURLToPath(import.meta.url),'../..');
const [reportPath,shoreYArg='62',farBankArg='1784',minAdvanceArg='60']=
  process.argv.slice(2);
const shoreY=Number(shoreYArg),farBank=Number(farBankArg),minAdvance=Number(minAdvanceArg);
if(!reportPath||process.argv.length>6||![shoreY,farBank,minAdvance].every(Number.isFinite)||
  minAdvance<=0)throw Error('BOT_VERIFY_CROSSING_USAGE_REPORT_Y_BANK_ADVANCE');
const dir=dirname(resolve(reportPath));
const report=JSON.parse(readFileSync(resolve(reportPath),'utf8'));
const {sha256,...tape}=JSON.parse(readFileSync(join(dir,'tape.json'),'utf8'));
const tapeHash=createHash('sha256').update(JSON.stringify(tape)).digest('hex');
const window=report.shoreWindow;
if(!window)throw Error('BOT_VERIFY_CROSSING_NO_WINDOW');
const frames=[];
for(let f=window.fromFrame;f<=window.toFrame;f++)frames.push(f);
// The sheet also shows the hop that precedes the window.
const sheetFrames=[];
for(let f=window.fromFrame-40;f<=window.toFrame;f+=10)sheetFrames.push(f);
const engine=await loadEngine(ROOT);
const result=engine.run(tape.events,{startFrame:report.startFrame,
  endFrame:report.endFrame,captureFrames:[...frames,...sheetFrames]});
const labels=frames.filter(f=>result.captures.has(f)).map(frame=>{
  const r=result.captures.get(frame),b=r.record;
  return {frame,known:[0xa0,0xa1,0xa2,0xa3,0x60].every(a=>r.known[a]===255),
    world:b[0xa0]*256+b[0xa1],y:b[0xa2]*256+b[0xa3],lives:b[0x60]};
});
const worlds=labels.map(l=>l.world);
const checks={
  tapeHash:tapeHash===report.tapeHash&&tapeHash===sha256,
  bundleHash:engine.bundleHash===report.bundleHash,
  sameEnd:result.metrics.status===report.metrics.status&&
    result.metrics.frames===report.metrics.frames&&
    result.metrics.lastRecordHash===report.metrics.lastRecordHash,
  framesDone:result.metrics.status==='FRAMES_DONE',
  noLifeLost:result.metrics.known===true&&result.metrics.livesLost===0,
  windowComplete:labels.length===120,
  labelsKnown:labels.length>0&&labels.every(l=>l.known),
  shoreHeight:labels.length>0&&labels.every(l=>l.y===shoreY),
  beyondWater:labels.length>0&&Math.min(...worlds)>=farBank,
  advanced:labels.length>0&&worlds.every((w,i)=>i===0||w>=worlds[i-1])&&
    worlds.at(-1)-worlds[0]>=minAdvance,
};
const verified=Object.values(checks).every(Boolean);
const gfx=gngbGraphics(n=>execFileSync('unzip',['-p',join(ROOT,'roms/gng.zip'),n],
  {maxBuffer:1<<20,stdio:['ignore','pipe','ignore']}));
const sheet=sheetFrames.filter(f=>result.captures.has(f));
const rgba=Buffer.concat(sheet.map(frame=>{
  const r=result.captures.get(frame);
  if(rendererUnknownCount(r))throw Error('BOT_VERIFY_CROSSING_UNKNOWN_PIXELS_'+frame);
  return Buffer.from(renderGngbRgba(rendererInputs(r.record,
    {scroll:r.scroll,latch:r.latch},gfx)).rgba);
}));
spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','rawvideo',
  '-pixel_format','rgba','-video_size','256x224','-i','pipe:0','-vf',
  'tile=4x'+Math.ceil(sheet.length/4),'-frames:v','1',join(dir,'verify-crossing.png')],
  {input:rgba,stdio:['pipe','ignore','pipe']});
const span=values=>values.length?{min:Math.min(...values),max:Math.max(...values)}:null;
const out={report:resolve(reportPath),window,thresholds:{shoreY,farBank,minAdvance},
  checks,verified,labeledFrames:labels.length,height:span(labels.map(l=>l.y)),
  world:span(worlds),replay:{...result.metrics,checkpoints:undefined},sheetFrames:sheet,
  labels};
writeFileSync(join(dir,'verify-crossing.json'),JSON.stringify(out,null,2)+'\n',
  {mode:0o600});
console.log('BOT_VERIFY_CROSSING='+JSON.stringify({verified,checks,
  labeledFrames:labels.length,height:out.height,world:out.world,
  replay:{status:result.metrics.status,frames:result.metrics.frames,pc:result.metrics.pc},
  sheet:join(dir,'verify-crossing.png')}));
if(!verified)process.exitCode=1;
