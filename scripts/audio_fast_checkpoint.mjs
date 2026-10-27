#!/usr/bin/env node
/**
 * G5-FAST B0+B1 operator checkpoint. Run: node scripts/audio_fast_checkpoint.mjs
 * No network, no CI/GitHub Actions, no ROM uploads, no game engine edits.
 * Reports only allowlisted metadata. Z80 PARTIAL is EXPECTED and not a gate GO.
 */
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';

const tests=[
  'tests/test_gngb_z80_static_codegen.mjs',
  'tests/test_gngb_audio_frontier_report.mjs',
  'tests/test_gngb_audio_events.mjs',
  'tests/test_gngb_z80_sound_bus.mjs',
  'tests/test_gngb_audio_pcm_queue.mjs'
];
function invoke(cmd,args){
  const r=spawnSync(cmd,args,{
    cwd:process.cwd(),encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024,
    env:{...process.env}
  });
  return {exit_code:typeof r.status==='number'?r.status:2,
    stdout:r.stdout||'',stderr:r.stderr||''};
}
function extractTestCounts(stdout,stderr,python=false) {
  const t=stdout+'\n'+stderr;
  if(python){
    const ran=t.match(/Ran (\d+) tests?/);
    const fail=t.match(/FAILED \(([^)]*)\)/);
    return {ran:ran?Number(ran[1]):null,ok:/\nOK(?:\n|$)/.test(t),
      failed:!!fail};
  }
  const get=key=>{
    const m=t.match(new RegExp('(?:^|\\n)(?:#|ℹ)\\s+'+key+'\\s+(\\d+)','m'));
    return m?Number(m[1]):null;
  };
  return {ran:get('tests'),passed:get('pass'),failed:get('fail')};
}
function parseSafeJson(s) {
  const line=s.trim().split('\n').at(-1);
  try{return JSON.parse(line)}catch{return null}
}
function privateArtifactsGuard() {
  // The only generated code, extracted ROM, and audio analysis must stay ignored.
  const ignore=fs.readFileSync('.gitignore','utf8');
  if(!/(?:^|\n)out\/(?:\r?\n|$)/.test(ignore))
    return false;
  const tracked=invoke('git',['ls-files','--','out']);
  return tracked.exit_code===0 && tracked.stdout.trim()==='';
}
function run() {
  const rootsIndex=process.argv.indexOf('--roots');
  if(process.argv.length!==2 && !(process.argv.length===4 && rootsIndex===2)) {
    console.log(JSON.stringify({kind:'GNG_AUDIO_G5_FAST_CHECKPOINT_V1',
      status:'STOP_BAD_ARGUMENTS'}));
    return 2;
  }
  const node=invoke(process.execPath,['--test',...tests]);
  const nodeCounts=extractTestCounts(node.stdout,node.stderr);
  const python=invoke('python3',['-m','unittest','discover','-s','tests',
    '-p','test_audio_*.py','-v']);
  const pyCounts=extractTestCounts(python.stdout,python.stderr,true);
  const basic=node.exit_code===0 && python.exit_code===0 &&
    nodeCounts.ran!==null&&nodeCounts.failed===0&&
    pyCounts.ran!==null&&pyCounts.ok;
  const artifactsSafe=privateArtifactsGuard();
  if(!basic || !artifactsSafe){
    console.log(JSON.stringify({kind:'GNG_AUDIO_G5_FAST_CHECKPOINT_V1',
      status:artifactsSafe?'STOP_REGRESSION':'STOP_PRIVATE_ARTIFACT_GUARD',
      node:{exit_code:node.exit_code,...nodeCounts},
      python:{exit_code:python.exit_code,...pyCounts},
      rom_checked:false,private_artifacts_safe:artifactsSafe}));
    return 2;
  }
  const scanArgs=['scripts/audio_z80_scan.mjs'];
  if(rootsIndex===2)scanArgs.push('--roots',process.argv[3]);
  const scan=invoke(process.execPath,scanArgs);
  const scanOut=parseSafeJson(scan.stdout);
  const discovered=scanOut?.kind==='GNG_AUDIO_Z80_FRONTIER_SCAN_V1' &&
    scanOut?.rom_identity==='SHA1_MATCH' &&
    ['PARTIAL_UNCERTIFIED','TRUNCATED','NO_STATIC_BLOCKER_NOT_CERTIFIED']
      .includes(scanOut?.status);
  if(!discovered){
    console.log(JSON.stringify({kind:'GNG_AUDIO_G5_FAST_CHECKPOINT_V1',
      status:'STOP_ROM_OR_SCAN',
      node:{exit_code:node.exit_code,...nodeCounts},
      python:{exit_code:python.exit_code,...pyCounts},
      rom_checked:false,
      z80_scan_status:'STOP'}));
    return 2;
  }
  const build=invoke(process.execPath,['scripts/audio_z80_build.mjs']);
  const built=parseSafeJson(build.stdout);
  const compileCheck=built?.kind==='GNG_AUDIO_Z80_AOT_PREFIX_V1' &&
    ['PARTIAL_UNCERTIFIED','SUPPORTED_PREFIX_ONLY'].includes(built?.status) &&
    built?.instruction_bytes_exported===false &&
    Number.isInteger(built?.compiled)&&built?.compiled>=0;
  if(!compileCheck){
    console.log(JSON.stringify({kind:'GNG_AUDIO_G5_FAST_CHECKPOINT_V1',
      status:'STOP_AOT_BUILD',
      node:{exit_code:node.exit_code,...nodeCounts},
      python:{exit_code:python.exit_code,...pyCounts},
      rom_identity:'SHA1_MATCH',
      z80_scan_status:scanOut.status}));
    return 2;
  }
  console.log(JSON.stringify({
    kind:'GNG_AUDIO_G5_FAST_CHECKPOINT_V1',
    status:scanOut.status==='TRUNCATED'?'PASS_REGRESSION_SCAN_TRUNCATED':
      'PASS_REGRESSION_STATIC_SCAN_Z80_NOT_CERTIFIED',
    node:{exit_code:node.exit_code,...nodeCounts},
    python:{exit_code:python.exit_code,...pyCounts},
    rom_identity:'SHA1_MATCH',
    z80_scan:{
      status:scanOut.status,
      static_decoded_pcs:scanOut.static_decoded_pcs,
      static_frontiers_total:scanOut.static_frontiers_total,
      families:scanOut.families,
      first_frontiers:scanOut.first_frontiers,
      seed_source:scanOut.seed_source
    },
    z80_build:{status:built.status,compiled:built.compiled,
      first_blocker:built.first_blocker??null},
    private_report_written:true,
    private_artifacts_safe:true,
    rom_bytes_exported:false,
    audio_working:false,
    native_parity_verified:false
  }));
  // Partial compiler is not a fatal regression; a truncated SCAN is distinct.
  return 0;
}
process.exitCode=run();
