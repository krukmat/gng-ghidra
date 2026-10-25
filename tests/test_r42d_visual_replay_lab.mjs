import test from 'node:test';
import assert from 'node:assert/strict';
import {runR42dLab,visualPage} from '../scripts/r42d_visual_replay_lab.mjs';
test('D6: executable synthetic lab locates first event and delayed visual DMA difference',()=>{
  const {baseline,report}=runR42dLab();
  assert.equal(report.status,'ROM_FREE_REPLAY_AND_DIVERGENCE_LAB_PASS');
  assert.equal(report.checkpoints,5);
  assert.equal(report.events,baseline.event_count);
  assert.equal(report.repeat_comparison.status,'IDENTICAL_SYNTHETIC_REPLAY');
  assert.equal(report.intentional_mutation_comparison.first_frame_divergence.checkpoint_id,
    'second-dma');
  assert.equal(report.native_mame_trace_consumed,false);
  assert.equal(report.autonomous_cpu_frame_rendered,false);
});
test('D6: generated HTML labels synthetic frames and contains five checkpoint canvases',()=>{
  const {baseline,report}=runR42dLab();
  const page=visualPage(baseline,report);
  assert.match(page,/PRUEBA SINTÉTICA. NO ES UNA PANTALLA REAL DEL JUEGO/);
  assert.match(page,/initial-dma/);
  assert.match(page,/second-dma/);
  assert.match(page,/scroll-update/);
  assert.match(page,/createImageData\(256,224\)/);
  assert.doesNotMatch(page,/roms\/gng\.zip/);
});
