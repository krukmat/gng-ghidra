import test from 'node:test';
import assert from 'node:assert/strict';
import {runR42hGate} from '../scripts/r42h_romfree_gate.mjs';
import {makeR42hSeed,makeR42hGraphics,r42hEvent,r42hLine,r42hLines,
  makeR42hSyntheticTimeline,runR42hCase,runR42hDiagnostic,R42H_SIZES}
  from '../src/r42h_romfree_gate.mjs';
import {replayR42gTimeline,r42gBootstrapDigest}
  from '../src/r42g_incremental_timeline.mjs';

test('H1: F-shaped synthetic stream drives real G board and shared renderer',async()=>{
  const result=await runR42hCase({count:5000});
  assert.equal(result.source,'SYNTHETIC_F_FORMAT_TEST_NOT_MAME');
  assert.equal(result.core.status,'STATE_REPLAYED_TEMPORAL_PROOF_MISSING');
  assert.equal(result.core.event_count,5000);
  assert.equal(result.core.coverage.full_state,true);
  assert.equal(result.core.frame_sha256,result.snapshot.frame_sha256);
  assert.equal(result.core.native_origin_attested,false);
  assert.equal(result.core.native_pixel_equivalence_verified,false);
});
test('H4: event 0, DMA byte 3 and first changed pixel have independent witnesses',async()=>{
  const r=await runR42hDiagnostic({count:5000});
  assert.equal(r.status,'SYNTHETIC_E2E_DIAGNOSTIC_PASS');
  assert.equal(r.repeat_identical,true);
  assert.equal(r.changed.first_event_seq,0);
  assert.equal(r.changed.first_byte_divergence.region,'SPRITE_DMA');
  assert.equal(r.changed.first_byte_divergence.byte_offset,3);
  assert.deepEqual(r.changed.first_pixel_divergence,{x:34,y:66,channel:'R'});
  assert.equal(r.changed.equal_components.video_ram,true);
  assert.equal(r.changed.equal_components.pixels,false);
  assert.equal(r.native_mame_executed,false);
});
test('H2: CPU sprite write after DMA affects events but not pixels or DMA buffer',async()=>{
  const r=await runR42hDiagnostic({count:5000});
  assert.equal(r.post_dma_write.first_event_seq,2);
  assert.equal(r.post_dma_write.first_byte_divergence,null);
  assert.equal(r.post_dma_write.first_pixel_divergence,null);
  assert.equal(r.post_dma_write.equal_components.buffered_sprite,true);
  assert.equal(r.post_dma_write.equal_components.pixels,true);
});
test('H2: unchanged digest with tampered F event is rejected',async()=>{
  const timeline=makeR42hSyntheticTimeline(5000);
  async function* changed(){
    for(let i=0;i<5000;i++){
      if(i===0){
        const row=r42hEvent(i,5000);row.data=74;
        yield Buffer.from(JSON.stringify(row)+'\n');
      }else yield r42hLine(i,5000);
    }
  }
  await assert.rejects(replayR42gTimeline({
    rawLines:changed(),timeline,bootstrap:makeR42hSeed()
  }),/R42G_TRACE_OR_DIGEST_MISMATCH/);
});
test('H2: coverage cannot be invented by incomplete bootstrap or missing DMA',async()=>{
  const seed=makeR42hSeed(),t=makeR42hSyntheticTimeline(5000);
  seed.sprite_ram[3]^=1;
  await assert.rejects(replayR42gTimeline({
    rawLines:r42hLines(5000),timeline:t,bootstrap:seed
  }),/R42G_BOOTSTRAP_DIGEST_MISMATCH/);
  const full=makeR42hSeed();
  full.origin='PRE_TAP_UNATTESTED'; // origin must be hash-bound
  await assert.rejects(replayR42gTimeline({
    rawLines:r42hLines(5000),timeline:t,bootstrap:full
  }),/R42G_BOOTSTRAP_DIGEST_MISMATCH/);
  assert.equal(r42gBootstrapDigest(makeR42hSeed()).length,64);
});
test('H3: functional scale 5000 and window boundary 40001',async()=>{
  assert.deepEqual([...R42H_SIZES],[5000,40001,100000]);
  const first=await runR42hCase({count:5000});
  const second=await runR42hCase({count:40001});
  assert.equal(first.core.window_count,1);
  assert.equal(second.core.window_count,2);
  assert.equal(second.core.event_count,40001);
});
test('H3: proportional 100000 event stress retains one board and ends at 3 windows',async()=>{
  const result=await runR42hCase({count:100000});
  assert.equal(result.core.window_count,3);
  assert.equal(result.core.event_count,100000);
  assert.equal(result.core.coverage.full_state,true);
  assert.match(result.core.frame_sha256,/^[0-9a-f]{64}$/);
});
test('H5: aggregate CLI report documents limits and validates arguments',async()=>{
  const report=await runR42hGate({count:5000});
  assert.equal(report.status,'ROM_FREE_LAB_GATE_PASS_NATIVE_UNVERIFIED');
  assert.equal(report.scales.length,1);
  assert.equal(report.scales[0].event_count,5000);
  assert.equal(report.million_event_stress_required,false);
  assert.equal(report.github_actions_used,false);
  assert.equal(report.autonomous_cpu_frame_rendered,false);
  assert.equal('raw_events' in report,false);
  await assert.rejects(runR42hGate({count:60000}),/R42H_GATE_ARGUMENT_INVALID/);
});
test('H5: malformed fixture contract cannot produce a fake MAME frame',()=>{
  assert.throws(()=>r42hEvent(0,5000,'MAME_NATIVE'),/R42H_FIXTURE_ARGS_INVALID/);
  assert.throws(()=>r42hEvent(-1,5000),/R42H_FIXTURE_ARGS_INVALID/);
  assert.throws(()=>makeR42hSyntheticTimeline(2),/R42H_EVENT_COUNT_INVALID/);
  const s=makeR42hSeed(),g=makeR42hGraphics();
  assert.equal(s.sprite_ram.length,512);
  assert.equal(g.tiles.length,0x18000);
  assert.equal(s.origin,'LAB_SYNTHETIC');
});
