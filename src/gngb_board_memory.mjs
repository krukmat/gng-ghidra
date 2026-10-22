/**
 * A0.5 — strict minimal gngb RAM / VRAM board adapter for *static* MC6809 JS.
 *
 * This is an incremental bridge to src/video_memory.mjs and
 * src/sprite_memory.mjs, NOT an MC6809 interpreter or an emulation of the
 * full board. Cold-boot RAM power-on state, banked ROM, IRQ/SYNC, MMIO
 * writes, sprite DMA buffering and cycle timing are explicitly unverified.
 * All reads of RAM not written since clearLabState() fail closed.
 */
import {readTile as decodeTile, tileAddress, FG_START, BG_START, TILEMAP_SIZE}
  from './video_memory.mjs';
import {snapshotSprites, SPRITE_RAM_START, SPRITE_RAM_LENGTH}
  from './sprite_memory.mjs';
import {checkedState} from '../scripts/r3_static_trace_probe.mjs';

export const GNG_RAM_END = 0x2fff;
export const GNG_VIDEO_START = FG_START;
export const GNG_VIDEO_END = BG_START + TILEMAP_SIZE - 1;

function addressCheck(addr) {
  if (!Number.isInteger(addr) || addr < 0 || addr > 0xffff)
    throw new RangeError('GNGB_ADDRESS_OUT_OF_RANGE');
}
function byteCheck(value) {
  if (!Number.isInteger(value) || value < 0 || value > 255)
    throw new RangeError('GNGB_BYTE_OUT_OF_RANGE');
}
function classify(addr) {
  if (addr < SPRITE_RAM_START) return 'MAIN_RAM';
  if (addr < 0x2000) return 'SPRITE_RAM';
  if (addr < BG_START) return 'FG_RAM';
  if (addr <= GNG_RAM_END) return 'BG_RAM';
  return 'UNSUPPORTED';
}

/** Creates isolated memory with no assumed reset contents or ROM injection. */
export function createGngbBoardMemory({readUnmapped3c00} = {}) {
  if (readUnmapped3c00 !== undefined && typeof readUnmapped3c00 !== 'function')
    throw new TypeError('GNGB_UNMAPPED_READ_CALLBACK_INVALID');
  const bytes = new Uint8Array(65536);
  const known = new Uint8Array(GNG_RAM_END + 1);
  let writeCount = 0;
  let writesPerRegion = Object.create(null);

  function assertWritable(addr, value) {
    addressCheck(addr);
    byteCheck(value);
    if (addr > GNG_RAM_END)
      throw new RangeError('GNGB_UNMODELED_IO_OR_ROM_WRITE');
  }
  function write8(addr, value) {
    assertWritable(addr, value);
    bytes[addr] = value;
    known[addr] = 1;
    writeCount++;
    const reg = classify(addr);
    writesPerRegion[reg] = (writesPerRegion[reg] || 0) + 1;
  }
  function read8(addr) {
    addressCheck(addr);
    if (addr <= GNG_RAM_END) {
      if (!known[addr]) throw new Error('GNGB_UNINITIALIZED_RAM_READ');
      return bytes[addr];
    }
    if (addr === 0x3c00 && readUnmapped3c00) {
      const value = readUnmapped3c00(addr);
      byteCheck(value);
      return value;
    }
    throw new RangeError('GNGB_UNMODELED_IO_OR_ROM_READ');
  }
  function writeSpriteWord(addr, word) {
    addressCheck(addr);
    if (!Number.isInteger(word) || word < 0 || word > 0xffff)
      throw new RangeError('GNGB_WORD_OUT_OF_RANGE');
    if (addr < SPRITE_RAM_START || addr >= 0x2000 || (addr & 1) || addr + 1 >= 0x2000)
      throw new RangeError('GNGB_SPRITE_WORD_WRITE_OUT_OF_RANGE');
    write8(addr, (word >>> 8) & 255);
    write8(addr + 1, word & 255);
  }
  function checkKnown(from, end) {
    for (let addr = from; addr < end; addr++)
      if (!known[addr]) throw new Error('GNGB_UNINITIALIZED_RENDERER_MEMORY');
  }
  function snapshotAddressSpace({requireVideoInitialized = false} = {}) {
    if (requireVideoInitialized)
      checkKnown(GNG_VIDEO_START, GNG_VIDEO_END + 1);
    return bytes.slice(); // never expose the mutable board buffer
  }
  function tile(kind, col, row) {
    const addr = tileAddress(kind, col, row);
    checkKnown(addr, addr + 1);
    checkKnown(addr + 0x400, addr + 0x401);
    return decodeTile(bytes, kind, col, row);
  }
  function snapshotRawSprites({requireInitialized = true} = {}) {
    if (requireInitialized)
      checkKnown(SPRITE_RAM_START, SPRITE_RAM_START + SPRITE_RAM_LENGTH);
    // This is CPU sprite RAM, NOT a claim that the 0x3c00 DMA occurred.
    return snapshotSprites(bytes);
  }
  function clearLabState() {
    // Explicit lab reset, not a reproduction of native cold-boot contents.
    bytes.fill(0);
    known.fill(0);
    writeCount = 0;
    writesPerRegion = Object.create(null);
  }
  /**
   * Run ONE precompiled, static instruction with atomic RAM write effects.
   * If generated code throws, emits an invalid state/address, or lacks a
   * sink, nothing is committed. This has no runtime opcode decoder.
   */
  function stepStatic(compiledStep, registers, {commit = true} = {}) {
    if (typeof compiledStep !== 'function' || typeof commit !== 'boolean')
      throw new TypeError('GNGB_STATIC_STEP_ARGUMENT_INVALID');
    checkedState(registers);
    const staged = [];
    const stageByte = (addr, value) => {
      assertWritable(addr, value);
      if (staged.length >= 2)
        throw new Error('GNGB_UNSUPPORTED_MULTIWRITE_INSTRUCTION');
      staged.push({addr, value});
    };
    const stageWord = (addr, word) => {
      if (!Number.isInteger(word) || word < 0 || word > 0xffff ||
          !Number.isInteger(addr) || addr < SPRITE_RAM_START ||
          addr > 0x1ffe || (addr & 1))
        throw new RangeError('GNGB_INVALID_COMPILED_SPRITE_WORD_WRITE');
      stageByte(addr, (word >>> 8) & 255);
      stageByte(addr + 1, word & 255);
    };
    const output = compiledStep(registers, stageWord, stageByte);
    checkedState(output);
    if (commit) for (const {addr, value} of staged) write8(addr, value);
    return {
      registers: output,
      committed: commit,
      byte_writes: staged.length,
      // No raw byte/address export. The complete contents remain available
      // through the explicit private snapshot for the existing renderer.
      writes_by_region: staged.reduce((acc, e) => {
        const reg = classify(e.addr);
        acc[reg] = (acc[reg] || 0) + 1;
        return acc;
      }, Object.create(null)),
    };
  }
  function stats() {
    return {
      schema: 'gng.a05.board-memory-lab.v1',
      writes: writeCount,
      initialized_ram_bytes: known.reduce((sum, item) => sum + item, 0),
      writes_by_region: {...writesPerRegion},
      native_video_bus_equivalence_verified: false,
      banked_rom_irq_sync_dma_verified: false,
      game_playable: false,
    };
  }
  return Object.freeze({
    read8, write8, writeSpriteWord, stepStatic, tile,
    snapshotAddressSpace, snapshotRawSprites, clearLabState, stats,
  });
}
