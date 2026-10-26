import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RECORD_BYTES,validateFrames,nativeSummary}
  from '../scripts/r35_t43_summary.mjs';

const M='GNG_R35_NATIVE_V1';
const ev=(kind,...args)=>M+'\t'+kind+'\t'+args.join('\t')+'\n';
const row=(index,frame,dma=false)=>JSON.stringify({index,frame,
  sprite_buffer_valid:dma,dma_writes:dma?1:0})+'\n';
const pngs=frames=>new Set(frames.map(f=>String(f).padStart(4,'0')+'.png'));

test('consecutive frames from frame 0 with matching record bytes and PNGs pass',()=>{
  const x=validateFrames(row(1,0)+row(2,1)+row(3,2,true),3*RECORD_BYTES,
    pngs([0,1,2]),3);
  assert.equal(x.status,'PASS');
  assert.equal(x.first_frame,0);
  assert.equal(x.first_sprite_dma_index,3);
});
test('gaps, short records, missing PNG and wrong count fail closed',()=>{
  const ok=row(1,0)+row(2,1);
  assert.equal(validateFrames(row(1,0)+row(2,2),2*RECORD_BYTES,pngs([0,2]),2).status,
    'BLOCKED_FRAME_SEQUENCE');
  assert.equal(validateFrames(ok,2*RECORD_BYTES-1,pngs([0,1]),2).status,
    'BLOCKED_FRAMES_BIN_SIZE');
  assert.equal(validateFrames(ok,2*RECORD_BYTES,pngs([0]),2).status,
    'BLOCKED_PNG_MISSING');
  assert.equal(validateFrames(ok,2*RECORD_BYTES,pngs([0,1]),3).status,
    'BLOCKED_FRAME_COUNT');
  assert.equal(validateFrames(ok+'{',2*RECORD_BYTES,pngs([0,1]),2).status,
    'BLOCKED_FRAME_COUNT');
});
test('one cold reset, one VBLANK IRQ per frame and a masked target wake are counted',()=>{
  const log=[
    ev('CPU_RESET','0'),
    ev('SYNC_ENTER','6016','50','100'),
    ev('LINE_DELIVERED','IRQ','1','6016','50','25152'),
    ev('SYNC_EXIT','6017','50','1','0','0','25153'),
    ev('SYNC_ENTER','6016','50','25200'),
    ev('LINE_DELIVERED','IRQ','1','6016','50','50304'),
    ev('SYNC_EXIT','6017','50','1','0','0','50305'),
  ].join('');
  const x=nativeSummary(log,2);
  assert.equal(x.status,'NATIVE_MASKED_SYNC_WAKE_EVENT_CORRELATED');
  assert.equal(x.cpu_reset_events,1);
  assert.equal(x.irq_asserts,2);
  assert.equal(x.irq_asserts_match_frames,true);
  assert.equal(x.masked_target_wakes,2);
  assert.equal(nativeSummary(log,10).irq_asserts_match_frames,false);
});
test('absent or malformed native markers become fixed BLOCKED statuses',()=>{
  assert.equal(nativeSummary('plain MAME output\n',2).status,
    'BLOCKED_R35_NATIVE_PATCH_MARKERS_ABSENT');
  assert.equal(nativeSummary(ev('SYNC_ENTER','6016','50','1'),2).status,
    'BLOCKED_R35_NATIVE_EVENT_BEFORE_CPU_RESET');
  assert.equal(nativeSummary(M+'\tBOGUS\t1\n',2).status,
    'BLOCKED_R35_NATIVE_BAD_EVENT_SHAPE');
});
