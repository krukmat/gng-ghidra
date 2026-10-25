/**
 * R4.2.H end-to-end ROM-free F-shaped stream -> G board -> shared renderer.
 *
 * Synthetic laboratory event generator only; never a MAME capture.
 * No private game assets, exact CPU timing, VBlank or native proof.
 *
 * Generator is replayable; it makes two passes (SHA then validation) without
 * buffering an unbounded event array. The G core owns the actual board.
 */
import {createHash} from 'node:crypto';
import {createGngbBoardMemory} from './gngb_board_memory.mjs';
import {renderGngbBoardFrame} from './gngb_frame_pipeline.mjs';
import {r42gBootstrapDigest,replayR42gTimeline}
  from './r42g_incremental_timeline.mjs';

const SHA=v=>createHash('sha256').update(v).digest('hex');
const COUNTS=Object.freeze([5000,40001,100000]);
const sourceLabel='SYNTHETIC_F_FORMAT_TEST_NOT_MAME';
const spriteY=variant=>variant==='MUTATED'?74:34;
export const R42H_SIZES=COUNTS;
export function makeR42hSeed(){
  const seed={
    schema:'gng.r42g.bootstrap.v1',origin:'LAB_SYNTHETIC',
    sprite_ram:new Uint8Array(512).fill(0xf8),
    video_ram:new Uint8Array(4096),
    palette_ext:new Uint8Array(256),
    palette_base:new Uint8Array(256),
    scroll_bytes:new Uint8Array(4),
  };
  seed.sprite_ram.set([0,0,82,34],0);
  // Pixel palette: nonzero values for opaque sprites and background.
  for(let i=0;i<256;i++){
    seed.palette_ext[i]=((i&15)<<4)|((i>>4)&15);
    seed.palette_base[i]=((i>>4)&15)<<4;
  }
  seed.video_ram[0x821]=1;
  seed.sha256=r42gBootstrapDigest(seed);
  return seed;
}
export function makeR42hGraphics(){
  const chars=new Uint8Array(0x4000);chars.fill(255);
  const tiles=new Uint8Array(0x18000);
  tiles.fill(255,32,64);tiles.fill(255,0x8000+32,0x8000+64);
  tiles.fill(255,0x10000+32,0x10000+64);
  const sprites=new Uint8Array(0x20000);sprites.fill(255);
  sprites.fill(0,0,64);sprites.fill(0,0x10000,0x10040);
  return {chars,tiles,sprites};
}
/** Only one event is intentionally mutated: first sprite position write. */
export function r42hEvent(seq,count,variant='BASELINE'){
  if(!Number.isSafeInteger(count)||count<3||count>1000000||
     !Number.isSafeInteger(seq)||seq<0||seq>=count||
     !['BASELINE','MUTATED','POST_DMA_WRITE'].includes(variant))
    throw Error('R42H_FIXTURE_ARGS_INVALID');
  const state={seq,frame:600,emu_seconds:(seq+1)/1000000,
    raster_vpos:null,raster_hpos:null,raster_unobserved:true};
  if(seq===count-1)
    return {...state,kind:'CHECKPOINT',address:null,data:null,mask:null};
  if(seq===1)
    return {...state,kind:'DMA',address:0x3c00,data:0,mask:255};
  if(seq===0)
    return {...state,kind:'WRITE8',address:0x1e03,
      data:variant==='MUTATED'?spriteY(variant):spriteY('BASELINE'),mask:255};
  if(seq===2&&variant==='POST_DMA_WRITE')
    return {...state,kind:'WRITE8',address:0x1e03,data:74,mask:255};
  return {...state,kind:'WRITE8',address:0x2000+(seq%4096),
    data:(seq*3)&255,mask:255};
}
export function r42hLine(seq,count,variant='BASELINE'){
  return Buffer.from(JSON.stringify(r42hEvent(seq,count,variant))+'\n','utf8');
}
export function makeR42hSyntheticTimeline(count,variant='BASELINE'){
  if(!Number.isSafeInteger(count)||count<3||count>1000000)
    throw Error('R42H_EVENT_COUNT_INVALID');
  const h=createHash('sha256');
  for(let i=0;i<count;i++)h.update(r42hLine(i,count,variant));
  return {
    schema:'gng.r42f.native-timeline-validation.v1',
    status:'STRUCTURAL_TIMELINE_VERIFIED_ORIGIN_UNATTESTED',
    source:'MAME_LUA_WRITE_TAP_CLAIM_UNATTESTED',
    run_id:'0'.repeat(32),driver:'gngb',target_frame:600,last_frame:600,
    events:count,writes:count-2,dma:1,checkpoints:1,
    jsonl_sha256:h.digest('hex'),metadata_sha256:'1'.repeat(64),
    coverage:'POST_AUTOBOOT_TAP_INSTALL_ONLY',
    raster_precision:'UNAVAILABLE_LUA_DOCUMENTED_API',
    instruction_alignment_verified:false,bank_identity_verified:false,
    native_vblank_alignment_verified:false,native_pixel_equivalence_verified:false,
  };
}
export async function* r42hLines(count,variant='BASELINE'){
  for(let i=0;i<count;i++)yield r42hLine(i,count,variant);
}
function setupBoard(seed){
  const board=createGngbBoardMemory();
  const maps=[['sprite_ram',0x1e00],['video_ram',0x2000],
    ['palette_ext',0x3800],['palette_base',0x3900],['scroll_bytes',0x3b08]];
  for(const [name,base] of maps)
    for(let i=0;i<seed[name].length;i++)board.write8(base+i,seed[name][i]);
  return board;
}
function modelSyntheticEndpoint(count,variant,seed,graphics){
  // Independent laboratory endpoint for pixel/byte difference localization.
  // G's own frame hash MUST match, or the harness aborts as diverged.
  const board=setupBoard(seed);
  for(let i=0;i<count-1;i++){
    const e=r42hEvent(i,count,variant);
    board.write8(e.address,e.data);
  }
  const rgba=renderGngbBoardFrame({board,...graphics}).rgba;
  const ram=board.snapshotAddressSpace({requireVideoInitialized:true});
  return {
    frame_sha256:SHA(rgba),rgba,
    video:ram.slice(0x2000,0x3000),
    sprite:board.snapshotBufferedSprites(),
    palette:board.snapshotVideoRegisters().palette,
    scroll:board.snapshotVideoRegisters().scroll,
  };
}
function firstDifference(before,after){
  for(let i=0;i<before.length;i++){
    if(before[i]!==after[i])return i;
  }
  return null;
}
export function compareR42hEndpoints(a,b){
  if(a.count!==b.count)
    throw Error('R42H_INCOMPARABLE_EVENT_LENGTHS');
  let firstEvent=null;
  for(let seq=0;seq<a.count;seq++){
    const left=r42hEvent(seq,a.count,a.variant);
    const right=r42hEvent(seq,b.count,b.variant);
    if(left.kind!==right.kind||left.address!==right.address||
       left.data!==right.data||left.mask!==right.mask||
       left.frame!==right.frame||left.emu_seconds!==right.emu_seconds){
      firstEvent=seq;
      break;
    }
  }
  const regions=[
    ['VIDEO_RAM',a.snapshot.video,b.snapshot.video,0x2000],
    ['SPRITE_DMA',a.snapshot.sprite,b.snapshot.sprite,0x1e00],
    ['PALETTE',a.snapshot.palette,b.snapshot.palette,null],
  ];
  let firstByte=null;
  for(const [region,x,y,base] of regions){
    const i=firstDifference(x,y);
    if(i!==null){
      firstByte={region,byte_offset:i,address:base===null?null:base+i};
      break;
    }
  }
  const pixelOffset=firstDifference(a.snapshot.rgba,b.snapshot.rgba);
  const firstPixel=pixelOffset===null?null:{
    x:Math.floor(pixelOffset/4)%256,
    y:Math.floor(Math.floor(pixelOffset/4)/256),
    channel:['R','G','B','A'][pixelOffset%4],
  };
  const components={
    video_ram:a.core.components.video_ram_sha256===b.core.components.video_ram_sha256,
    buffered_sprite:a.core.components.buffered_sprite_sha256===
      b.core.components.buffered_sprite_sha256,
    palette:a.core.components.palette_sha256===b.core.components.palette_sha256,
    scroll:a.core.components.scroll.x===b.core.components.scroll.x&&
      a.core.components.scroll.y===b.core.components.scroll.y,
    pixels:a.core.frame_sha256===b.core.frame_sha256,
  };
  return {
    first_event_seq:firstEvent,
    first_byte_divergence:firstByte,
    first_pixel_divergence:firstPixel,
    equal_components:components,
    explanation:firstByte?.region==='SPRITE_DMA'?'SPRITE_DMA_VISIBLE_MUTATION':
      firstEvent!==null&&firstByte===null?'INPUT_CHANGED_WITHOUT_VISIBLE_STATE_CHANGE':
      firstByte===null?'IDENTICAL_LAB_RUN':'LAB_COMPONENT_DIVERGENCE',
    native_correlation_verified:false
  };
}
/** Real end-to-end G invocation. Only synthetic F-shaped lines are used. */
export async function runR42hCase({count=5000,variant='BASELINE',graphics,seed}={}){
  if(!['BASELINE','MUTATED','POST_DMA_WRITE'].includes(variant))
    throw Error('R42H_VARIANT_INVALID');
  seed=seed??makeR42hSeed();
  graphics=graphics??makeR42hGraphics();
  const timeline=makeR42hSyntheticTimeline(count,variant);
  const core=await replayR42gTimeline({
    rawLines:r42hLines(count,variant),timeline,bootstrap:seed,graphics
  });
  if(core.status!=='STATE_REPLAYED_TEMPORAL_PROOF_MISSING'||
     core.native_origin_attested!==false||!core.frame_sha256)
    throw Error('R42H_REPLAY_UNEXPECTED_STATE');
  const snapshot=modelSyntheticEndpoint(count,variant,seed,graphics);
  if(snapshot.frame_sha256!==core.frame_sha256||
     SHA(snapshot.video)!==core.components.video_ram_sha256||
     SHA(snapshot.sprite)!==core.components.buffered_sprite_sha256||
     SHA(snapshot.palette)!==core.components.palette_sha256)
    throw Error('R42H_BOARD_RENDERER_G_REPLAY_MISMATCH');
  return {count,variant,source:sourceLabel,core,snapshot};
}
export async function runR42hDiagnostic({count=5000}={}){
  const seed=makeR42hSeed(),graphics=makeR42hGraphics();
  const baseline=await runR42hCase({count,variant:'BASELINE',seed,graphics});
  const repeat=await runR42hCase({count,variant:'BASELINE',seed,graphics});
  const mutant=await runR42hCase({count,variant:'MUTATED',seed,graphics});
  const afterDma=await runR42hCase({count,variant:'POST_DMA_WRITE',seed,graphics});
  if(baseline.core.frame_sha256!==repeat.core.frame_sha256)
    throw Error('R42H_NONDETERMINISTIC_REPLAY');
  const changed=compareR42hEndpoints(baseline,mutant);
  const frozen=compareR42hEndpoints(baseline,afterDma);
  if(!changed.first_pixel_divergence||
     changed.first_event_seq!==0||
     changed.first_byte_divergence?.region!=='SPRITE_DMA'||
     !frozen.equal_components.pixels||
     frozen.first_event_seq!==2)
    throw Error('R42H_DIAGNOSTIC_INVARIANT_FAILED');
  return {
    schema:'gng.r42h.romfree-gate.v1',
    status:'SYNTHETIC_E2E_DIAGNOSTIC_PASS',
    source:sourceLabel,
    event_count:count,window_count:baseline.core.window_count,
    original_frame_sha256:baseline.core.frame_sha256,
    variant_frame_sha256:mutant.core.frame_sha256,
    repeat_identical:true,
    changed,post_dma_write:frozen,
    native_mame_executed:false,native_timing_verified:false,
    native_pixel_equivalence_verified:false,autonomous_cpu_frame_rendered:false
  };
}
