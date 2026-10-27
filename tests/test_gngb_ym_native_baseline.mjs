import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {summarizeNativeYmRegisterWindow}
  from '../src/gngb_ym_native_baseline.mjs';

async function withTape(rows,fn) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gng-ym-private-test-'));
  const file=path.join(dir,'synthetic.jsonl');
  try {
    fs.writeFileSync(file,rows.map((r,i)=>JSON.stringify({
      seq:i+1,frame:0,tick12m:r[0],kind:r[1],address:r[2],value:r[3]
    })).join('\n')+'\n',{mode:0o600});
    await fn(file);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
test('G5 comparator uses first one-second native YM window only for aggregated diagnostics',async()=>{
  await withTape([
    [0,'AUDIO_RESET_WRITE',0x3d01,0],
    [200,'AUDIO_RESET_WRITE',0x3d01,1],
    [204,'YM2203_WRITE',0xe000,0x28],
    [208,'YM2203_WRITE',0xe001,0xf0],
    [216,'YM2203_WRITE',0xe002,0x08],
    [220,'YM2203_WRITE',0xe003,0x0f],
    [600,'YM2203_WRITE',0xe000,0x07],
    [604,'YM2203_WRITE',0xe001,0x3f]
  ],async file=>{
    const result=await summarizeNativeYmRegisterWindow(file,{
      windowTStates:10});
    assert.equal(result.status,'AGGREGATE_COMPARISON_ONLY_NO_YM_TAPE_REPLAY');
    assert.equal(result.firstNativeYmTStateAfterRelease,1);
    assert.equal(result.ymNativePortWritesInWindow,6);
    assert.equal(result.registerActivity.totalFmKeyOn,1);
    assert.equal(result.registerActivity.totalPsgVolumeNonzero,1);
    assert.equal(result.totalYmPortWritesAfterRelease,6);
    assert.equal(result.usedAsSynthesizerInput,false);
    assert.equal(result.rawYmDataExported,false);
    assert.equal(JSON.stringify(result).includes('0xf0'),false);
  });
});

test('G5 comparator rejects missing reset and malformed native YM timestamps',async()=>{
  await withTape([
    [0,'YM2203_WRITE',0xe000,0x28],
    [4,'YM2203_WRITE',0xe001,0xf0]
  ],async file=>{
    await assert.rejects(
      summarizeNativeYmRegisterWindow(file),
      /AUDIO_YM_NATIVE_BASELINE_RESET_EPOCH_STOP/);
  });
  await withTape([
    [0,'AUDIO_RESET_WRITE',0x3d01,0],
    [8,'AUDIO_RESET_WRITE',0x3d01,1],
    [100,'YM2203_WRITE',0xe001,0x28],
    [99,'YM2203_WRITE',0xe001,0xf0]
  ],async file=>{
    await assert.rejects(
      summarizeNativeYmRegisterWindow(file),
      /AUDIO_YM_NATIVE_BASELINE_BAD_YM/);
  });
});
