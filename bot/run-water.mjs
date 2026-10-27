#!/usr/bin/env node
/** Bounded pixel-only water crossing episode, normal P1 inputs from reset.
 * The prefix is replayed normally; no snapshots, RAM decisions or continues.
 * Private reports/tapes/images stay under out/bot/.
 */
import {mkdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {B3_TAPE_SCHEMA} from '../src/v3_b3_tapes.mjs';
import {resolveB3LabTape} from '../src/v3_b3_external_tape.mjs';
import {runVisualEpisode} from './visual-episode.mjs';
import {createWaterObservationTracker} from './perception/water-observation.mjs';
import {createWaterSkill} from './policy/water-skill.mjs';

const root=resolve(fileURLToPath(import.meta.url),'../..');
const [source='out/bot/late-sweep/trial-6.json',startArg='2672',endArg='3100']=
  process.argv.slice(2);
const startFrame=Number(startArg),endFrame=Number(endArg);
if(process.argv.length>5||!Number.isSafeInteger(startFrame)||startFrame<1200||
  !Number.isSafeInteger(endFrame)||endFrame<=startFrame||endFrame-startFrame>1800)
  throw Error('BOT_WATER_RUN_USAGE_SOURCE_START_END_MAX_1800');
const sourceTape=resolveB3LabTape(resolve(root,source));
const out=join(root,'out/bot','water-skill-'+new Date().toISOString().replace(/[:.]/g,'-'));
mkdirSync(out,{recursive:true,mode:0o700});
const configuration={flightFrames:38,runSpeedPxPerFrame:1.085,
  takeoffBufferPx:16,runLeadFrames:4,
  // M2.1: far bank edge ~x1784; takeoff x>=1745 lands. 28px keeps >=11px margin.
  hopMaxDistancePx:28};
const tracker=createWaterObservationTracker({bodyBottomToFeetPx:3,
  supportHeightTolerancePx:5,terrainOptions:{minIslandSeparationPx:0},
  inferOccludedIsland:true,roiLeft:96,roiRight:235});
const skill=createWaterSkill(configuration),observations=[],transitions=[],images=[];
let lastPhase=null;
const result=await runVisualEpisode({root,events:sourceTape.events,startFrame,endFrame,
  decide:frame=>{
    const observation=tracker.observe(frame),decision=skill.step(observation);
    const row={frame:frame.frame,phase:decision.phase,action:decision.action,
      reason:decision.reason,support:observation.support,grounded:observation.grounded,
      x:observation.arthur?.x??null,bodyBottom:observation.arthur?.bodyBottom??null,
      bank:observation.terrain?.leftBank?.right??null,
      rightBank:observation.terrain?.rightBank?.left??null,
      island:observation.terrain?.island??null};
    observations.push(row);
    if(lastPhase!==decision.phase){transitions.push(row);lastPhase=decision.phase;
      images.push({frame:frame.frame,rgba:frame.rgba});}
    return decision;
  }});
const tape={schema:B3_TAPE_SCHEMA,profile:'explorer-g4',frames:endFrame,events:result.events};
const tapeHash=createHash('sha256').update(JSON.stringify(tape)).digest('hex');
writeFileSync(join(out,'tape.json'),JSON.stringify({...tape,sha256:tapeHash},null,2)+'\n',
  {mode:0o600});
const landedFrame=result.decisions.find(d=>d.phase==='LANDED')?.frame??null;
const postLandingFrames=landedFrame===null?0:endFrame-landedFrame;
const survived=result.metrics.status==='FRAMES_DONE'&&result.metrics.known&&
  result.metrics.livesLost===0;
// M1 window: the 120 frames from LANDED, all still LANDED in the controller.
// A later STOP is published, not hidden; independent checks stay separate.
const windowRows=landedFrame===null?[]:observations.filter(o=>
  o.frame>=landedFrame&&o.frame<landedFrame+120);
let unsupportedRun=0,maxUnsupportedRun=0;
for(const o of windowRows){
  unsupportedRun=o.support==='ISLAND'&&o.grounded===true?0:unsupportedRun+1;
  maxUnsupportedRun=Math.max(maxUnsupportedRun,unsupportedRun);
}
const boardingWindow=landedFrame===null?null:{fromFrame:landedFrame,
  toFrame:landedFrame+119,frames:windowRows.length,
  landedFrames:windowRows.filter(o=>o.phase==='LANDED').length,
  supportFrames:windowRows.filter(o=>o.support==='ISLAND'&&o.grounded===true).length,
  maxUnsupportedRun};
const firstPlatformObserved=survived&&boardingWindow?.frames===120&&
  boardingWindow.landedFrames===120;
// M2 window: the 120 frames from ASHORE, all ASHORE, advancing while on land.
const ashoreFrame=result.decisions.find(d=>d.phase==='ASHORE')?.frame??null;
const shoreRows=ashoreFrame===null?[]:observations.filter(o=>
  o.frame>=ashoreFrame&&o.frame<ashoreFrame+120);
const shoreWindow=ashoreFrame===null?null:{fromFrame:ashoreFrame,
  toFrame:ashoreFrame+119,frames:shoreRows.length,
  ashoreFrames:shoreRows.filter(o=>o.phase==='ASHORE').length,
  supportFrames:shoreRows.filter(o=>['RIGHT_BANK','BANK'].includes(o.support)&&
    o.grounded===true).length,
  advanceFrames:shoreRows.filter(o=>o.action==='right').length};
const crossingObserved=survived&&shoreWindow?.frames===120&&
  shoreWindow.ashoreFrames===120&&shoreWindow.advanceFrames>0;
const firstStop=result.decisions.find(d=>d.phase==='STOP');
const report={source,sourceTapeHash:sourceTape.sha256,bundleHash:result.bundleHash,
  configuration,startFrame,endFrame,metrics:result.metrics,tapeHash,
  outcome:crossingObserved?'CROSSING_OBSERVED_AND_SURVIVED':
    firstPlatformObserved?'FIRST_PLATFORM_OBSERVED_AND_SURVIVED':'NOT_CONFIRMED',
  landedFrame,postLandingFrames,boardingWindow,ashoreFrame,shoreWindow,
  stop:firstStop?{frame:firstStop.frame,reason:firstStop.reason}:null,
  stageClear:'UNVERIFIED',bossDefeated:'UNKNOWN',
  firstPlatformObserved,crossingObserved,independentlyVerified:false,transitions,observations};
writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
for(const image of images)spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-y',
  '-f','rawvideo','-pixel_format','rgba','-video_size','256x224','-i','pipe:0',
  '-frames:v','1',join(out,'phase-'+image.frame+'.png')],
  {input:Buffer.from(image.rgba),stdio:['pipe','ignore','pipe']});
const {checkpoints,...metrics}=result.metrics;
console.log('BOT_WATER_REPORT='+join(out,'report.json'));
console.log('BOT_WATER_RESULT='+JSON.stringify({outcome:report.outcome,landedFrame,
  postLandingFrames,boardingWindow,ashoreFrame,shoreWindow,stop:report.stop,metrics,
  transitions}));
if(result.metrics.status!=='FRAMES_DONE')process.exitCode=2;
