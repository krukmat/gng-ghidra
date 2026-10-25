/** R4.2.E3: compare R0 snapshot hashes with D's synthetic checkpoint.
 * A match is NOT evidence of matching CPU order, VBlank or raster timing. */
const hash=x=>typeof x==='string'&&/^[0-9a-f]{64}$/.test(x);
const int=x=>Number.isInteger(x)&&x>=0&&x<=65535;
export function compareR42eCheckpoint({reference,labReport,checkpointId}){
  if(reference?.schema!=='gng.r42e.reference-integrity.v1'||
     reference.status!=='REFERENCE_BYTES_MATCH_MANIFEST_ORIGIN_UNATTESTED'||
     reference.independent_capture_attested!==false||
     reference.native_event_timeline_available!==false)
    throw Error('R42E_REFERENCE_GATE_REQUIRED');
  if(labReport?.schema!=='gng.r42.visual-lab-report.v1'||
     labReport.status!=='ROM_FREE_REPLAY_AND_DIVERGENCE_LAB_PASS'||
     labReport.native_mame_trace_consumed!==false||
     labReport.native_vblank_correlated!==false||
     labReport.native_pixel_equivalence_verified!==false||
     labReport.autonomous_cpu_frame_rendered!==false||
     labReport.game_playable!==false||
     !Array.isArray(labReport.frames)||
     labReport.frames.length!==labReport.checkpoints)
    throw Error('R42E_ONLY_SYNTHETIC_LAB_REPORT_ACCEPTED');
  if(typeof checkpointId!=='string'||checkpointId.length===0)
    throw Error('R42E_CHECKPOINT_ID_REQUIRED');
  const rows=labReport.frames.filter(x=>x?.id===checkpointId);
  if(rows.length!==1)throw Error('R42E_CHECKPOINT_NOT_UNIQUE_OR_MISSING');
  const cp=rows[0];
  if(![cp.frame_sha256,cp.video_ram_sha256,cp.buffered_sprite_sha256,
    cp.palette_sha256].every(hash)||!int(cp.scroll?.x)||!int(cp.scroll?.y))
    throw Error('R42E_CHECKPOINT_CONTENT_INVALID');
  const matching=Object.freeze({
    video_ram:cp.video_ram_sha256===reference.video_ram_sha256,
    sprite_dma:cp.buffered_sprite_sha256===reference.buffered_sprite_sha256,
    palette:cp.palette_sha256===reference.palette_sha256,
    scroll_x:cp.scroll.x===reference.scroll.x,
    scroll_y:cp.scroll.y===reference.scroll.y
  });
  const mismatched=Object.keys(matching).filter(key=>!matching[key]);
  return Object.freeze({
    schema:'gng.r42e.snapshot-correlation.v1',
    status:mismatched.length?'SNAPSHOT_COMPONENT_MISMATCH':
      'SNAPSHOT_COMPONENTS_MATCH_TEMPORAL_PROOF_MISSING',
    checkpoint_id:checkpointId,claimed_native_frame:reference.frame,
    matching_components:matching,differing_components:Object.freeze(mismatched),
    native_events_compared:false,png_pixels_compared:false,
    origin_cryptographically_attested:false,
    native_timing_equivalence_verified:false,
    native_pixel_equivalence_verified:false,autonomous_cpu_frame_rendered:false
  });
}
