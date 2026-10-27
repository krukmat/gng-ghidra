#!/usr/bin/env node
/** Read-only visual audit of private 4-column replay contact sheets.
 * Does NOT load engine/ROM, modify game state, or certify boss/landing.
 * Usage: node bot/analyze-water-captures.mjs path/frames.png [name] [start=2500] [step=10] [count=31]
 */
import {readFileSync} from 'node:fs';
import {readReplayContactPng,replayContactFrame}
  from './perception/png-contact.mjs';
import {detectWaterTerrain,createIslandVelocityTracker}
  from './perception/terrain-water.mjs';
import {detectArthurSkin} from './perception/arthur-skin.mjs';
const [source,session='replay',firstArg='2500',stepArg='10',countArg='31']=
  process.argv.slice(2);
const first=Number(firstArg),step=Number(stepArg),count=Number(countArg);
if(!source||!Number.isSafeInteger(first)||first<0||
  !Number.isSafeInteger(step)||step<1||
  !Number.isSafeInteger(count)||count<1||count>100)
  throw Error('BOT_WATER_AUDIT_USAGE');
const png=readReplayContactPng(readFileSync(source));
const tracker=createIslandVelocityTracker();
const observations=[];
for(let i=0;i<count;i++){
  const frame=first+i*step,visual=replayContactFrame(png,i);
  const terrain=detectWaterTerrain(visual),arthur=detectArthurSkin({...visual,roiLeft:96,roiRight:165});
  const motion=tracker.observe({frame,session,terrain});
  observations.push({frame,
    bankX:terrain.leftBank?.right??null,
    islandLeft:terrain.island?.left??null,
    islandRight:terrain.island?.right??null,
    arthurX:arthur.kind==='ARTHUR_SKIN_CANDIDATE'?arthur.x:null,
    arthurVisible:arthur.kind==='ARTHUR_SKIN_CANDIDATE',
    islandVelocity:motion.status==='MOTION_CANDIDATE'?motion.velocity:null,
    motionStatus:motion.status,
    landing:'UNKNOWN',bossDefeated:'UNKNOWN',rightBank:'UNKNOWN'});
}
const speeds=observations.filter(o=>o.islandVelocity!==null)
  .map(o=>o.islandVelocity).sort((a,b)=>a-b);
const median=speeds.length?speeds[Math.floor(speeds.length/2)]:null;
console.log('BOT_WATER_OBSERVATIONS='+JSON.stringify(observations));
console.log('BOT_WATER_CALIBRATION='+JSON.stringify({session,
  availableSamples:speeds.length,medianRelativeIslandSpeed:median,
  calibrated:false,landing:'UNKNOWN',bossKill:'UNKNOWN',
  stage:'READ_ONLY_VISUAL_DIAGNOSTIC'}));
