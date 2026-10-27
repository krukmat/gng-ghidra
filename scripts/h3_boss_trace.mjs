#!/usr/bin/env node
/** H3 lab: bounded causal trace of a watched RAM range in a saved boss-search
 * tape (hooks in src/h3_lab_trace.mjs). Replays the frozen certified bundle
 * from reset with the tape's own poke; bundle and runtime stay untouched.
 * The window is then replayed from the saved pre-window state with logging
 * off: equal record hashes show the logging is neutral. H3_TRACE_BASELINE
 * compares the traced records with an h3_boss_inspect.mjs run (no wrapper).
 * Usage: node scripts/h3_boss_trace.mjs <tape.json> <from> <to> [detailFrom:detailTo]
 * Env: H3_TRACE_WATCH=addr:len (default 0x510:2), H3_TRACE_BASELINE=<inspect.json>.
 * Limits: window <= 122 records, read detail <= 4 records inside it.
 * Output: out/h3/boss/f2/trace-<from>-<to>.{txt,ram.bin,json} (private).
 */
import {createHash} from 'node:crypto';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {loadFrozen} from '../src/v2_b1_frozen.mjs';
import {selectB3Bundle} from '../src/v3_b3_bundle.mjs';
import {resolveB3LabTape} from '../src/v3_b3_external_tape.mjs';
import {parseLabPokes,applyLabPokes} from '../src/h3_lab_poke.mjs';
import {labCreateBoard} from '../src/v3_b3_lab_board.mjs';
import {drawOrder} from '../src/sprite_memory.mjs';
import {createTrace,parseTraceArgs} from '../src/h3_lab_trace.mjs';

const ROOT=resolve(fileURLToPath(import.meta.url),'../..');
const [file,...args]=process.argv.slice(2);
if(!file)throw Error('H3_TRACE_USAGE');
const {from,to,detail,watch,len}=parseTraceArgs(args,process.env.H3_TRACE_WATCH);
const raw=JSON.parse(readFileSync(file,'utf8'));
const tape=resolveB3LabTape(file);
if(to>tape.frames)throw Error('H3_TRACE_FRAME_OUTSIDE_TAPE');
const pokes=parseLabPokes(raw.h3?.poke??'');
const selected=selectB3Bundle(ROOT);
if(!selected)throw Error('V3_B3_NO_CERTIFIED_BUNDLE');
const {manifest,code}=loadFrozen(selected.dir);
const {blocks}=await import(pathToFileURL(join(selected.dir,'program.mjs')).href);

const word=(b,a)=>b[a]<<8|b[a+1];
const bcd=b=>[0x68,0x69,0x6a,0x6b]
  .reduce((v,a)=>v*100+(b[a]>>4)*10+(b[a]&15),0);
// Same fields as h3_boss_inspect.mjs rows, for the baseline comparison.
const row=(frame,r)=>{
  const b=r.record;
  return JSON.parse(JSON.stringify({frame,phase:b[0x72],checkpoint:b[0x81],
    loop:b[0x71],lives:b[0x60],armor:b[0xac],score:bcd(b),x:word(b,0xa0),
    y:word(b,0xa2),playerHandler:word(b,0x510),worldScroll:word(b,0x58),
    hardwareScroll:r.scroll[0]+256*r.scroll[1],
    visibleSprites:drawOrder(b.slice(0x2000,0x2200)).filter(s=>s.bytes.some(Boolean))
      .map(({slot,graphic,paletteGroup,x,y,flipX,flipY,bytes})=>
        ({slot,graphic,paletteGroup,x,y,flipX,flipY,bytes}))}));
};
const trace=createTrace(blocks,{from,to,watch,len,detail});
const rows=[],ram=[],checks={ramMatchesRecord:true,counterMatchesRecord:true};
let hash=null;
const board=await labCreateBoard(join(selected.dir,'gngb_runtime.mjs'),
  manifest.files['gngb_runtime.mjs'],code,trace.table,{frames:to,
    portRead:(addr,cycle)=>tape.read(addr,cycle),
    onFrame:r=>{
      const $=board.state,i=$.records.length;
      if(i<from)$.records[i-1]=null;
      else{
        hash.update(r.record);
        if(!trace.quiet){
          // onFrame runs right after the snapshot, before this record's poke.
          const live=$.ramBytes(0,0x1e00).bytes;
          if(!r.record.subarray(0,0x1e00).every((v,k)=>v===live[k]))
            checks.ramMatchesRecord=false;
          if($.frame+1!==i)checks.counterMatchesRecord=false;
          trace.lines.push(`F ${i} C=${$.C} T=${$.T} watch=${
            r.record.subarray(watch,watch+len).reduce((v,x)=>v*256+x,0).toString(16)}`);
          rows.push(row(i,r));ram.push(r.record);
        }
      }
      applyLabPokes(pokes,$,i);
    }});
trace.attach(board.state);
if(board.lab.advanceTo(from-1).status!=='FRAMES_DONE')throw Error('H3_TRACE_PREFIX_FAILED');
const pre=board.lab.save();
hash=createHash('sha256');
const traced=board.lab.advanceTo(to),tracedSha=hash.digest('hex');
const tracedRam=board.state.ramBytes(0,0x3000).bytes;
board.lab.restore(pre);trace.quiet=true;hash=createHash('sha256');
const quiet=board.lab.advanceTo(to),quietSha=hash.digest('hex');
const finalRamEqual=Buffer.from(tracedRam).equals(Buffer.from(board.state.ramBytes(0,0x3000).bytes));
let baseline=null;
if(process.env.H3_TRACE_BASELINE){
  const b=JSON.parse(readFileSync(process.env.H3_TRACE_BASELINE,'utf8'));
  if(b.tapeSha256!==tape.sha256||b.bundleGeneration!==selected.generation||
     b.poke!==(raw.h3?.poke??''))throw Error('H3_TRACE_BASELINE_MISMATCH');
  const mine=new Map(rows.map(r=>[r.frame,r]));
  const same=b.rows.filter(r=>mine.has(r.frame));
  baseline={compared:same.length,
    mismatches:same.filter(r=>!isDeepStrictEqual(r,mine.get(r.frame))).map(r=>r.frame)};
}
const out=join(ROOT,'out/h3/boss/f2');
mkdirSync(out,{recursive:true,mode:0o700});
const base=join(out,`trace-${from}-${to}`);
writeFileSync(base+'.txt',trace.lines.join('\n')+'\n',{mode:0o600});
writeFileSync(base+'.ram.bin',Buffer.concat(ram),{mode:0o600});
const transitions=trace.writes.filter(w=>w.before!==w.after).map(w=>
  ({record:w.record,cycle:w.cycle,pc:w.pc,from:w.before.toString(16),to:w.after.toString(16)}));
const summary={schema:'gng.h3.boss-trace.v1',bundleGeneration:selected.generation,
  tapeSha256:tape.sha256,poke:raw.h3?.poke??'',window:[from,to],readDetail:detail,
  watch:'0x'+watch.toString(16)+':'+len,
  checks:{...checks,status:[traced.status,quiet.status],tracedSha256:tracedSha,
    quietSha256:quietSha,neutral:tracedSha===quietSha&&finalRamEqual&&
      traced.status==='FRAMES_DONE'&&quiet.status==='FRAMES_DONE',finalRamEqual},
  baseline,watchedWritesOutsideWindow:trace.outside,transitions,writes:trace.writes,
  lines:trace.lines.length,ramRecords:ram.length,
  files:[base+'.txt',base+'.ram.bin',base+'.json'].map(f=>f.slice(ROOT.length+1))};
writeFileSync(base+'.json',JSON.stringify(summary,null,2)+'\n',{mode:0o600});
console.log(JSON.stringify({...summary,writes:summary.writes.length},null,2));
process.exitCode=summary.checks.neutral&&(!baseline||!baseline.mismatches.length)?0:1;
