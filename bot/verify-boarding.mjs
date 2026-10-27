#!/usr/bin/env node
/** Independent read-only check of a run-water boarding window.
 * Replays the private tape from reset through the offline evaluator, never
 * the policy or pixel observer. RAM labels are evaluation-only: constant
 * height, no life lost and horizontal transport while no direction is held.
 * Usage: node bot/verify-boarding.mjs out/bot/water-skill-.../report.json
 */
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {CYCLES_PER_FRAME} from '../src/gngb_runtime.mjs';
import {renderGngbRgba} from '../src/gngb_frame_renderer.mjs';
import {rendererUnknownCount} from '../src/v2_b1_observable.mjs';
import {gngbGraphics,rendererInputs} from '../scripts/r35_t5_render_check.mjs';
import {loadEngine} from './engine-evaluation.mjs';

const ROOT=resolve(fileURLToPath(import.meta.url),'../..');
const [reportPath,maxHeightSpreadArg='2',minTransportArg='4']=process.argv.slice(2);
const maxHeightSpread=Number(maxHeightSpreadArg),minTransport=Number(minTransportArg);
if(!reportPath||process.argv.length>5||!Number.isFinite(maxHeightSpread)||
  maxHeightSpread<0||!Number.isFinite(minTransport)||minTransport<=0)
  throw Error('BOT_VERIFY_BOARDING_USAGE_REPORT_SPREAD_TRANSPORT');
const dir=dirname(resolve(reportPath));
const report=JSON.parse(readFileSync(resolve(reportPath),'utf8'));
const {sha256,...tape}=JSON.parse(readFileSync(join(dir,'tape.json'),'utf8'));
const tapeHash=createHash('sha256').update(JSON.stringify(tape)).digest('hex');
const window=report.boardingWindow;
if(!window)throw Error('BOT_VERIFY_BOARDING_NO_WINDOW');
const frames=[];
for(let f=window.fromFrame;f<=window.toFrame;f++)frames.push(f);
const engine=await loadEngine(ROOT);
const result=engine.run(tape.events,{startFrame:report.startFrame,
  endFrame:report.endFrame,captureFrames:frames});
const labels=frames.map(frame=>{
  const r=result.captures.get(frame),b=r.record;
  return {frame,known:[0xa0,0xa1,0xa2,0xa3,0x60].every(a=>r.known[a]===255),
    world:b[0xa0]*256+b[0xa1],y:b[0xa2]*256+b[0xa3],lives:b[0x60]};
});
const directions=new Set(['p1.right','p1.left']),held=new Set();
let directionHeld=false;
for(const event of tape.events){
  if(event.cycle>=(window.toFrame+1)*CYCLES_PER_FRAME)break;
  if(event.cycle>=window.fromFrame*CYCLES_PER_FRAME&&directions.has(event.control)&&
    event.pressed)directionHeld=true;
  if(event.pressed)held.add(event.control);else held.delete(event.control);
  if(event.cycle<=window.fromFrame*CYCLES_PER_FRAME)
    directionHeld=[...directions].some(c=>held.has(c));
}
const ys=labels.map(l=>l.y),worlds=labels.map(l=>l.world);
const checks={
  tapeHash:tapeHash===report.tapeHash&&tapeHash===sha256,
  bundleHash:engine.bundleHash===report.bundleHash,
  framesDone:result.metrics.status==='FRAMES_DONE',
  sameFinalRecord:result.metrics.lastRecordHash===report.metrics.lastRecordHash,
  noLifeLost:result.metrics.known===true&&result.metrics.livesLost===0,
  labelsKnown:labels.every(l=>l.known),
  constantHeight:Math.max(...ys)-Math.min(...ys)<=maxHeightSpread,
  noDirectionHeld:!directionHeld,
  transported:Math.max(...worlds)-Math.min(...worlds)>=minTransport,
};
const verified=Object.values(checks).every(Boolean);
// Visual evidence for a human reader: every 10th window frame, 4 columns.
const gfx=gngbGraphics(n=>execFileSync('unzip',['-p',join(ROOT,'roms/gng.zip'),n],
  {maxBuffer:1<<20,stdio:['ignore','pipe','ignore']}));
const sheet=frames.filter((_,i)=>i%10===0);
const rgba=Buffer.concat(sheet.map(frame=>{
  const r=result.captures.get(frame);
  if(rendererUnknownCount(r))throw Error('BOT_VERIFY_BOARDING_UNKNOWN_PIXELS_'+frame);
  return Buffer.from(renderGngbRgba(rendererInputs(r.record,
    {scroll:r.scroll,latch:r.latch},gfx)).rgba);
}));
spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','rawvideo',
  '-pixel_format','rgba','-video_size','256x224','-i','pipe:0','-vf',
  'tile=4x'+Math.ceil(sheet.length/4),'-frames:v','1',join(dir,'verify-window.png')],
  {input:rgba,stdio:['pipe','ignore','pipe']});
const out={report:resolve(reportPath),window,thresholds:{maxHeightSpread,minTransport},
  checks,verified,height:{min:Math.min(...ys),max:Math.max(...ys)},
  world:{min:Math.min(...worlds),max:Math.max(...worlds)},
  replay:{...result.metrics,checkpoints:undefined},sheetFrames:sheet,labels};
writeFileSync(join(dir,'verify-boarding.json'),JSON.stringify(out,null,2)+'\n',
  {mode:0o600});
console.log('BOT_VERIFY_BOARDING='+JSON.stringify({verified,checks,height:out.height,
  world:out.world,sheet:join(dir,'verify-window.png')}));
if(!verified)process.exitCode=1;
