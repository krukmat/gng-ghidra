import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createGngbBoardMemory} from '../src/gngb_board_memory.mjs';
import {snapshotGngbRendererInputs} from '../src/gngb_video_bridge.mjs';
import {spriteFromBuffer,drawOrder} from '../src/sprite_memory.mjs';
import {readTile} from '../src/video_memory.mjs';

const cpu={PC:0x6000,A:0,B:0,X:0,Y:0,U:0,S:0x2000,DP:0,CC:0};
function fillSprites(board){
  for(let a=0x1e00;a<0x2000;a++)board.write8(a,0xf8);
  board.write8(0x1e00,0x21);board.write8(0x1e01,0);
  board.write8(0x1e02,80);board.write8(0x1e03,60);
  board.write8(0x1e04,0x22);board.write8(0x1e05,0);
  board.write8(0x1e06,81);board.write8(0x1e07,61);
}
function fillVideo(board){
  for(let a=0x2000;a<0x3000;a++)board.write8(a,a&255);
}
test('0x3c00 latches 512 CPU sprite bytes without aliasing CPU RAM',()=>{
  const board=createGngbBoardMemory();
  assert.throws(()=>board.snapshotBufferedSprites(),/NOT_TRIGGERED/);
  assert.throws(()=>board.write8(0x3c00,0),/SOURCE_INCOMPLETE/);
  fillSprites(board);
  board.write8(0x3c00,0xff);
  assert.equal(board.stats().sprite_dma_buffer_bytes,512);
  assert.equal(board.stats().sprite_dma_transfers,1);
  assert.equal(board.stats().writes_by_region.SPRITE_RAM,520);
  assert.equal(board.stats().writes,520); // MMIO is NOT a RAM write.
  assert.deepEqual(board.bufferedSpriteDrawOrder().map(s=>s.slot),[1,0]);
  const first=board.snapshotBufferedSprites();
  board.write8(0x1e03,100);
  assert.equal(spriteFromBuffer(board.snapshotBufferedSprites(),0).x,60);
  first[3]=1;
  assert.equal(board.snapshotBufferedSprites()[3],60);
  board.write8(0x3c00,0);
  assert.equal(spriteFromBuffer(board.snapshotBufferedSprites(),0).x,100);
  assert.equal(board.stats().sprite_dma_transfers,2);
});
test('compiled MMIO store is one atomic DMA effect after a valid returned CPU state',()=>{
  const board=createGngbBoardMemory();
  fillSprites(board);
  const step=(r,_w,writeByte)=>{
    writeByte(0x3c00,8);
    return {...r,PC:r.PC+1};
  };
  const before=board.stats().sprite_dma_transfers;
  const provisional=board.stepStatic(step,cpu,{commit:false});
  assert.equal(provisional.sprite_dma_triggers,1);
  assert.equal(provisional.writes_by_region.SPRITE_DMA,1);
  assert.equal(board.stats().sprite_dma_transfers,before);
  const after=board.stepStatic(step,cpu);
  assert.equal(after.sprite_dma_triggers,1);
  assert.equal(board.stats().sprite_dma_transfers,1);
  const snapshot=board.snapshotBufferedSprites();
  assert.equal(snapshot[3],60);
  assert.throws(()=>board.stepStatic((r,_w,byte)=>{
    byte(0x3c00,0);
    return {...r,PC:65536};
  },cpu),/INVALID_MC6809_REGISTER_STATE/);
  assert.equal(board.stats().sprite_dma_transfers,1);
  assert.throws(()=>board.stepStatic((r,_w,byte)=>{
    byte(0x3c00,0);
    byte(0x2000,12);
    return {...r,PC:r.PC+1};
  },cpu),/MIXED_DMA_AND_RAM/);
  assert.equal(board.stats().sprite_dma_transfers,1);
});
test('renderer adapter reads DMA buffer, never uncopied CPU sprite bytes',()=>{
  const board=createGngbBoardMemory();
  fillSprites(board);fillVideo(board);
  assert.throws(()=>snapshotGngbRendererInputs(board),/NOT_TRIGGERED/);
  board.write8(0x3c00,0);
  const inputs=snapshotGngbRendererInputs(board);
  assert.equal(inputs.schema,'gng.r42.renderer-input-snapshot.v1');
  assert.equal(inputs.videoAddressSpace.length,65536);
  assert.equal(inputs.bufferedSprites.length,512);
  assert.equal(inputs.foregroundTiles.length,1024);
  assert.equal(inputs.backgroundTiles.length,1024);
  assert.deepEqual(inputs.spriteDrawOrder.map(s=>s.slot),[1,0]);
  assert.deepEqual(inputs.foregroundTiles[0],readTile(inputs.videoAddressSpace,'fg',0,0));
  assert.deepEqual(inputs.backgroundTiles[1023],readTile(inputs.videoAddressSpace,'bg',31,31));
  assert.deepEqual(inputs.spriteDrawOrder,drawOrder(inputs.bufferedSprites));
  board.write8(0x1e03,100);
  assert.equal(spriteFromBuffer(snapshotGngbRendererInputs(board).bufferedSprites,0).x,60);
  board.write8(0x3c00,0);
  assert.equal(spriteFromBuffer(snapshotGngbRendererInputs(board).bufferedSprites,0).x,100);
  inputs.videoAddressSpace[0x2000]=0x7f;
  inputs.bufferedSprites[3]=0;
  assert.equal(board.read8(0x2000),0);
  assert.equal(board.snapshotBufferedSprites()[3],100);
  assert.equal(inputs.native_dma_timing_verified,false);
  assert.equal(inputs.autonomous_cpu_frame_rendered,false);
});
test('missing renderer VRAM, unknown MMIO, reset and read policy remain guarded',()=>{
  const board=createGngbBoardMemory({readUnmapped3c00:()=>0xa1});
  fillSprites(board);board.write8(0x3c00,0);
  assert.equal(board.read8(0x3c00),0xa1);
  assert.throws(()=>board.write8(0x3c01,0),/UNMODELED_IO_OR_ROM_WRITE/);
  assert.throws(()=>snapshotGngbRendererInputs(board),/UNINITIALIZED_RENDERER_MEMORY/);
  assert.throws(()=>snapshotGngbRendererInputs({}),/R42_RENDERER_BOARD_REQUIRED/);
  board.clearLabState();
  assert.equal(board.stats().sprite_dma_transfers,0);
  assert.throws(()=>board.snapshotBufferedSprites(),/NOT_TRIGGERED/);
});
