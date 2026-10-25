/**
 * A0.5.B: replay native-prestate-seeded static JS video stores through the
 * existing board memory into the existing FG/BG tile decoder.
 *
 * Requires a PASS from the independently captured MAME ordered-write gate.
 * Never claims CPU autonomy, DMA, IRQ, bank equivalence or rendered pixels.
 */
import {createGngbBoardMemory} from './gngb_board_memory.mjs';
import {readTile} from './video_memory.mjs';
import {drawOrder} from './sprite_memory.mjs';

const SITES=new Set([0x6041,0x6043,0x6055,0x6057]);
const KEYS=['PC','A','B','X','Y','U','S','DP','CC'];
const VRAM_START=0x2000,VRAM_END=0x2fff,EXPECTED_WRITES=4096;

export function replayNativeVerifiedVideoToBoard({rows,sync,compiledStep,nativeVideoWrites,nativeGate}) {
  if(nativeGate?.status!=='NATIVE_VIDEO_WRITES_MATCH_GENERATED_STATIC_JS'||
      nativeGate.native_segment_uniquely_matched!==true||
      nativeGate.matched_native_video_byte_writes!==EXPECTED_WRITES||
      nativeGate.native_video_writes_before_reset!==0||
      nativeGate.native_video_writes_after_reset!==EXPECTED_WRITES)
    throw Error('A05_NATIVE_A04_BUS_GATE_REQUIRED');
  if(!Array.isArray(nativeVideoWrites)||nativeVideoWrites.length!==EXPECTED_WRITES||
      !Array.isArray(rows)||typeof compiledStep!=='function'||
      sync?.status!=='SYNC_BYTE_AND_WAIT_BARRIER_PREPARED'||
      sync.epochs?.length!==2)
    throw Error('A05_MISSING_PRIVATE_REPLAY_INPUT');
  const start=sync.epochs[1].sync_prestate_seq+1;
  if(rows[start]?.pc!==0x6017)
    throw Error('A05_WRONG_NATIVE_SECOND_EPOCH');

  // Independently construct expected CPU address-space video RAM from MAME
  // write taps, not from the JS generated values.
  const expected=new Uint8Array(0x1000),seen=new Uint8Array(0x1000);
  for(const e of nativeVideoWrites){
    if(!e||!Number.isInteger(e.address)||e.address<VRAM_START||
        e.address>VRAM_END||!Number.isInteger(e.data)||e.data<0||
        e.data>255||e.mask!==255)
      throw Error('A05_INVALID_NATIVE_VIDEO_EVENT');
    const i=e.address-VRAM_START;
    if(seen[i])throw Error('A05_DUPLICATED_OR_MISSING_VRAM_ADDRESS');
    seen[i]=1;expected[i]=e.data;
  }
  if(seen.some(value=>value!==1))
    throw Error('A05_INCOMPLETE_NATIVE_VIDEO_IMAGE');

  const board=createGngbBoardMemory();
  const byPc=new Map([...SITES].map(pc=>[pc,0]));
  let count=0;
  for(let i=start;i+1<rows.length;i++){
    const row=rows[i],next=rows[i+1];
    if(!SITES.has(row?.pc))continue;
    if(row.seq!==i||next.seq!==i+1||row.before?.PC!==row.pc||
       next.before?.PC!==next.pc)
      throw Error('A05_NATIVE_CHECKPOINT_SEQUENCE_INVALID');
    const output=board.stepStatic(compiledStep,row.before);
    if(output.byte_writes!==1||output.writes_by_region.FG_RAM!==1&&
        output.writes_by_region.BG_RAM!==1)
      throw Error('A05_STATIC_STEP_NOT_SINGLE_VIDEO_BYTE');
    if(KEYS.some(key=>output.registers[key]!==next.before[key]))
      throw Error('A05_STATIC_STEP_NATIVE_REGISTER_DIVERGENCE');
    byPc.set(row.pc,byPc.get(row.pc)+1);
    count++;
  }
  if(count!==EXPECTED_WRITES||[...byPc.values()].some(n=>n!==1024))
    throw Error('A05_FOUR_NATIVE_STORE_SITES_INCOMPLETE');

  const snapshot=board.snapshotAddressSpace({requireVideoInitialized:true});
  for(let i=0;i<expected.length;i++){
    if(snapshot[VRAM_START+i]!==expected[i])
      throw Error('A05_BOARD_VIDEO_BYTE_DIFFERS_FROM_NATIVE');
  }
  let tiles=0;
  for(const kind of ['fg','bg'])for(let col=0;col<32;col++)
    for(let row=0;row<32;row++){
      // The renderer's existing decoder consumes the board's RAM layout.
      const decoded=readTile(snapshot,kind,col,row);
      const fromBoard=board.tile(kind,col,row);
      if(decoded.graphic!==fromBoard.graphic||
         decoded.palette!==fromBoard.palette||
         decoded.group!==fromBoard.group||
         decoded.flipX!==fromBoard.flipX||
         decoded.flipY!==fromBoard.flipY||
         decoded.bytes[0]!==fromBoard.bytes[0]||
         decoded.bytes[1]!==fromBoard.bytes[1])
        throw Error('A05_TILE_DECODER_BOARD_MISMATCH');
      tiles++;
    }
  const stats=board.stats();
  if(stats.writes!==EXPECTED_WRITES||
      stats.initialized_ram_bytes!==EXPECTED_WRITES||
      stats.writes_by_region.FG_RAM!==2048||
      stats.writes_by_region.BG_RAM!==2048)
    throw Error('A05_BOARD_MEMORY_INVARIANT_FAILED');
  return {
    schema:'gng.a05.native-video-board-integration.v1',
    status:'NATIVE_VRAM_IMAGE_MATCHED_STATIC_JS_BOARD_AND_TILE_DECODER',
    independently_native_video_writes_verified:EXPECTED_WRITES,
    generated_static_js_video_steps_applied:count,
    native_final_video_ram_bytes_equal_generated_board:EXPECTED_WRITES,
    native_vram_addresses_fully_initialized:true,
    foreground_ram_bytes:stats.writes_by_region.FG_RAM,
    background_ram_bytes:stats.writes_by_region.BG_RAM,
    existing_tile_decoder_records_verified:tiles,
    mame_register_prestates_used_as_individual_step_inputs:true,
    js_cpu_execution_autonomous_from_reset:false,
    pixels_or_frames_rendered_or_compared:false,
    IRQ_SYNC_banked_ROM_sprite_DMA_verified:false,
    game_playable:false,
    rom_or_video_byte_data_exported:false,
    next_task:'Resolve banked ROM and IRQ/SYNC to run compiled CPU continuously; preserve the proven video board memory path'
  };
}

/**
 * R4.2.A2: renderer input snapshot, from already-written CPU video RAM and
 * an explicit, independent DMA sprite buffer. Reuses the existing tile and
 * sprite decoders. This is NOT a rendered frame or autonomous CPU execution.
 */
export function snapshotGngbRendererInputs(board){
  if(!board||typeof board.snapshotAddressSpace!=='function'||
      typeof board.snapshotBufferedSprites!=='function')
    throw Error('R42_RENDERER_BOARD_REQUIRED');
  const videoAddressSpace=board.snapshotAddressSpace({requireVideoInitialized:true});
  const bufferedSprites=board.snapshotBufferedSprites();
  const foregroundTiles=[],backgroundTiles=[];
  for(let row=0;row<32;row++)for(let col=0;col<32;col++){
    foregroundTiles.push(readTile(videoAddressSpace,'fg',col,row));
    backgroundTiles.push(readTile(videoAddressSpace,'bg',col,row));
  }
  return {
    schema:'gng.r42.renderer-input-snapshot.v1',
    videoAddressSpace,
    bufferedSprites,
    foregroundTiles,
    backgroundTiles,
    spriteDrawOrder:drawOrder(bufferedSprites),
    dma_snapshot_explicit:true,
    native_dma_timing_verified:false,
    sprite_buffer_matches_native_mame:false,
    autonomous_cpu_frame_rendered:false,
    game_playable:false
  };
}
