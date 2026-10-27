import test from 'node:test';
import assert from 'node:assert/strict';
import {YmRegisterHealth,YmHealthStop}
  from '../src/gngb_ym_register_health.mjs';

test('G5 silence diagnosis recognizes YM2203 FM key-on and PSG gain from write pairs',()=>{
  const h=new YmRegisterHealth();
  h.accept(0xe000,0x28);h.accept(0xe001,0xf0);
  h.accept(0xe000,0xa0);h.accept(0xe001,0x7b);
  h.accept(0xe002,0x08);h.accept(0xe003,0x0f);
  h.accept(0xe002,0x07);h.accept(0xe003,0x38);
  const s=h.snapshot();
  assert.equal(s.totalAddressWrites,4);
  assert.equal(s.totalDataWrites,4);
  assert.equal(s.totalFmKeyOn,1);
  assert.equal(s.totalFmFrequencyWrites,1);
  assert.equal(s.totalPsgVolumeNonzero,1);
  assert.equal(s.chips[1].psgMixerWrites,1);
  assert.equal(s.plausibleToneActivation,true);
  assert.equal(s.rawYmDataExported,false);
  assert.equal(s.pcmSynthesisVerified,false);
  assert.equal(JSON.stringify(s).includes('0x7b'),false);
});
test('G5 silence diagnosis detects no gain despite thousands of YM writes',()=>{
  const h=new YmRegisterHealth();
  for(let i=0;i<400;i++){
    h.accept(0xe000,0x07);h.accept(0xe001,0x3f);
    h.accept(0xe002,0x28);h.accept(0xe003,0x00);
  }
  const s=h.snapshot();
  assert.equal(s.chips[0].portWrites,800);
  assert.equal(s.chips[1].portWrites,800);
  assert.equal(s.totalDataWrites,800);
  assert.equal(s.totalFmKeyOn,0);
  assert.equal(s.totalPsgVolumeNonzero,0);
  assert.equal(s.plausibleToneActivation,false);
});
test('G5 silence diagnosis flags write-before-select and invalid inputs',()=>{
  const h=new YmRegisterHealth();
  h.accept(0xe001,0x77);
  assert.equal(h.snapshot().totalUnpairedDataWrites,1);
  for(const [a,v] of [[0xdfff,0],[0xe004,0],[0xe000,-1],
    [0xe000,256],[0xe000,1.5],['0xe000',0]])
    assert.throws(()=>h.accept(a,v),YmHealthStop);
});
