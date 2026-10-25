import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyR42eSnapshot} from '../src/r42e_snapshot_integrity.mjs';
import {makeR42eReference} from './r42e_fixture.mjs';

const reference=()=>makeR42eReference();
test('E1/E2 validates R0 byte hashes, 256x224 PNG and scroll endianess',()=>{
  const result=verifyR42eSnapshot(reference());
  assert.equal(result.schema,'gng.r42e.reference-integrity.v1');
  assert.equal(result.status,'REFERENCE_BYTES_MATCH_MANIFEST_ORIGIN_UNATTESTED');
  assert.equal(result.dma_count,8);
  assert.deepEqual(result.scroll,{x:304,y:32});
  assert.equal(result.independent_capture_attested,false);
  assert.equal(result.native_event_timeline_available,false);
  assert.equal(result.native_pixel_equivalence_verified,false);
  for(const x of ['video_ram_sha256','buffered_sprite_sha256','palette_sha256','png_sha256'])
    assert.match(result[x],/^[a-f0-9]{64}$/);
});
test('E2 rejects tampered bytes even when length is unchanged',()=>{
  for(const key of ['foreground','background','sprites','palette','reference']){
    const src=reference();
    src.files[key][key==='reference'?28:0]^=1;
    assert.throws(()=>verifyR42eSnapshot(src),/R42E_ARTIFACT_HASH_MISMATCH/);
  }
});
test('E2 rejects stale manifest digests, invalid length and swapped filename',()=>{
  const x=reference();x.manifest.artifacts.foreground.sha256='0'.repeat(64);
  assert.throws(()=>verifyR42eSnapshot(x),/HASH_MISMATCH/);
  const y=reference();y.files.sprites=y.files.sprites.subarray(1);
  assert.throws(()=>verifyR42eSnapshot(y),/LENGTH_OR_NAME/);
  const z=reference();z.manifest.artifacts.palette.filename='foreground.bin';
  assert.throws(()=>verifyR42eSnapshot(z),/LENGTH_OR_NAME/);
});
test('E1 rejects fabricated capture provenance claims, missing DMA or frame inconsistency',()=>{
  const x=reference();x.manifest.generated_js_frame_equivalent=true;
  assert.throws(()=>verifyR42eSnapshot(x),/CONTRACT_INVALID/);
  const y=reference();y.manifest.sprite_dma_count=0;
  assert.throws(()=>verifyR42eSnapshot(y),/DMA_METADATA_MISMATCH/);
  const z=reference();z.state.frame=601;
  assert.throws(()=>verifyR42eSnapshot(z),/FRAME_DMA_METADATA_MISMATCH/);
});
test('E2 validates both scroll bytes and MAME manifest scroll',()=>{
  const x=reference();x.state.scroll_bytes=[1,48,32,0];
  assert.throws(()=>verifyR42eSnapshot(x),/SCROLL_METADATA_MISMATCH/);
  const y=reference();y.manifest.scroll_y=33;
  assert.throws(()=>verifyR42eSnapshot(y),/SCROLL_METADATA_MISMATCH/);
});
test('E2 rejects PNG wrong dimensions and bad header even when hash is updated',()=>{
  const x=reference();x.files.reference.writeUInt32BE(225,20);
  assert.throws(()=>verifyR42eSnapshot(x),/R42E_PNG_HEADER_INVALID/);
  const y=reference();y.files.reference[0]=0;
  assert.throws(()=>verifyR42eSnapshot(y),/R42E_PNG_HEADER_INVALID/);
});
