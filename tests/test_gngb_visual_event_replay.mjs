import test from 'node:test';
import assert from 'node:assert/strict';
import {makeR42dLabFixture} from '../src/gngb_visual_event_fixture.mjs';
import {replayGngbVisualEvents,compareGngbVisualReplays}
  from '../src/gngb_visual_event_replay.mjs';

const replay=f=>replayGngbVisualEvents(f);
const change=(fixture,predicate,patch)=>{
  const altered={...fixture,events:fixture.events.map(e=>({...e}))};
  const e=altered.events.find(predicate);
  assert.ok(e,'Required fixture event');
  Object.assign(e,patch);return altered;
};
test('D1: strictly sequenced writes, DMA and checkpoints replay deterministically',()=>{
  const f=makeR42dLabFixture(),a=replay(f),b=replay(f);
  assert.equal(a.schema,'gng.r42.visual-replay.v1');
  assert.equal(a.status,'SYNTHETIC_LOGICAL_REPLAY_ONLY');
  assert.equal(a.checkpoint_count,5);
  assert.equal(a.event_count,f.events.length);
  assert.deepEqual(a.checkpoints.map(x=>x.id),
    ['initial-dma','cpu-write-only','second-dma','palette-update','scroll-update']);
  assert.deepEqual(a.checkpoints.map(x=>x.frame_sha256),
    b.checkpoints.map(x=>x.frame_sha256));
  assert.equal(compareGngbVisualReplays(a,b).status,'IDENTICAL_SYNTHETIC_REPLAY');
  assert.equal(a.native_vblank_correlated,false);
  assert.equal(a.native_pixel_equivalence_verified,false);
  assert.equal(a.autonomous_cpu_frame_rendered,false);
});
test('D2/D3: sprite RAM write is invisible until DMA, checkpoint pixels are copies',()=>{
  const a=replay(makeR42dLabFixture());
  const [one,two,three]=a.checkpoints;
  assert.equal(one.frame_sha256,two.frame_sha256);
  assert.notEqual(two.frame_sha256,three.frame_sha256);
  assert.equal(one.buffered_sprite_sha256,two.buffered_sprite_sha256);
  assert.notEqual(two.buffered_sprite_sha256,three.buffered_sprite_sha256);
  const pixels=one.rgba;
  pixels[0]^=255;
  assert.notEqual(pixels[0],one.rgba[0]);
  const buffer=one.buffered_sprites;buffer[3]^=255;
  assert.notEqual(buffer[3],one.buffered_sprites[3]);
  const memory=one.video_ram;memory[0]^=255;
  assert.notEqual(memory[0],one.video_ram[0]);
});
test('D4: palette and scroll checkpoints each create a visible frame difference',()=>{
  const a=replay(makeR42dLabFixture());
  const c=a.checkpoints;
  assert.notEqual(c[2].frame_sha256,c[3].frame_sha256);
  assert.notEqual(c[3].frame_sha256,c[4].frame_sha256);
  assert.deepEqual(c[3].scroll,{x:0,y:0});
  assert.deepEqual(c[4].scroll,{x:16,y:0});
  assert.equal(c[4].rgba.length,229376);
  assert.equal(c[4].palette.length,1024);
  assert.equal(c[4].video_ram.length,4096);
});
test('D5: first changed event and first changed RGBA pixel are reported separately',()=>{
  const fixture=makeR42dLabFixture();
  const a=replay(fixture);
  const changed=change(fixture,e=>e.kind==='WRITE8'&&e.address===0x1e03&&e.value===34,{value:35});
  const b=replay(changed);
  const result=compareGngbVisualReplays(a,b);
  assert.equal(result.status,'SYNTHETIC_REPLAY_DIVERGENCE');
  assert.equal(result.inputs_equal,false);
  assert.equal(result.graphics_equal,true);
  assert.equal(result.frames_equal,false);
  assert.equal(result.first_event_divergence.seq,
    changed.events.findIndex(e=>e.kind==='WRITE8'&&e.address===0x1e03&&e.value===35));
  assert.equal(result.first_frame_divergence.checkpoint_id,'initial-dma');
  assert.equal(result.first_frame_divergence.reason,'RGBA_CHANNEL_DIFFERENCE');
  assert.ok(result.first_frame_divergence.x>=0&&result.first_frame_divergence.x<256);
  assert.ok(result.first_frame_divergence.y>=0&&result.first_frame_divergence.y<224);
  assert.equal(result.native_comparison_performed,false);
});
test('D5: changed irrelevant RAM write does not fabricate a visible divergence',()=>{
  const a=makeR42dLabFixture();
  const b=change(a,e=>e.kind==='WRITE8'&&e.address===0x0100,{value:1});
  const diff=compareGngbVisualReplays(replay(a),replay(b));
  assert.equal(diff.inputs_equal,false);
  assert.equal(diff.frames_equal,true);
  assert.equal(diff.first_frame_divergence,null);
});
test('D5: graphics mismatch is distinguished from identical event streams',()=>{
  const a=makeR42dLabFixture();
  const b={...a,sprites:a.sprites.slice()};
  b.sprites[0]^=0x80; // change an on-screen pixel, leave events identical
  const result=compareGngbVisualReplays(replay(a),replay(b));
  assert.equal(result.first_event_divergence,null);
  assert.equal(result.graphics_equal,false);
  assert.equal(result.status,'SYNTHETIC_REPLAY_DIVERGENCE');
});
test('D5: missing/duplicate/out-of-order checkpoints and fabricated source reject',()=>{
  const f=makeR42dLabFixture();
  const mutate=(fn)=>{const c={...f,events:f.events.map(e=>({...e}))};fn(c.events);return c};
  assert.throws(()=>replay(mutate(e=>e[1].seq=10)),/R42D_EVENT_SEQUENCE_INVALID/);
  assert.throws(()=>replay(mutate(e=>e[1].seq=0)),/R42D_EVENT_SEQUENCE_INVALID/);
  assert.throws(()=>replay(mutate(e=>e.find(x=>x.kind==='CHECKPOINT').id='scroll-update')),
    /R42D_CHECKPOINT_CONTRACT_INVALID/);
  assert.throws(()=>replay(mutate(e=>e[1].surprise=true)),/R42D_EVENT_CONTRACT_INVALID/);
  assert.throws(()=>replay({...f,source:'MAME_NATIVE'}),/R42D_NATIVE_SOURCE_NOT_AUTHENTICATED/);
  assert.throws(()=>replay(mutate(e=>e[0].kind='CPU_OPCODE')),/R42D_EVENT_KIND_UNSUPPORTED/);
});
test('D5: DMA alias cannot bypass trigger; unknown MMIO and invalid bytes rejected',()=>{
  const f=makeR42dLabFixture();
  const mutate=(patch)=>({...f,events:f.events.map((e,i)=>i===0?{...e,...patch}:e)});
  assert.throws(()=>replay(mutate({address:0x3c00})),/R42D_UNSUPPORTED_BUS_WRITE/);
  assert.throws(()=>replay(mutate({address:0x3e00})),/R42D_UNSUPPORTED_BUS_WRITE/);
  assert.throws(()=>replay(mutate({value:256})),/R42D_EVENT_CONTRACT_INVALID/);
  assert.throws(()=>replay(mutate({value:NaN})),/R42D_EVENT_CONTRACT_INVALID/);
  assert.throws(()=>replay(mutate({kind:'DMA',address:0x3c01})),/R42D_DMA_ADDRESS_INVALID/);
});
test('D3: checkpoint before complete VRAM/DMA/palette is explicitly blocked',()=>{
  const f=makeR42dLabFixture();
  const early={...f,events:[
    {seq:0,kind:'CHECKPOINT',id:'premature'},
    ...f.events.map(e=>({...e,seq:e.seq+1}))
  ]};
  assert.throws(()=>replay(early),/UNINITIALIZED_RENDERER_MEMORY|NOT_TRIGGERED|VIDEO_REGISTERS_UNINITIALIZED/);
  const missingDma={...f,events:f.events.filter(e=>e.kind!=='DMA').map((e,seq)=>({...e,seq}))};
  assert.throws(()=>replay(missingDma),/NOT_TRIGGERED/);
  assert.throws(()=>replay({...f,chars:new Uint8Array(1)}),/R42D_GRAPHICS_ASSETS_REQUIRED/);
});
test('D5: malformed comparison input and copied checkpoint ids fail closed',()=>{
  const f=makeR42dLabFixture(),valid=replay(f);
  assert.throws(()=>compareGngbVisualReplays(valid,{}),/R42D_REPLAY_SCHEMA_INVALID/);
  const changed=change(f,e=>e.kind==='CHECKPOINT'&&e.id==='second-dma',{id:'other'});
  const other=replay(changed);
  const diff=compareGngbVisualReplays(valid,other);
  assert.equal(diff.first_frame_divergence.reason,'CHECKPOINT_ID_OR_ORDER');
});
