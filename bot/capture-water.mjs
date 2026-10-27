#!/usr/bin/env node
/** Two read-only replays of EXISTING tapes to diagnose pre-fall frames.
 * Does not search or optimize candidate policies. Private output only.
 */
import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const ROOT=resolve(fileURLToPath(import.meta.url),'../..');
const cases=[
  ['peak','out/bot/late-sweep/trial-6.json'],
  ['baseline','out/v3/b3/explorer/explorer-g4-2730-1606.json'],
];
const frames=Array.from({length:31},(_,i)=>2500+i*10).join(',');
const dry=process.argv.length===3&&process.argv[2]==='--dry-run';
if(process.argv.length>2&&!dry)throw Error('BOT_WATER_CAPTURE_USAGE');
for(const [label,source] of cases){
  const tape=join(ROOT,source);
  if(!dry&&!existsSync(tape)){
    console.error('BOT_WATER_CAPTURE_MISSING_TAPE='+source);
    process.exitCode=2;
    break;
  }
  const args=[join(ROOT,'bot/replay.mjs'),tape,'2900',frames,'b2-water-'+label];
  if(dry){console.log('BOT_WATER_CAPTURE_PLAN='+JSON.stringify({source,frames:31,
    endFrame:2900,label:'b2-water-'+label}));continue;}
  const run=spawnSync(process.execPath,args,{cwd:ROOT,encoding:'utf8',
    timeout:120000,maxBuffer:1<<20});
  for(const line of (run.stdout||'').split(String.fromCharCode(10)))
    if(line.startsWith('BOT_WITNESS=')||line.startsWith('BOT_WITNESS_FRAMES='))
      console.log(line);
  if(run.status!==0){
    console.error('BOT_WATER_CAPTURE_STOP='+JSON.stringify({source,
      status:run.status,stderr:(run.stderr||'').slice(-600)}));
    process.exitCode=2;break;
  }
  console.log('BOT_WATER_CAPTURE='+label+'_PASS_EXISTING_TAPE_ONLY');
}
