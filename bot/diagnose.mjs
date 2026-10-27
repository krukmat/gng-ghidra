#!/usr/bin/env node
/** Offline report-only B1 audit. Never loads ROMs, engine or screenshot assets. */
import {readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {auditReports,captureFramesAround} from './diagnostics.mjs';

const root=resolve(fileURLToPath(import.meta.url),'../..');
const defaultDirs=['early-sweep','late-sweep','early-tactics','jump-cadence'];
const paths=process.argv.slice(2);
const files=paths.length?paths.map(x=>resolve(x)):
  defaultDirs.map(x=>join(root,'out/bot',x,'report.json'));
let reports;
try{
  reports=files.map(path=>JSON.parse(readFileSync(path,'utf8')));
}catch(error){
  console.error('BOT_DIAGNOSTIC_MISSING_PRIVATE_REPORTS: '+error.message);
  console.error('Usage: node bot/diagnose.mjs [path/to/report.json ...]');
  process.exitCode=2;
}
if(reports){
  try{
    const audit=auditReports(reports);
    const checkpointMatch=audit.total===253&&audit.completed===229&&
      audit.censored===24&&audit.unresolved===0;
    const {examples,...summary}=audit;
    console.log('BOT_B1_AUDIT='+JSON.stringify({...summary,checkpointMatch}));
    const hints=[];
    const peak=examples.peakDoomed;
    if(peak&&peak.firstLifeLossFrame!==null)
      hints.push({kind:'PEAK_LOSS',tape:peak.tape,cut:peak.cut,
        frames:captureFramesAround(peak.firstLifeLossFrame,
          {endFrame:peak.frames??3600})});
    const plateau=examples.plateau;
    if(plateau)
      hints.push({kind:'PLATEAU_CANDIDATE',tape:plateau.tape,cut:plateau.cut,
        frames:[2400,2800,3200,3600].filter(f=>f<=(plateau.frames??3600))});
    for(const h of examples.haltExamples)
      hints.push({kind:'CENSORED_HALT',tape:h.tape,pc:h.pc,cut:h.cut,
        frames:h.frames===null?[]:
          captureFramesAround(Math.max(1,h.frames-30),
            {before:60,after:15,endFrame:h.frames})});
    console.log('BOT_B1_CAPTURE_HINTS='+JSON.stringify(hints));
    console.log('BOT_B1_GATE=STOP_VISUAL_VALIDATION_PENDING');
    if(!checkpointMatch)process.exitCode=2;
  }catch(error){
    console.error('BOT_DIAGNOSTIC_INVALID_REPORT: '+error.message);
    process.exitCode=2;
  }
}
