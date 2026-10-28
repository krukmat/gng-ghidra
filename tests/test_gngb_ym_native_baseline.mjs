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
    assert.equal(result.ymNativePortWritesInWindow,4);
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


test('G5 optional YM sequence comparison counts prefix and timing without exposing writes',async()=>{
  const writes=[[4,0xe000,0x28],[8,0xe001,0xf0],
    [16,0xe002,0x08],[20,0xe003,0x0f]];
  await withTape([
    [0,'AUDIO_RESET_WRITE',0x3d01,0],
    [200,'AUDIO_RESET_WRITE',0x3d01,1],
    ...writes.map(([tick,addr,value])=>[tick+200,'YM2203_WRITE',addr,value]),
    [240,'YM2203_WRITE',0xe000,0x07]
  ],async file=>{
    const original=await summarizeNativeYmRegisterWindow(file,{windowTStates:10});
    assert.equal(Object.hasOwn(original,'sequenceComparison'),false);
    const generated=writes.map(([tick,addr,value],i)=>[tick+(i<2?12:16),addr,value]);
    generated.push([40,0xe000,0xff]); // boundary is exclusive for both streams
    const result=await summarizeNativeYmRegisterWindow(file,{
      windowTStates:10,generatedYm:generated});
    const cmp=result.sequenceComparison;
    assert.equal(cmp.generatedPortWritesInWindow,4);
    assert.equal(cmp.nativePortWritesInWindow,4);
    assert.equal(cmp.commonPortWritePrefix,4);
    assert.equal(cmp.firstDifferentPortWriteOrdinal,null);
    assert.equal(cmp.matchingOrdinalPortWritePairs,4);
    assert.equal(cmp.firstTimingDifferenceOrdinal,1);
    assert.equal(cmp.matchingPairTimingSkewMin,12);
    assert.equal(cmp.matchingPairTimingSkewMax,16);
    assert.equal(cmp.timingSkewUnit,'MASTER_12MHZ_TICKS_GENERATED_MINUS_NATIVE');
    assert.equal(cmp.nativeParityVerified,false);
    assert.equal(result.usedAsSynthesizerInput,false);
    assert.deepEqual(result.registerActivity,original.registerActivity);
    assert.doesNotMatch(JSON.stringify(cmp),/5734[4-7]|240|0xf0|address|value|events|writes\":/);
  });
});

test('G5 YM comparison identifies first payload mismatch and length differences by ordinal only',async()=>{
  const writes=[[4,0xe000,0x28],[8,0xe001,0xf0],[12,0xe000,0xa0]];
  await withTape([
    [0,'AUDIO_RESET_WRITE',0x3d01,0],
    [200,'AUDIO_RESET_WRITE',0x3d01,1],
    ...writes.map(([tick,addr,value])=>[tick+200,'YM2203_WRITE',addr,value])
  ],async file=>{
    const compare=async generatedYm=>(await summarizeNativeYmRegisterWindow(file,{
      windowTStates:10,generatedYm})).sequenceComparison;
    const different=writes.map(row=>row.slice());different[1][2]=0xef;
    const cmp=await compare(different);
    assert.equal(cmp.commonPortWritePrefix,1);
    assert.equal(cmp.firstDifferentPortWriteOrdinal,2);
    assert.equal(cmp.matchingOrdinalPortWritePairs,2);
    assert.equal(cmp.firstTimingDifferenceOrdinal,null);
    assert.equal(cmp.matchingPairTimingSkewMin,0);
    assert.equal(cmp.matchingPairTimingSkewMax,0);
    const portMismatch=writes.map(row=>row.slice());portMismatch[1][1]=0xe003;
    assert.equal((await compare(portMismatch)).firstDifferentPortWriteOrdinal,2);
    const short=await compare(writes.slice(0,2));
    assert.equal(short.commonPortWritePrefix,2);
    assert.equal(short.firstDifferentPortWriteOrdinal,3);
    const long=await compare([...writes,[16,0xe000,0x28]]);
    assert.equal(long.commonPortWritePrefix,3);
    assert.equal(long.firstDifferentPortWriteOrdinal,4);
    const empty=await compare([]);
    assert.equal(empty.commonPortWritePrefix,0);
    assert.equal(empty.firstDifferentPortWriteOrdinal,1);
    assert.equal(empty.matchingPairTimingSkewMin,null);
    assert.equal(empty.matchingPairTimingSkewMax,null);
  });
});

test('G5 YM timing compares signed skew only for same-ordinal matching port writes',async()=>{
  await withTape([
    [0,'AUDIO_RESET_WRITE',0x3d01,0],
    [200,'AUDIO_RESET_WRITE',0x3d01,1],
    [220,'YM2203_WRITE',0xe000,0x28],
    [240,'YM2203_WRITE',0xe001,0xf0],
    [260,'YM2203_WRITE',0xe002,0x08]
  ],async file=>{
    const cmp=(await summarizeNativeYmRegisterWindow(file,{
      windowTStates:30,generatedYm:[
        [16,0xe000,0x28],[44,0xe003,0x0f],[68,0xe002,0x08]
      ]})).sequenceComparison;
    assert.equal(cmp.commonPortWritePrefix,1);
    assert.equal(cmp.firstDifferentPortWriteOrdinal,2);
    assert.equal(cmp.matchingOrdinalPortWritePairs,2);
    assert.equal(cmp.firstTimingDifferenceOrdinal,1);
    assert.equal(cmp.matchingPairTimingSkewMin,-4);
    assert.equal(cmp.matchingPairTimingSkewMax,8);
  });
});

test('G5 YM comparison rejects malformed generated events before native tape I/O',async()=>{
  const invalid=[{},Array(200001),Array(1),[[0,0xe000]],[[0,0xe000,0,1]],
    [[-1,0xe000,0]],[[1.5,0xe000,0]],[[Number.MAX_SAFE_INTEGER+1,0xe000,0]],
    [[0,0xdfff,0]],[[0,0xe004,0]],[[0,0xe000,256]],[[0,0xe000,-1]],
    [[4,0xe000,0],[0,0xe001,0]]];
  for(const generatedYm of invalid)
    await assert.rejects(summarizeNativeYmRegisterWindow('synthetic-file-never-read',{
      generatedYm}),/^Error: AUDIO_YM_NATIVE_BASELINE_BAD_GENERATED_YM$/);
});
