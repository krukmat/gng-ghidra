#!/usr/bin/env node
/** Bounded, deterministic port-tape search against the implemented engine. */
import {createHash} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {resolveB3LabTape} from '../src/v3_b3_external_tape.mjs';
import {B3_TAPE_SCHEMA} from '../src/v3_b3_tapes.mjs';
import {loadEngine} from './engine-evaluation.mjs';
import {suffixEvents} from './actions.mjs';
import {compareEvaluations} from './evaluation.mjs';

const ROOT=resolve(fileURLToPath(import.meta.url),'../..');
const [source,cutsArg='1920,2100,2280,2340',endArg='3600',mode='sweep',limitArg='120',label=mode]
  =process.argv.slice(2);
const cuts=cutsArg.split(',').map(Number),endFrame=Number(endArg),limit=Number(limitArg);
if(!source||cuts.some(n=>!Number.isSafeInteger(n)||n<1200||n>=endFrame)||
   !Number.isSafeInteger(endFrame)||endFrame>18000||
   !Number.isSafeInteger(limit)||limit<1||limit>2000||
   !['sweep','tactics','cadence','random','evaluate'].includes(mode)||!/^[-\w]+$/.test(label))
  throw Error('BOT_SEARCH_USAGE');
const seed=resolveB3LabTape(source),engine=await loadEngine(ROOT);
const out=join(ROOT,'out/bot',label);
mkdirSync(out,{recursive:true,mode:0o700});
const metricsStart=Math.min(...cuts),entries=[];
const baseline=engine.run(seed.events,{startFrame:metricsStart,endFrame}).metrics;
console.log('BOT_BASELINE='+JSON.stringify(baseline));
const actions=['right','right_fire','right_jump','right_fire_jump','stand_fire',
  'stand_fire_jump','down_fire','left_fire','left_fire_jump','neutral'];
let state=0x6d2b79f5;
const random=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return (state>>>0)/2**32;};
const pick=items=>items[Math.floor(random()*items.length)];
const plans=[];
for(const cut of cuts){
  if(mode==='sweep'){
    for(const action of actions)for(const jumpPeriod of action.includes('jump')?[32,44,56]:[44])
      plans.push({cut,segments:[{duration:endFrame-cut,action,jumpPeriod}]});
  }else if(mode==='tactics'){
    for(const action of ['stand_fire','down_fire','left_fire','left_fire_jump','stand_fire_jump','neutral'])
      for(const duration of [24,60,120,240])
        plans.push({cut,segments:[{duration,action},
          {duration:endFrame-cut-duration,action:'right_fire_jump',jumpPeriod:44}]});
  }else if(mode==='cadence'){
    for(const jumpPeriod of [38,44,52])for(const firePeriod of [24,36,48,60])
      for(const firePhase of [0,8,18,28])
        plans.push({cut,segments:[{duration:endFrame-cut,action:'right_fire_jump',
          jumpPeriod,jumpPhase:0,firePeriod,firePhase}]});
  }
}
if(mode==='random')for(let i=0;i<limit;i++){
  const cut=pick(cuts),segments=[];let remaining=endFrame-cut;
  while(remaining>0){
    const duration=Math.min(remaining,pick([20,30,45,60,90,120,180]));
    segments.push({duration,action:pick(['right_fire','right_fire','right_fire_jump',
      'right_fire_jump','right_jump','stand_fire','down_fire','left_fire','stand_fire_jump']),
      jumpPeriod:pick([30,38,44,52,60]),jumpPhase:pick([0,1,5,10,20]),
      firePeriod:pick([12,24,36,48,60]),firePhase:pick([0,8,18])});
    remaining-=duration;
  }
  plans.push({cut,segments});
}
const tape=(events,frames)=>{
  const metadata={schema:B3_TAPE_SCHEMA,profile:'explorer-g4',frames,events};
  return {...metadata,sha256:createHash('sha256').update(JSON.stringify(metadata)).digest('hex')};
};
let best=null;
for(const [index,plan] of plans.slice(0,limit).entries()){
  const events=suffixEvents(seed.events,plan.cut,plan.segments,endFrame);
  const metrics=engine.run(events,{startFrame:metricsStart,endFrame}).metrics;
  const entry={id:index,plan,metrics,tape:join(out,'trial-'+index+'.json')};
  writeFileSync(entry.tape,JSON.stringify(tape(events,endFrame),null,2)+'\n',{mode:0o600});
  entries.push(entry);
  if(!best||compareEvaluations(metrics,best.metrics)<0){
    best=entry;
    console.log('BOT_BEST_CANDIDATE='+JSON.stringify({id:index,cut:plan.cut,world:metrics.finalWorld,
      max:metrics.maxWorld,lost:metrics.livesLost,survival:metrics.survivalFrames,
      status:metrics.status}));
  }
  if((index+1)%20===0)console.log('BOT_TRIALS='+String(index+1)+'/'+Math.min(limit,plans.length));
  // STOP this branch at missing AOT; independent port-only trials may continue.
  // Keep its exact tape and result, without expanding or repairing the engine.
  if(metrics.status!=='FRAMES_DONE'){
    console.log('BOT_BRANCH_STOP_ENGINE='+JSON.stringify({id:index,status:metrics.status,
      frames:metrics.frames,pc:metrics.pc,bank:metrics.bank}));
  }
}
entries.sort((a,b)=>compareEvaluations(a.metrics,b.metrics));
const report={source,mode,endFrame,cuts,bundleHash:engine.bundleHash,generation:engine.generation,
  baseline,trials:entries.length,entries,
  bestRanksAboveBaseline:best?compareEvaluations(best.metrics,baseline)<0:false,
  stageClear:'UNVERIFIED'};
writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
console.log('BOT_REPORT='+join(out,'report.json'));
console.log('BOT_TOP='+JSON.stringify(entries.slice(0,8).map(e=>({id:e.id,tape:e.tape,
  world:e.metrics.finalWorld,max:e.metrics.maxWorld,lost:e.metrics.livesLost,
  survival:e.metrics.survivalFrames,status:e.metrics.status}))));
console.log('BOT_STAGE_CLEAR=UNVERIFIED');
