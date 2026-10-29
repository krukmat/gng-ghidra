#!/usr/bin/env node
/** Private RP-3 performance gate against the RP-0 baseline path. Each sample
 * is a separate Node process (modes interleaved): the frozen bundle board
 * (RP-0), the pinned base board, the old board + reference YM WASM, and the
 * composed session with the base YM2203 bank. Timing covers the run only.
 * Gate: median of each new path <= old median * (1 + tolerance).
 */
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';

const SELF=fileURLToPath(import.meta.url);
const MODES=['cpu-old','cpu-new','session-old','session-new'];
const [first,...rest]=process.argv.slice(2);

if(first==='--sample'){
  const [mode,bundle,zip,refWasm,bankWasm,framesArg]=rest,frames=Number(framesArg);
  const {loadFrozen}=await import('../src/v2_b1_frozen.mjs');
  const {code}=loadFrozen(bundle);
  const {blocks}=await import(pathToFileURL(join(bundle,'program.mjs')).href);
  const rom=new Uint8Array(execFileSync('unzip',['-p',zip,'gg2.bin'],{maxBuffer:1<<20}));
  let run;
  if(mode==='cpu-old'){
    const {createBoard}=await import(pathToFileURL(join(bundle,'gngb_runtime.mjs')).href);
    const board=createBoard(code,blocks,{frames,onFrame:f=>{board.state.records[f.index-1]=null;}});
    run=()=>board.run().status;
  }else if(mode==='cpu-new'){
    const {createBoard}=await import('../boards/gng/runtime.mjs');
    const {mapGngFrozenBlocks}=await import('../boards/gng/code-view.mjs');
    const board=createBoard(code,mapGngFrozenBlocks(code,blocks),{frames,onFrame:()=>{}});
    run=()=>board.run().status;
  }else if(mode==='session-old'){
    const {createBoard}=await import('../src/gngb_runtime.mjs');
    const {createAudioCommandSource,applyCommand}=await import('../src/ao_audio_commands.mjs');
    const {loadYm2203}=await import('../src/ao_ym2203_wasm.mjs');
    const {CYCLES_PER_FRAME}=await import('../boards/gng/runtime.mjs');
    const source=await createAudioCommandSource(rom),
      ym=(await loadYm2203(new Uint8Array(readFileSync(refWasm)))).create();
    let events=[],audioFrames=0;
    const board=createBoard(code,blocks,{frames,
      onFrame:r=>{board.state.records[r.index-1]=null;},
      onAudioEvent:e=>events.push({kind:e.kind,value:e.value,cycle:e.cycle}),
      onAudioComplete:m=>{
        if(m.frames<=audioFrames)return;
        const {commands}=source.batch(m.frames*CYCLES_PER_FRAME,events);events=[];
        for(const c of commands)applyCommand(ym,c);
        audioFrames=m.frames;
      }});
    run=()=>board.run().status;
  }else if(mode==='session-new'){
    const {createGngSession}=await import('../boards/gng/index.mjs');
    const {mapGngFrozenBlocks}=await import('../boards/gng/code-view.mjs');
    const session=await createGngSession({code,blocks:mapGngFrozenBlocks(code,blocks),
      soundRom:rom,wasm:new Uint8Array(readFileSync(bankWasm)),frames});
    run=()=>session.runUntilFrame(frames).status;
  }else throw Error('RP3_PERF_MODE '+mode);
  const start=performance.now(),status=run(),ms=performance.now()-start;
  if(status!=='FRAMES_DONE')throw Error('RP3_PERF_STOP '+mode+' '+status);
  console.log(JSON.stringify({mode,ms}));
  process.exit(0);
}

const [bundleArg,zipArg,refArg,bankArg,framesArg,repsArg,tolArg,reportArg]=[first,...rest];
if(!reportArg)throw Error('RP3_PERF_USAGE: bundle rom-zip reference-wasm bank-wasm frames reps tolerance private-report');
const report=resolve(reportArg),frames=Number(framesArg),reps=Number(repsArg),tol=Number(tolArg);
if(!report.startsWith(resolve('out')+'/')||!Number.isInteger(frames)||frames<1||
   frames>6000||!Number.isInteger(reps)||reps<3||!(tol>=0&&tol<1))
  throw Error('RP3_PERF_ARGUMENT_INVALID');
const args=[resolve(bundleArg),resolve(zipArg),resolve(refArg),resolve(bankArg),String(frames)];
const samples=Object.fromEntries(MODES.map(m=>[m,[]]));
for(let i=0;i<reps;i++)for(const mode of MODES){
  const out=execFileSync(process.execPath,[SELF,'--sample',mode,...args],{encoding:'utf8'});
  samples[mode].push(JSON.parse(out.trim().split('\n').pop()).ms/frames);
}
const median=a=>{const s=[...a].sort((x,y)=>x-y),h=s.length>>1;
  return s.length%2?s[h]:(s[h-1]+s[h])/2;};
const round=x=>+x.toFixed(4);
const stats=Object.fromEntries(MODES.map(m=>[m,{msPerFrame:samples[m].map(round),
  median:round(median(samples[m])),min:round(Math.min(...samples[m])),
  max:round(Math.max(...samples[m]))}]));
const gate=(n,o)=>({ratio:round(stats[n].median/stats[o].median),
  pass:stats[n].median<=stats[o].median*(1+tol)});
const result={schema:'rom-migration.rp3.perf.v1',frames,reps,tolerance:tol,
  node:process.version,platform:process.platform,arch:process.arch,stats,
  gates:{cpu:gate('cpu-new','cpu-old'),session:gate('session-new','session-old')},
  note:'Run only, after import and creation; one process per sample, modes interleaved.'};
result.status=result.gates.cpu.pass&&result.gates.session.pass?'PASS':'FAIL';
mkdirSync(dirname(report),{recursive:true,mode:0o700});
writeFileSync(report,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({status:result.status,gates:result.gates,
  medians:Object.fromEntries(MODES.map(m=>[m,stats[m].median])),report}));
if(result.status!=='PASS')process.exitCode=2;
