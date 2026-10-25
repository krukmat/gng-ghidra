/**
 * R4.2.B: connect A0.5.B/A1 board snapshots to the *same* compositor used
 * by the R1 MAME reference browser page. Never use uncopied CPU sprite RAM.
 * No invented ROM assets, palette, scroll or autonomy flags.
 */
import {snapshotGngbRendererInputs} from './gngb_video_bridge.mjs';
import {renderGngbRgba} from './gngb_frame_renderer.mjs';

export function renderGngbBoardFrame({board,chars,tiles,sprites,palette,scroll}){
  const snapshot=snapshotGngbRendererInputs(board);
  // Default path takes palette and scroll exclusively from board MMIO.
  // Paired explicit inputs are retained for legacy R4.2.B laboratory
  // fixtures, and always labelled as external (never as board-derived).
  const explicit=palette!==undefined||scroll!==undefined;
  if(explicit && (palette===undefined||scroll===undefined))
    throw Error('R42_INCOMPLETE_EXTERNAL_VIDEO_STATE');
  if(!explicit){
    if(typeof board.snapshotVideoRegisters!=='function')
      throw Error('R42_VIDEO_BOARD_REQUIRED');
    ({palette,scroll}=board.snapshotVideoRegisters());
  }
  const pixels=renderGngbRgba({
    videoAddressSpace:snapshot.videoAddressSpace,
    bufferedSprites:snapshot.bufferedSprites,
    chars,tiles,sprites,palette,scroll
  });
  return {
    ...pixels,
    schema:'gng.r42.board-frame-pipeline.v1',
    source:'BOARD_VRAM_AND_EXPLICIT_DMA_BUFFER',
    video_state_source:explicit?'EXPLICIT_LAB_OR_REFERENCE':'BOARD_MMIO',
    scroll_and_palette_board_derived:!explicit,
    sprite_dma_observed_on_synthetic_board:true,
    original_game_logic_running:false,
    native_dma_timing_verified:false,
    native_pixel_equivalence_verified:false,
    autonomous_cpu_frame_rendered:false,
    game_playable:false
  };
}
