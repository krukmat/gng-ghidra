#!/usr/bin/env node
/** V2.B1: oracle comparison ONLY after both frozen JS-only runs finished. */
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifySlot,compareSlots,RECORD_BYTES} from '../src/v2_b1_gate_lib.mjs';
import {rendererUnknownCount} from '../src/v2_b1_observable.mjs';
import {certifyV2Coverage} from '../src/v2_b1_coverage.mjs';
import {parseNativeEvents,compareEvents,compareRecord} from './r35_t5_run.mjs';
import {renderGngbRgba} from '../src/gngb_frame_renderer.mjs';
import {gngbGraphics,rendererInputs,decodePng,diffRgba} from './r35_t5_render_check.mjs';
import {CYCLES_PER_FRAME} from '../src/gngb_runtime.mjs';
import {loadFrozen} from '../src/v2_b1_frozen.mjs';

const ROOT=resolve(fileURLToPath(import.meta.url),'../..');
const dir=join(ROOT,'out/v2/b1'),ref=join(ROOT,'out/r35/t43-ref');
const fail=code=>{throw Error('V2_B1_'+code);};
function main(){
  if(process.argv.slice(2).join(' ')!=='--gate')fail('USAGE_GATE_ONLY');
  const output=join(dir,'certification.json');
  if(existsSync(output))fail('CERTIFICATION_ALREADY_EXISTS');
  const source=loadFrozen(join(dir,'frozen')).manifest.source_git_head;
  if(typeof source!=='string'||!/^[a-f0-9]{40}$/.test(source))
    fail('SOURCE_COMMIT_NOT_ATTESTED');
  const one=verifySlot(dir,'one'),two=verifySlot(dir,'two');
  compareSlots(one,two);
  const {report,frames,known,rows}=one;
  if(report.frames!==600||!Number.isInteger(report.last_cycle)||
     report.last_cycle<599*CYCLES_PER_FRAME)fail('FRAME_COUNT_OR_TIMING');
  const raw=readFileSync(join(ref,'frames.bin'));
  const metas=readFileSync(join(ref,'frames.jsonl'),'utf8')
    .split('\n').filter(Boolean).map(x=>JSON.parse(x));
  if(raw.length!==600*RECORD_BYTES||metas.length!==600)
    fail('REFERENCE_LENGTH_MISMATCH');
  const native=parseNativeEvents(readFileSync(join(ref,'native-events.log'),'utf8'));
  const events=compareEvents(report.events,native,
    Math.min(report.frames*CYCLES_PER_FRAME-1,report.last_cycle));
  if(Object.values(events).some(x=>x.first_divergence))
    fail('NATIVE_EVENT_DIVERGENCE');
  if(!events.SYNC_ENTER.compared||!events.SYNC_EXIT.compared||
     !events.LINE_DELIVERED.compared||!events.VECTOR_FETCH.compared)
    fail('NATIVE_EVENT_COVERAGE_INSUFFICIENT');
  const zip=join(ROOT,'roms/gng.zip');
  const gfx=gngbGraphics(n=>execFileSync('unzip',['-p',zip,n],
    {maxBuffer:1<<20,stdio:['ignore','pipe','ignore']}));
  const observed=[],pixelDigests=Array(600).fill(null);
  for(let i=0;i<600;i++){
    const start=i*RECORD_BYTES,end=start+RECORD_BYTES,meta=rows[i];
    const current={index:i+1,record:frames.subarray(start,end),
      known:known.subarray(start,end),...meta};
    const reference=raw.subarray(start,end),nativeMeta=metas[i];
    if(nativeMeta.index!==i+1)fail('REFERENCE_FRAME_INDEX');
    const cmp=compareRecord(current,reference,nativeMeta);
    if(cmp.mismatch||cmp.metaDiff.length)fail('FRAME_STATE_MISMATCH');
    const complete=cmp.unknown===0;
    const visUnknown=rendererUnknownCount(current);
    if(visUnknown!==report.visible_unknowns[i])fail('VISIBLE_KNOWN_MASK_DIFFERENCE');
    if(visUnknown===0){
      const ours=renderGngbRgba(rendererInputs(current.record,
        {scroll:meta.scroll,latch:meta.latch},gfx));
      const file=join(ref,'png',String(nativeMeta.frame).padStart(4,'0')+'.png');
      const expected=decodePng(readFileSync(file));
      if(ours.width!==expected.width||ours.height!==expected.height||
         diffRgba(ours.rgba,expected.rgba,expected.width).count!==0)
        fail('PIXEL_MISMATCH');
      pixelDigests[i]=createHash('sha256').update(ours.rgba).digest('hex');
    }
    observed.push({frame:i+1,state_complete:complete,renderer_known:visUnknown===0});
  }
  // The MAME sprite buffer is not certified before first real DMA.
  // Validate every eligible frame; never silently lower correctness of a
  // frame or infer a blank sprite buffer from the reference's zeros.
  const coverage=certifyV2Coverage(observed,pixelDigests);
  const result={schema:'gng.v2.b1-certification.v1',
    status:'V2_AUTONOMOUS_FRAME_CERTIFIED',frames:600,
    blocks:report.blocks,...coverage,
    first_six_not_auto_certified:true,
    events_compared:Object.fromEntries(Object.entries(events).map(([k,v])=>[k,v.compared])),
    aot_run_digest:report.sequence_sha256,source_git_head:source,
    observed};
  writeFileSync(output,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log('V2_AUTONOMOUS_FRAME_CERTIFIED');
  console.log('V2_B1_FRAMES='+result.frames);
  console.log('V2_B1_STATE_EXACT='+coverage.state_exact_frames);
  console.log('V2_B1_PIXEL_EXACT='+coverage.pixel_exact_frames);
  console.log('V2_B1_PIXEL_INTERVAL='+coverage.pixel_interval_start+'..'+coverage.pixel_interval_end);
  console.log('V2_B1_PRIOR_PIXELS_UNVERIFIED='+coverage.prior_frames_pixel_unverified);
  console.log('V2_B1_DISTINCT_PIXELS='+coverage.pixels_distinct);
  console.log('V2_B1_FIRST_RENDERER_KNOWN='+coverage.first_renderer_known);
}
try{main();}catch(e){
  console.error('V2_B1_T5=BLOCKED_'+
    (String(e.message).startsWith('V2_B1_')?String(e.message).slice(6):'PRIVATE_INPUT_OR_IO'));
  process.exitCode=2;
}
