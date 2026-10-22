import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createGngbBoardMemory}
  from '../src/gngb_board_memory.mjs';
import {tileAddress, readTile, changedTileBytes}
  from '../src/video_memory.mjs';
import {snapshotSprites, spriteFromBuffer}
  from '../src/sprite_memory.mjs';
import {compileAt,emitStaticModule}
  from '../scripts/r3_static_trace_probe.mjs';
import {mkdir,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const cpu=(PC,{A=0x32,B=0x81,X=0x2000,Y=0x2800,
  U=0,S=0x4000,DP=0,CC=0x11}={})=>({PC,A,B,X,Y,U,S,DP,CC});
function syntheticRom(){
  const rom=new Uint8Array(65536);
  rom[0xfffe]=0x60;rom[0xffff]=0;
  rom.set([0xa7,0x80],0x6041); // STA ,X+
  rom.set([0xe7,0xa0],0x6043); // STB ,Y+
  rom.set([0xe7,0x80],0x6055); // STB ,X+
  rom.set([0xa7,0xa0],0x6057); // STA ,Y+
  rom.set([0xed,0x81],0x600c); // special ROM-attested STD ,X++
  return rom;
}
async function withStaticCompiler(fn){
  await mkdir('out/r3',{recursive:true});
  const directory=await mkdtemp(resolve('out/r3/a05-board-'));
  try{
    const rom=syntheticRom(),pcs=[0x6041,0x6043,0x6055,0x6057,0x600c];
    const specs=pcs.map(pc=>compileAt(rom,pc));
    assert.ok(specs.every(Boolean));
    const js=emitStaticModule(specs);
    assert.doesNotMatch(js,/decodeOpcode|interpreterLoop|rom\[r\.PC\]/);
    const path=resolve(directory,'private-static.mjs');
    await writeFile(path,js);
    const {compiledStep}=await import(pathToFileURL(path).href);
    return await fn(compiledStep);
  }finally{await rm(directory,{force:true,recursive:true});}
}

test('uninitialized RAM is unknown; unmodeled MMIO, ROM and bank reads/writes fail closed',()=>{
  const board=createGngbBoardMemory();
  assert.throws(()=>board.read8(0x2000),/UNINITIALIZED_RAM_READ/);
  assert.throws(()=>board.read8(0x3c00),/UNMODELED_IO_OR_ROM_READ/);
  assert.throws(()=>board.read8(0x5000),/UNMODELED_IO_OR_ROM_READ/);
  assert.throws(()=>board.read8(0x6000),/UNMODELED_IO_OR_ROM_READ/);
  assert.throws(()=>board.write8(0x3c00,1),/UNMODELED_IO_OR_ROM_WRITE/);
  assert.throws(()=>board.write8(0x6000,1),/UNMODELED_IO_OR_ROM_WRITE/);
  assert.throws(()=>board.write8(0x1000,256),/BYTE_OUT_OF_RANGE/);
  assert.throws(()=>board.read8(-1),/ADDRESS_OUT_OF_RANGE/);
  assert.throws(()=>board.read8(65536),/ADDRESS_OUT_OF_RANGE/);
  assert.throws(()=>createGngbBoardMemory({readUnmapped3c00:3}),/CALLBACK_INVALID/);
  const withPolicy=createGngbBoardMemory({readUnmapped3c00:address=>{
    assert.equal(address,0x3c00);
    return 0xa1;
  }});
  assert.equal(withPolicy.read8(0x3c00),0xa1);
  assert.throws(()=>createGngbBoardMemory({readUnmapped3c00:()=>256}).read8(0x3c00),/BYTE_OUT_OF_RANGE/);
  assert.equal(board.stats().game_playable,false);
});

test('tilemap decoder consumes independently owned RAM snapshots, not new rendering logic',()=>{
  const board=createGngbBoardMemory();
  const fg=tileAddress('fg',2,3),bg=tileAddress('bg',4,5);
  assert.throws(()=>board.tile('fg',2,3),/UNINITIALIZED_RENDERER_MEMORY/);
  board.write8(fg,0x67);board.write8(fg+0x400,0xd5);
  board.write8(bg,0x89);board.write8(bg+0x400,0x67);
  const fgTile=board.tile('fg',2,3),bgTile=board.tile('bg',4,5);
  assert.deepEqual(fgTile,readTile(board.snapshotAddressSpace(),'fg',2,3));
  assert.deepEqual(bgTile,readTile(board.snapshotAddressSpace(),'bg',4,5));
  assert.equal(fgTile.graphic,0x367);
  assert.equal(bgTile.graphic,0x189);
  assert.throws(()=>board.snapshotAddressSpace({requireVideoInitialized:true}),
    /UNINITIALIZED_RENDERER_MEMORY/);
  const snapshot=board.snapshotAddressSpace();
  snapshot[fg]=0;
  assert.equal(board.read8(fg),0x67);
  board.write8(fg,0x68);
  const differences=changedTileBytes(snapshot,board.snapshotAddressSpace(),'fg');
  assert.equal(differences.length,1);
  assert.equal(differences[0].addr,fg);
  assert.equal(differences[0].after,0x68);
});

test('4,096 static STA/STB indexed stores fill FG/BG RAM with no opcode interpreter',async()=>{
  await withStaticCompiler(compiledStep=>{
    const board=createGngbBoardMemory();
    const before=board.stats();assert.equal(before.writes,0);
    let total=0;
    for(let i=0;i<1024;i++){
      const regSets=[
        cpu(0x6041,{A:i&255,X:0x2000+i}),
        cpu(0x6043,{B:(i+3)&255,Y:0x2800+i}),
        cpu(0x6055,{B:(i+5)&255,X:0x2400+i}),
        cpu(0x6057,{A:(i+7)&255,Y:0x2c00+i})
      ];
      for(const [index,registers] of regSets.entries()){
        const result=board.stepStatic(compiledStep,registers);
        assert.equal(result.committed,true);
        assert.equal(result.byte_writes,1);
        assert.equal(result.registers.PC,registers.PC+2);
        assert.equal(result.registers.CC,(registers.CC&~14)|
          (((index===0?i:index===1?i+3:index===2?i+5:i+7)&255)===0?4:0)|
          ((((index===0?i:index===1?i+3:index===2?i+5:i+7)&255)&128)?8:0));
        total++;
      }
    }
    assert.equal(total,4096);
    const state=board.stats();
    assert.equal(state.writes,4096);
    assert.equal(state.initialized_ram_bytes,4096);
    assert.equal(state.writes_by_region.FG_RAM,2048);
    assert.equal(state.writes_by_region.BG_RAM,2048);
    assert.equal(state.native_video_bus_equivalence_verified,false);
    assert.equal(state.banked_rom_irq_sync_dma_verified,false);
    assert.equal(board.read8(0x2000),0);
    assert.equal(board.read8(0x2800),3);
    assert.equal(board.read8(0x2400),5);
    assert.equal(board.read8(0x2c00),7);
    const frameMemory=board.snapshotAddressSpace({requireVideoInitialized:true});
    assert.equal(frameMemory.length,65536);
    assert.ok(readTile(frameMemory,'fg',0,0));
    assert.ok(readTile(frameMemory,'bg',0,0));
    assert.throws(()=>board.snapshotRawSprites(),/UNINITIALIZED_RENDERER_MEMORY/);
  });
});

test('existing 16-bit sprite writer is mapped big-endian, but DMA latch is unmodeled',async()=>{
  await withStaticCompiler(compiledStep=>{
    const board=createGngbBoardMemory();
    const state=board.stepStatic(compiledStep,cpu(0x600c,{
      A:0x13,B:0x57,X:0x1e00
    }));
    assert.equal(state.byte_writes,2);
    assert.equal(state.registers.X,0x1e02);
    assert.equal(board.read8(0x1e00),0x13);
    assert.equal(board.read8(0x1e01),0x57);
    assert.throws(()=>board.snapshotRawSprites(),/UNINITIALIZED_RENDERER_MEMORY/);
    assert.throws(()=>board.writeSpriteWord(0x1e01,0xabcd),/OUT_OF_RANGE/);
    assert.throws(()=>board.write8(0x3c00,0),/UNMODELED_IO_OR_ROM_WRITE/);
    for(let address=0x1e02;address<0x2000;address++)board.write8(address,0);
    const snapshot=board.snapshotRawSprites();
    assert.deepEqual(snapshot,snapshotSprites(board.snapshotAddressSpace()));
    assert.deepEqual(spriteFromBuffer(snapshot,0).bytes.slice(0,2),[0x13,0x57]);
    assert.equal(board.stats().writes_by_region.SPRITE_RAM,512);
  });
});

test('static step commits atomically or rolls back on invalid byte, unmodeled IO and thrown code',async()=>{
  await withStaticCompiler(compiledStep=>{
    const board=createGngbBoardMemory();
    const source=cpu(0x6041,{A:0x22,X:0x2000});
    const before=board.stats();
    const staged=board.stepStatic(compiledStep,source,{commit:false});
    assert.equal(staged.committed,false);
    assert.equal(staged.byte_writes,1);
    assert.throws(()=>board.read8(0x2000),/UNINITIALIZED_RAM_READ/);
    assert.deepEqual(board.stats(),before);
    assert.throws(()=>board.stepStatic((r,_word,writeByte)=>{
      writeByte(0x2000,0x12);
      writeByte(0x3c00,0x20);
      return {...r,PC:r.PC+1};
    },source),/UNMODELED_IO_OR_ROM_WRITE/);
    assert.throws(()=>board.read8(0x2000),/UNINITIALIZED_RAM_READ/);
    assert.throws(()=>board.stepStatic((r,_word,writeByte)=>{
      writeByte(0x2000,0x12);
      throw Error('FAKE_GENERATOR_ABORT');
    },source),/FAKE_GENERATOR_ABORT/);
    assert.throws(()=>board.stepStatic((r,_word,writeByte)=>{
      writeByte(0x2000,0x12);
      return {...r,PC:65536};
    },source),/INVALID_MC6809_REGISTER_STATE/);
    assert.equal(board.stats().writes,0);
    assert.throws(()=>board.read8(0x2000),/UNINITIALIZED_RAM_READ/);
    board.stepStatic(compiledStep,source);
    assert.equal(board.read8(0x2000),0x22);
    board.clearLabState();
    assert.equal(board.stats().writes,0);
    assert.throws(()=>board.read8(0x2000),/UNINITIALIZED_RAM_READ/);
  });
});
