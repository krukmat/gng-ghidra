import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {r42gBootstrapDigest,mapR42fVideoEvent,replayR42gTimeline}
  from '../src/r42g_incremental_timeline.mjs';

function seed(){
  const s={
    schema:'gng.r42g.bootstrap.v1',origin:'LAB_SYNTHETIC',
    sprite_ram:new Uint8Array(512).fill(0xf8),
    video_ram:new Uint8Array(4096),
    palette_ext:new Uint8Array(256),
    palette_base:new Uint8Array(256),
    scroll_bytes:new Uint8Array(4),
  };
  // Make sprite0 visible after DMA. No data is attributed to MAME.
  s.sprite_ram[0]=0;s.sprite_ram[1]=0;s.sprite_ram[2]=82;s.sprite_ram[3]=34;
  s.sha256=r42gBootstrapDigest(s);
  return s;
}
function makeEvent(seq,kind,address=null,data=null,frame=600,time=null){
  return {seq,kind,frame,emu_seconds:time??seq/10000,
    raster_vpos:null,raster_hpos:null,raster_unobserved:true,
    address,data,mask:kind==='CHECKPOINT'?null:255};
}
function makeTrace(steps){
  const events=steps.map(([kind,address,data],i)=>makeEvent(i,kind,address??null,data??null));
  const lines=events.map(x=>Buffer.from(JSON.stringify(x)+'\n'));
  const hash=createHash('sha256').update(Buffer.concat(lines)).digest('hex');
  const t={
    schema:'gng.r42f.native-timeline-validation.v1',
    status:'STRUCTURAL_TIMELINE_VERIFIED_ORIGIN_UNATTESTED',
    source:'MAME_LUA_WRITE_TAP_CLAIM_UNATTESTED',
    run_id:'0'.repeat(32),driver:'gngb',target_frame:600,last_frame:600,
    events:events.length,writes:events.filter(e=>e.kind==='WRITE8').length,
    dma:events.filter(e=>e.kind==='DMA').length,checkpoints:1,
    jsonl_sha256:hash,metadata_sha256:'1'.repeat(64),
    coverage:'POST_AUTOBOOT_TAP_INSTALL_ONLY',
    raster_precision:'UNAVAILABLE_LUA_DOCUMENTED_API',
    instruction_alignment_verified:false,bank_identity_verified:false,
    native_vblank_alignment_verified:false,native_pixel_equivalence_verified:false,
  };
  return {events,lines,timeline:t};
}
const replay=(trace,more={})=>replayR42gTimeline({
  rawLines:trace.lines,timeline:trace.timeline,...more
});
const minimal=()=>makeTrace([['DMA',0x3c00,0],['CHECKPOINT']]);
test('G2: explicit, checksum-bound bootstrap enables state without false provenance',async()=>{
  const s=seed(),r=await replay(minimal(),{bootstrap:s});
  assert.equal(r.status,'STATE_REPLAYED_TEMPORAL_PROOF_MISSING');
  assert.equal(r.bootstrap_origin,'LAB_SYNTHETIC');
  assert.equal(r.coverage.full_state,true);
  assert.equal(r.coverage.video_ram,4096);
  assert.equal(r.coverage.palette_base,256);
  assert.match(r.components.video_ram_sha256,/^[0-9a-f]{64}$/);
  assert.equal(r.native_origin_attested,false);
  assert.equal(r.native_raster_vblank_verified,false);
  assert.equal(r.native_pixel_equivalence_verified,false);
});
test('G2: tampered/missing bootstrap regions and forged origins reject',async()=>{
  const t=minimal(),s=seed();
  s.video_ram[0]^=1;
  await assert.rejects(replay(t,{bootstrap:s}),/R42G_BOOTSTRAP_DIGEST_MISMATCH/);
  const noByte=seed();noByte.sprite_ram=new Uint8Array(511);
  await assert.rejects(replay(t,{bootstrap:noByte}),/R42G_BOOTSTRAP_REGION_INCOMPLETE/);
  const native=seed();native.origin='MAME_VERIFIED';
  await assert.rejects(replay(t,{bootstrap:native}),/R42G_BOOTSTRAP_PROVENANCE_INVALID/);
});
test('G2: missing pre-tap DMA input fails, missing video state reports coverage',async()=>{
  const t=minimal();
  await assert.rejects(replay(t),/R42G_DMA_SOURCE_MISSING_PRETAP_BYTES/);
  const writes=[];
  for(let i=0;i<512;i++)writes.push(['WRITE8',0x1e00+i,0xf8]);
  writes.push(['DMA',0x3c00,0],['CHECKPOINT']);
  const partial=await replay(makeTrace(writes));
  assert.equal(partial.status,'BLOCKED_PRETAP_INITIAL_STATE_INCOMPLETE');
  assert.equal(partial.coverage.sprite_ram,512);
  assert.equal(partial.coverage.video_ram,0);
  assert.equal(partial.coverage.palette_ext,0);
  assert.equal(partial.components,null);
  assert.equal(partial.frame_sha256,null);
});
test('G3: complete observed writes avoid any initial-state injection',async()=>{
  const writes=[];
  for(let i=0;i<512;i++)writes.push(['WRITE8',0x1e00+i,0xf8]);
  for(let i=0;i<4096;i++)writes.push(['WRITE8',0x2000+i,0]);
  for(let i=0;i<256;i++){
    writes.push(['WRITE8',0x3800+i,0]);
    writes.push(['WRITE8',0x3900+i,0]);
  }
  for(let i=0;i<4;i++)writes.push(['WRITE8',0x3b08+i,0]);
  writes.push(['DMA',0x3c00,0],['CHECKPOINT']);
  const r=await replay(makeTrace(writes));
  assert.equal(r.bootstrap_origin,'NONE');
  assert.equal(r.status,'STATE_REPLAYED_TEMPORAL_PROOF_MISSING');
  assert.equal(r.event_count,5126);
  assert.equal(r.window_count,1);
});
test('G3: 40K+ events retain state and one uninterrupted global sequence',async()=>{
  const writes=Array.from({length:40019},(_,i)=>['WRITE8',0x2000,i&255]);
  writes.push(['DMA',0x3c00,0],['CHECKPOINT']);
  const s=seed(),a=await replay(makeTrace(writes),{bootstrap:s});
  assert.equal(a.window_count,2);
  assert.equal(a.window_size,40000);
  assert.equal(a.event_count,40021);
  assert.equal(a.coverage.full_state,true);
  assert.notEqual(a.components.video_ram_sha256,createHash('sha256').update(s.video_ram).digest('hex'));
});
test('G3: rejected gaps, clock regressions, invalid address and masks',async()=>{
  const original=minimal(),s=seed();
  for(const patch of [
    {seq:1},{emu_seconds:-1},{raster_vpos:10},{raster_unobserved:false},
    {mask:254},{address:0x3c01},{address:0x3e00},
  ]){
    const t=makeTrace([['WRITE8',0x2000,1],['DMA',0x3c00,0],['CHECKPOINT']]);
    Object.assign(t.events[0],patch);
    t.lines=t.events.map(e=>Buffer.from(JSON.stringify(e)+'\n'));
    // Correct digest: the rejection must be structural, not a hash shortcut.
    t.timeline.jsonl_sha256=createHash('sha256').update(Buffer.concat(t.lines)).digest('hex');
    await assert.rejects(replay(t,{bootstrap:s}),/R42G_/);
  }
  assert.equal(original.timeline.dma,1);
});
test('G3: truncation, wrong stream hash, extra events and missing final checkpoint reject',async()=>{
  const s=seed();
  const x=minimal();x.lines[0]=Buffer.from(x.lines[0].toString().slice(0,-1));
  await assert.rejects(replay(x,{bootstrap:s}),/R42G_LINE_BOUNDARY_OR_SIZE_INVALID/);
  const y=minimal();y.lines[0]=Buffer.from(y.lines[0].toString().replace('"data":0','"data":1')+'');
  await assert.rejects(replay(y,{bootstrap:s}),/R42G_TRACE_OR_DIGEST_MISMATCH/);
  const z=minimal();z.lines.push(z.lines[1]);
  await assert.rejects(replay(z,{bootstrap:s}),/R42G_EVENT_COUNT_EXCEEDED/);
  const noCP=minimal();noCP.lines.pop();
  await assert.rejects(replay(noCP,{bootstrap:s}),/R42G_TRACE_OR_DIGEST_MISMATCH/);
});
test('G4: compare component hashes only, no pixel/timing equivalence claim',async()=>{
  const s=seed(),t=minimal(),first=await replay(t,{bootstrap:s});
  const ref={
    schema:'gng.r42e.reference-integrity.v1',
    status:'REFERENCE_BYTES_MATCH_MANIFEST_ORIGIN_UNATTESTED',
    independent_capture_attested:false,
    native_event_timeline_available:false,
    video_ram_sha256:first.components.video_ram_sha256,
    buffered_sprite_sha256:first.components.buffered_sprite_sha256,
    palette_sha256:first.components.palette_sha256,
    scroll:{...first.components.scroll}
  };
  const equal=await replay(t,{bootstrap:s,reference:ref});
  assert.equal(equal.reference_comparison.status,'COMPONENTS_EQUAL_TEMPORAL_ALIGNMENT_UNVERIFIED');
  assert.equal(equal.reference_comparison.pixels_compared,false);
  assert.equal(equal.reference_comparison.timing_proven,false);
  ref.palette_sha256='f'.repeat(64);
  const diff=await replay(t,{bootstrap:s,reference:ref});
  assert.deepEqual(diff.reference_comparison.differing,['palette']);
});
test('G4: optional synthetic graphics allow pixels only after full state',async()=>{
  const graphics={
    chars:new Uint8Array(0x4000).fill(255),
    tiles:new Uint8Array(0x18000),
    sprites:new Uint8Array(0x20000).fill(255)
  };
  const s=seed();
  const a=await replay(minimal(),{bootstrap:s,graphics});
  assert.match(a.frame_sha256,/^[0-9a-f]{64}$/);
  assert.equal(a.game_playable,false);
  const writes=Array.from({length:512},(_,i)=>['WRITE8',0x1e00+i,0xf8]);
  const missing=makeTrace([...writes,['DMA',0x3c00,0],['CHECKPOINT']]);
  const b=await replay(missing,{graphics});
  assert.equal(b.frame_sha256,null);
});
test('G1/G3: translated event retains frame and time; refuses invented raster',()=>{
  const a=mapR42fVideoEvent(makeEvent(0,'WRITE8',0x2800,40),0,{frame:-1,time:-1});
  assert.deepEqual([a.kind,a.address,a.value,a.frame],['WRITE8',0x2800,40,600]);
  assert.throws(()=>mapR42fVideoEvent({...makeEvent(0,'DMA',0x3c00,3),raster_hpos:2},0,
    {frame:-1,time:-1}),/R42G_EVENT_ENVELOPE_OR_ORDER_INVALID/);
});
