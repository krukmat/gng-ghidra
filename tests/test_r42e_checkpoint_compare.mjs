import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyR42eSnapshot} from '../src/r42e_snapshot_integrity.mjs';
import {compareR42eCheckpoint} from '../src/r42e_checkpoint_compare.mjs';
import {makeR42eReference,makeR42eLabReport} from './r42e_fixture.mjs';
const pair=()=>{
  const reference=verifyR42eSnapshot(makeR42eReference());
  const labReport=makeR42eLabReport(reference);
  return {reference,labReport,checkpointId:'synthetic-test'};
};
test('E3 complete snapshot match still explicitly refuses temporal/native PASS',()=>{
  const result=compareR42eCheckpoint(pair());
  assert.equal(result.status,'SNAPSHOT_COMPONENTS_MATCH_TEMPORAL_PROOF_MISSING');
  assert.deepEqual(result.differing_components,[]);
  assert.equal(result.native_events_compared,false);
  assert.equal(result.origin_cryptographically_attested,false);
  assert.equal(result.native_timing_equivalence_verified,false);
  assert.equal(result.png_pixels_compared,false);
});
test('E3 unequal sprite DMA/palette/scroll are differentiated',()=>{
  const x=pair();x.labReport.frames[0].buffered_sprite_sha256='0'.repeat(64);
  x.labReport.frames[0].palette_sha256='0'.repeat(64);
  x.labReport.frames[0].scroll.x++;
  const result=compareR42eCheckpoint(x);
  assert.equal(result.status,'SNAPSHOT_COMPONENT_MISMATCH');
  assert.deepEqual(result.differing_components,['sprite_dma','palette','scroll_x']);
  assert.equal(result.matching_components.video_ram,true);
});
test('E3 rejects missing or repeated checkpoint IDs',()=>{
  const x=pair();x.checkpointId='unknown';
  assert.throws(()=>compareR42eCheckpoint(x),/NOT_UNIQUE_OR_MISSING/);
  const y=pair();y.labReport.frames.push({...y.labReport.frames[0]});
  y.labReport.checkpoints=2;
  assert.throws(()=>compareR42eCheckpoint(y),/NOT_UNIQUE_OR_MISSING/);
});
test('E3 rejects candidate with fabricated native provenance',()=>{
  for(const flag of ['native_mame_trace_consumed','native_vblank_correlated',
    'native_pixel_equivalence_verified','autonomous_cpu_frame_rendered','game_playable']){
    const x=pair();x.labReport[flag]=true;
    assert.throws(()=>compareR42eCheckpoint(x),/ONLY_SYNTHETIC_LAB_REPORT_ACCEPTED/);
  }
});
test('E3 rejects forged schema, digest, scroll or native attestation',()=>{
  const x=pair();x.reference={...x.reference,independent_capture_attested:true};
  assert.throws(()=>compareR42eCheckpoint(x),/REFERENCE_GATE_REQUIRED/);
  const y=pair();y.labReport.frames[0].palette_sha256='bad';
  assert.throws(()=>compareR42eCheckpoint(y),/CHECKPOINT_CONTENT_INVALID/);
  const z=pair();z.labReport.frames[0].scroll.x=-1;
  assert.throws(()=>compareR42eCheckpoint(z),/CHECKPOINT_CONTENT_INVALID/);
});
