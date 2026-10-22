import {test} from 'node:test';
import assert from 'node:assert/strict';
import {GNG_BANK_COUNT,GNG_BANK_SIZE,GNG_BANK_START,GNG_BANK_END,
  entryFromBankControl,createGngbBankedRom}
  from '../src/gngb_banked_rom.mjs';

function syntheticBankImage(){
  const image=new Uint8Array(GNG_BANK_COUNT*GNG_BANK_SIZE);
  for(let i=0;i<GNG_BANK_COUNT;i++)
    image.fill(0x30+i,i*GNG_BANK_SIZE,(i+1)*GNG_BANK_SIZE);
  return image;
}
test('exact five 8 KiB banks with an explicit selection: no invented power-on bank',()=>{
  const board=createGngbBankedRom(syntheticBankImage());
  assert.equal(GNG_BANK_COUNT,5);
  assert.equal(GNG_BANK_SIZE,8192);
  assert.equal(GNG_BANK_START,0x4000);
  assert.equal(GNG_BANK_END,0x5fff);
  assert.throws(()=>board.read8(0x4000),/ENTRY_UNKNOWN/);
  assert.equal(board.stats().active_bank_entry,null);
  for(let raw of [0,1,2,3,4]){
    const selected=board.selectFromControlWrite(raw);
    assert.equal(selected,raw);
    assert.equal(board.read8(0x4000),0x30+raw);
    assert.equal(board.read8(0x5fff),0x30+raw);
  }
  assert.equal(board.stats().banked_reads,10);
  assert.equal(board.stats().explicit_selection_writes,5);
  assert.equal(board.stats().per_instruction_native_bank_provenance_verified,false);
  assert.equal(board.stats().native_bank_switch_timing_verified,false);
  assert.equal(board.stats().game_playable,false);
});
test('gngb control select matches MAME: exactly value 4 chooses bank 4; other bytes mask to 2 bits',()=>{
  for(let n=0;n<256;n++)
    assert.equal(entryFromBankControl(n),n===4?4:n&3);
  const b=createGngbBankedRom(syntheticBankImage());
  assert.equal(b.selectFromControlWrite(0x05),1);
  assert.equal(b.read8(0x4000),0x31);
  assert.equal(b.selectFromControlWrite(0x14),0);
  assert.equal(b.read8(0x4000),0x30);
  assert.equal(b.selectFromControlWrite(4),4);
  assert.equal(b.read8(0x4000),0x34);
});
test('bank ROM is read-only, isolated from source array, and window accesses are bounded',()=>{
  const image=syntheticBankImage();
  const b=createGngbBankedRom(image);
  b.selectFromControlWrite(4);
  image.fill(0);
  assert.equal(b.read8(0x4000),0x34);
  assert.throws(()=>b.read8(0x3fff),/OUTSIDE_WINDOW/);
  assert.throws(()=>b.read8(0x6000),/OUTSIDE_WINDOW/);
  assert.throws(()=>b.read8(-1),/OUTSIDE_WINDOW/);
  assert.throws(()=>b.read8(0x4000+0.5),/OUTSIDE_WINDOW/);
  assert.throws(()=>b.selectFromControlWrite(256),/SELECT_BYTE_INVALID/);
  assert.throws(()=>entryFromBankControl(-1),/SELECT_BYTE_INVALID/);
  assert.throws(()=>entryFromBankControl(2.5),/SELECT_BYTE_INVALID/);
  assert.throws(()=>createGngbBankedRom(new Uint8Array(8192)),
    /FIVE_AUTHENTIC_BANK_IMAGES_REQUIRED/);
  assert.equal(typeof b.write8,'undefined');
  assert.equal(typeof b.setCurrentBankFromDebugger,'undefined');
});
