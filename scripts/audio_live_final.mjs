#!/usr/bin/env node
/**
 * G5 decisive end-to-end sound gate:
 * private ROM -> running Z80 AOT + lab scheduler -> newly emitted YM ports
 * -> pinned ymfm dual YM2203 renderer -> private, measured mono PCM WAV.
 *
 * NEVER replays MAME YM tape; MAME captures supply only real sound COMMANDS.
 * NEVER exports private ROM, PC lists, YM values or generated AOT JS.
 * Deliberately NOT browser/live-game audio or native timing parity.
 *
 * Run (once, from repo root):
 *   node scripts/audio_live_final.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {parseZ80OperatorSeeds} from '../src/gngb_audio_frontier_report.mjs';
import {probeZ80SoundExecution} from '../src/gngb_z80_sound_probe.mjs';
import {YmRegisterHealth} from '../src/gngb_ym_register_health.mjs';
import {summarizeNativeYmRegisterWindow}
  from '../src/gngb_ym_native_baseline.mjs';

const OUT=path.resolve('out/audio');
const ROM_SHA1='7ef9ec5c2072e21c787a6bbf700033f50c759c1d';
// A 1-second probe precedes the first real captured sound command.
const POST_COMMAND_TSTATES=6_000_000;
const MAX_TSTATES=36_000_000;
const MAX_STEPS=5_000_000;
const YM_EVENT_LIMIT=200_000;
const RESULT_KIND='GNG_AUDIO_G5_FINAL_Z80_TO_PCM_V1';
const EXPECTED_NATIVE_CONTROLS='GNG_AUDIO_B4_T3_PRIVATE_NATIVE_CONTROLS_V1';
const ROOTS='z80-native-roots-b4trace1.json';
const CONTROLS='z80-native-controls-heartbeat4-t3b3.json';
const fail=(code)=>{const err=new Error(code);err.code=code;throw err;};

function privateInput(basename) {
  if(!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,100}$/.test(basename))
    fail('AUDIO_FINAL_UNSAFE_BASENAME');
  const file=path.join(OUT,basename);
  if(!fs.existsSync(file))fail('AUDIO_FINAL_PRIVATE_INPUT_MISSING');
  if(fs.realpathSync(file)!==file||!fs.statSync(file).isFile())
    fail('AUDIO_FINAL_PRIVATE_INPUT_INVALID');
  return file;
}
function parseJsonInput(basename,max=1024*1024){
  const file=privateInput(basename);
  if(fs.statSync(file).size>max)fail('AUDIO_FINAL_PRIVATE_JSON_OVERSIZE');
  return JSON.parse(fs.readFileSync(file,'utf8'));
}
// This is deliberately a separate allowlist from the raw child JSON. A failed
// child may contain exception text or private paths; retain only safe metadata.
function safeGateFailure(gate,exitCode){
  const count=x=>Number.isSafeInteger(x)&&x>=0?x:null;
  const publicNodeNames=new Set();
  try {
    const source=fs.readFileSync(new URL('./audio_fast_checkpoint.mjs',import.meta.url),'utf8');
    for(const match of source.matchAll(/'(tests\/[^']+\.mjs)'/g)){
      const tests=fs.readFileSync(new URL('../'+match[1],import.meta.url),'utf8');
      for(const title of tests.matchAll(/\btest\(\s*(['"])(.*?)\1/g))
        publicNodeNames.add(title[2]);
    }
  } catch {} // Counts and safe stage remain useful if public sources are absent.
  const names=(list,python)=>Array.isArray(list)?list.filter(x=>
    typeof x==='string'&&(python?/^[A-Za-z0-9_]{1,180}$/.test(x):
      publicNodeNames.has(x))).slice(0,12):[];
  const status=['STOP_BAD_ARGUMENTS','STOP_REGRESSION',
    'STOP_PRIVATE_ARTIFACT_GUARD','STOP_ROM_OR_SCAN','STOP_AOT_BUILD',
    'PASS_REGRESSION_SCAN_TRUNCATED',
    'PASS_REGRESSION_STATIC_SCAN_Z80_NOT_CERTIFIED'].includes(gate?.status)?
    gate.status:'INVALID_CHECKPOINT_REPORT';
  const suites={};
  for(const name of ['node','python']){
    const suite=gate?.[name];
    suites[name]={exit_code:count(suite?.exit_code),ran:count(suite?.ran),
      ...(name==='node'?{passed:count(suite?.passed),failed:count(suite?.failed)}:
        {ok:suite?.ok===true,failed:suite?.failed===true}),
      failing_test_names:names(suite?.failing_test_names,name==='python')};
  }
  const code=x=>/^AUDIO_[A-Z0-9_]{3,80}$/.test(x)?x:null;
  return {status,gate_exit_code:count(exitCode),...suites,
    z80_scan_exit_code:count(gate?.z80_scan_exit_code),
    z80_scan_reason:code(gate?.z80_scan_reason),
    z80_build_exit_code:count(gate?.z80_build_exit_code),
    z80_build_reason:code(gate?.z80_build_reason)};
}
function checkGate(){
  const proc=spawnSync(process.execPath,['scripts/audio_fast_checkpoint.mjs'],{
    encoding:'utf8',timeout:180000,maxBuffer:4*1024*1024,
    stdio:['ignore','pipe','pipe']
  });
  const records=(proc.stdout||'').trim().split(/\n/).filter(Boolean);
  let gate=null;
  try {gate=JSON.parse(records[records.length-1]);}catch{}
  if(proc.error||proc.status!==0||
     gate?.kind!=='GNG_AUDIO_G5_FAST_CHECKPOINT_V1'||
     gate.status!=='PASS_REGRESSION_STATIC_SCAN_Z80_NOT_CERTIFIED'||
     gate.node?.failed!==0||gate.python?.failed!==false||
     gate.rom_identity!=='SHA1_MATCH'||gate.private_artifacts_safe!==true){
    const err=new Error('AUDIO_FINAL_REGRESSION_GATE_STOP');
    err.code=gate===null&&proc.status===0?
      'AUDIO_FINAL_REGRESSION_FORMAT_STOP':'AUDIO_FINAL_REGRESSION_GATE_STOP';
    err.checkpoint=safeGateFailure(gate,proc.status);
    throw err;
  }
  return {node:gate.node.passed,python:gate.python.ran};
}
function metricsWav(file){
  const data=fs.readFileSync(file);
  if(data.length<44||data.toString('ascii',0,4)!=='RIFF'||
     data.toString('ascii',8,12)!=='WAVE'||
     data.readUInt16LE(20)!==1||data.readUInt16LE(22)!==1||
     data.readUInt32LE(24)!==62500||data.readUInt16LE(34)!==16||
     data.toString('ascii',36,40)!=='data'||
     data.length!==44+data.readUInt32LE(40))
    fail('AUDIO_FINAL_PCM_FORMAT_STOP');
  let nonzero=0,peak=0,sumSquares=0;
  const count=(data.length-44)/2;
  for(let i=44;i<data.length;i+=2){
    const sample=data.readInt16LE(i);
    if(sample)nonzero++;
    peak=Math.max(peak,Math.abs(sample));
    sumSquares+=sample*sample;
  }
  return {samples:count,nonzero,peak,rms:Math.round(Math.sqrt(sumSquares/count)*100)/100};
}
async function run(){
  const progress={checkpoint:null,execution:null,renderer:null,
    ymRegisterHealth:null,nativeYmComparison:null,silenceDiagnosis:null};
  let created=null;
  try {
    if(!fs.existsSync(OUT)||fs.realpathSync(OUT)!==OUT||
       !fs.statSync(OUT).isDirectory())
      fail('AUDIO_FINAL_PRIVATE_DIR_REQUIRED');
    progress.checkpoint=checkGate();
    const rom=fs.readFileSync(privateInput('gg2.bin'));
    if(rom.length!==0x8000||
       createHash('sha1').update(rom).digest('hex')!==ROM_SHA1)
      fail('AUDIO_FINAL_PRIVATE_ROM_IDENTITY_STOP');
    const roots=parseZ80OperatorSeeds(fs.readFileSync(
      privateInput(ROOTS),'utf8'));
    const controls=parseJsonInput(CONTROLS);
    if(controls?.kind!==EXPECTED_NATIVE_CONTROLS)
      fail('AUDIO_FINAL_NATIVE_CONTROLS_INVALID');
    const firstCommandTick=controls.events?.[0]?.tick12m;
    if(!Number.isSafeInteger(firstCommandTick)||firstCommandTick<0||
       firstCommandTick%4!==0)
      fail('AUDIO_FINAL_NO_CAPTURED_SOUND_COMMAND');
    const firstCommandTState=firstCommandTick/4;
    if(firstCommandTState+POST_COMMAND_TSTATES>MAX_TSTATES)
      fail('AUDIO_FINAL_SOUND_COMMAND_OUTSIDE_SAFE_WINDOW');
    // Crucial: the FIRST native command is not until ~19.8m Z80 T-states.
    // No fake command, YM output replay or fresh CPU reset between chunks.
    const targetTStates=firstCommandTState+POST_COMMAND_TSTATES;
    const capturedYm=[],liveHealth=new YmRegisterHealth();
    let lastTick=-1;
    const z80=await probeZ80SoundExecution(new Uint8Array(rom),roots,{
      nativeControls:controls,targetTStates,maxSteps:MAX_STEPS,
      onYmWrite:e=>{
        if(capturedYm.length>=YM_EVENT_LIMIT)
          fail('AUDIO_FINAL_YM_EVENT_BUDGET_STOP');
        if(e.tick12m<lastTick||e.addr<0xe000||e.addr>0xe003||
           !Number.isInteger(e.value)||e.value<0||e.value>255)
          fail('AUDIO_FINAL_YM_EVENT_TIME_STOP');
        liveHealth.accept(e.addr,e.value);
        capturedYm.push([e.tick12m,e.addr,e.value]);lastTick=e.tick12m;
      }
    });
    progress.ymRegisterHealth=liveHealth.snapshot();
    try {
      progress.nativeYmComparison=await summarizeNativeYmRegisterWindow(
        privateInput('mame-audio-events-heartbeat4.jsonl'),
        {windowTStates:targetTStates,generatedYm:capturedYm});
    } catch {
      progress.nativeYmComparison={
        kind:'GNG_AUDIO_G5_PRIVATE_NATIVE_YM_BASELINE_V1',
        status:'UNAVAILABLE_NATIVE_BASELINE_NOT_SYNTH_INPUT',
        usedAsSynthesizerInput:false,
        rawYmDataExported:false};
    }
    progress.execution={
      status:z80.status,reason:z80.reason,
      steps:z80.executed_steps,reached_tstates:z80.reached_tstates,
      target_tstates:targetTStates,
      runtime_rom_blocks_resolved:z80.runtime_resolved_rom_blocks,
      runtime_resolution_attempts:z80.runtime_resolution_attempts,
      runtime_first_unsupported_family:z80.runtime_first_unsupported_family,
      first_native_sound_command_tstate:firstCommandTState,
      irq_requests:z80.irq_requests,irq_acknowledgements:z80.irq_acknowledged_lab,
      native_commands_applied:z80.native_sound_controls_applied,
      sound_latch_reads:z80.z80_sound_latch_reads,
      sound_latch_reads_after_command:z80.z80_sound_latch_reads_after_command,
      ym_writes:z80.ym_port_writes_from_running_z80,
      ym1_writes:z80.ym1_writes,ym2_writes:z80.ym2_writes,
      non_tape_ym_events:capturedYm.length,
      first_generated_ym_tstate:capturedYm.length?
        Math.floor(capturedYm[0][0]/4):null,
      last_generated_ym_tstate:capturedYm.length?
        Math.floor(capturedYm.at(-1)[0]/4):null,
      native_timing_parity_verified:false
    };
    // Any rejected producer event is a hard stop. Never render a partially
    // corrupt stream after a callback-level safety failure.
    if(z80.reason?.startsWith('AUDIO_FINAL_'))fail(z80.reason);
    if(capturedYm.length===0){
      const code=z80.status==='LAB_ADVANCE_OK'?
        'AUDIO_FINAL_Z80_NO_YM_WRITES':'AUDIO_FINAL_Z80_RUNTIME_STOP';
      fail(code);
    }
    // Rendering never reads MAME's captured register-event tape.
    // Only YM writes emitted by the Z80 compiled code in THIS process.
    if(!fs.existsSync(path.join(OUT,'ym2203_lab')))
      fail('AUDIO_FINAL_YMFM_RENDERER_MISSING');
    const binary=privateInput('ym2203_lab');
    const suffix=new Date().toISOString().replace(/[-:.TZ]/g,'').slice(0,14)+
      '-'+process.pid;
    const tsv=path.join(OUT,'z80-live-generated-'+suffix+'.tsv');
    const wav=path.join(OUT,'z80-live-generated-'+suffix+'.wav');
    const fd=fs.openSync(tsv,'wx',0o600);
    created={tsv,wav};
    try{
      fs.writeFileSync(fd,capturedYm.map(e=>e.join(' ')).join('\n')+'\n');
    }finally{fs.closeSync(fd);}
    const durationMs=Math.max(1,Math.min(30000,
      Math.ceil((Math.max(lastTick,4*z80.reached_tstates)+192)/12000)+10));
    // Write placeholder with private perms; pinned lab renderer rewrites it.
    const wavFd=fs.openSync(wav,'wx',0o600);fs.closeSync(wavFd);
    const render=spawnSync(binary,[tsv,wav,String(durationMs)],{
      stdio:['ignore','pipe','pipe'],encoding:'utf8',
      timeout:120000,maxBuffer:1024*1024
    });
    if(render.error||render.status!==0)
      fail('AUDIO_FINAL_YMFM_RENDER_STOP');
    const stats=metricsWav(wav);
    progress.renderer={
      status:stats.nonzero>0?'PCM_NON_SILENT_FROM_Z80':'PCM_SILENT_FROM_Z80',
      private_wav:'out/audio/'+path.basename(wav),
      output_sample_rate:62500,
      ...stats,ym_native_event_tape_used:false
    };
    if(!stats.nonzero) {
      // Register-class comparison is a diagnostic, NOT proof of why YM is
      // silent. Never mask the original PCM failure with an optimistic status.
      const live=progress.ymRegisterHealth;
      const native=progress.nativeYmComparison?.registerActivity;
      const sourceActive=live?.plausibleToneActivation===true;
      const nativeActive=native?.plausibleToneActivation===true;
      progress.silenceDiagnosis={
        kind:'GNG_AUDIO_G5_SILENCE_TRIAGE_V1',
        status:!sourceActive&&nativeActive?
          'NATIVE_TONE_ACTIVATION_NOT_OBSERVED_IN_LAB':
          !sourceActive?'LAB_YM_TONE_ACTIVATION_NOT_OBSERVED':
          'LAB_TONE_ACTIVATION_PRESENT_BUT_PCM_ZERO',
        referenceNativeAvailable:!!native,
        provenRootCause:false
      };
      // A runtime STOP is more actionable than a silent partial WAV.
      // Always preserve both the stop code and source-vs-native YM summary.
      fail(z80.status==='LAB_ADVANCE_OK'?
        'AUDIO_FINAL_PCM_SILENT':'AUDIO_FINAL_RUNTIME_STOP_AND_PCM_SILENT');
    }
    const status=z80.status==='LAB_ADVANCE_OK'?
      'Z80_TO_DUAL_YM_TO_PCM_LAB_PASS_NOT_LIVE_GAME':
      'PARTIAL_Z80_TO_PCM_RUNTIME_STOP';
    console.log(JSON.stringify({
      kind:RESULT_KIND,status,checkpoint:progress.checkpoint,
      execution:progress.execution,renderer:progress.renderer,
      ymRegisterHealth:progress.ymRegisterHealth,
      nativeYmComparison:progress.nativeYmComparison,
      silenceDiagnosis:progress.silenceDiagnosis,
      game_audio_live:false,native_irq_parity_verified:false,
      browser_worklet_connected:false,rom_bytes_exported:false,
      private_artifacts_safe:true
    }));
    process.exitCode=z80.status==='LAB_ADVANCE_OK'?0:2;
  } catch(err) {
    if(err?.checkpoint)progress.checkpoint=err.checkpoint;
    const reason=/^AUDIO_[A-Z0-9_]{3,80}$/.test(err?.code)?err.code:
      'AUDIO_FINAL_UNEXPECTED_STOP';
    console.log(JSON.stringify({
      kind:RESULT_KIND,status:'STOP',reason,
      checkpoint:progress.checkpoint,execution:progress.execution,
      renderer:progress.renderer,
      ymRegisterHealth:progress.ymRegisterHealth,
      nativeYmComparison:progress.nativeYmComparison,
      silenceDiagnosis:progress.silenceDiagnosis,
      game_audio_live:false,native_irq_parity_verified:false,
      browser_worklet_connected:false,
      rom_bytes_exported:false,private_artifacts_safe:true
    }));
    process.exitCode=2;
  } finally {
    // Avoid retaining private event TSV after rendering: this intermediate is
    // derived from live Z80 execution but still has ROM-derived information.
    if(created?.tsv){try{fs.unlinkSync(created.tsv);}catch{}}
  }
}
await run();
